import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { PowerPointOpenResult } from './powerpointBridgeTypes'

const execFileAsync = promisify(execFile)

/**
 * Plain AppleScript throughout, not JXA (unlike keynoteBridge.ts) — PowerPoint's
 * JXA bridge has real gaps against its own Cocoa scripting implementation
 * (confirmed: `open()`'s return value and several element-of-element property
 * chains don't resolve in JXA even though the equivalent AppleScript works
 * cleanly), so JXA's cleaner JSON output isn't worth the extra unreliability
 * here. Field separators (ASCII 30/31) are used instead of JSON for the same
 * reason keynoteBridge.ts uses JXA's JSON.stringify: to get structured data
 * back through a single osascript call without hand-parsing AppleScript list
 * syntax.
 *
 * Also confirmed: PowerPoint's `save ... as PNG/PDF` (and even a plain
 * `save ... in <file>` with no format change) is declared in its AppleScript
 * dictionary but is a silent no-op — reports success, writes nothing. The
 * only working path to a rendered slide image is `copy object` (puts a real
 * PNG/PDF/etc. on the system clipboard) followed by reading it back off the
 * clipboard — done one slide at a time, since there's no bulk equivalent to
 * Keynote's one-shot `export ... as slide images`.
 */
async function runAppleScript(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script, ...args])
  return stdout.trim()
}

/**
 * PowerPoint Mac's AppleScript dictionary exposes `slide width` on `page
 * setup` but — confirmed live — has no `slide height` property at all (nor
 * any equivalent elsewhere); querying it throws "object does not exist".
 * A .pptx is a zip, so this reads its own `ppt/presentation.xml` directly
 * instead, which always carries the real dimensions in `<p:sldSz cx cy>`
 * (EMUs) — more reliable than depending on a dictionary property that isn't
 * there, and only the width/height *ratio* is ever used, so the EMU unit
 * doesn't matter.
 */
async function getSlideDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync('unzip', ['-p', filePath, 'ppt/presentation.xml'])
  const match = stdout.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/)
  if (!match) throw new Error('Could not find slide size in presentation.xml')
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) }
}

const UNIT_SEP = ''
const RECORD_SEP = ''

const OPEN_SCRIPT = `
on run argv
  set filePath to item 1 of argv
  tell application "Microsoft PowerPoint"
    activate
    open POSIX file filePath
    delay 1.5
    set thePres to active presentation
    set slideCount to count of slides of thePres
    set notesList to {}
    repeat with i from 1 to slideCount
      set noteText to ""
      try
        set notesPg to notes page of slide i of thePres
        if (count of shapes of notesPg) > 1 then
          set noteText to content of text range of text frame of shape 2 of notesPg
        end if
      end try
      set end of notesList to noteText
    end repeat
    set AppleScript's text item delimiters to "${UNIT_SEP}"
    set notesJoined to notesList as text
    set AppleScript's text item delimiters to ""
    return (slideCount as text) & "${RECORD_SEP}" & notesJoined
  end tell
end run
`

const EXPORT_FRAME_SCRIPT = `
on run argv
  set slideNum to (item 1 of argv) as integer
  set outPath to item 2 of argv
  tell application "Microsoft PowerPoint"
    set thePres to active presentation
    copy object slide slideNum of thePres
  end tell
  set pngData to the clipboard as «class PNGf»
  set outFile to open for access (POSIX file outPath) with write permission
  set eof outFile to 0
  write pngData to outFile
  close access outFile
end run
`

const GOTO_SCRIPT = `
on run argv
  set slideNum to (item 1 of argv) as integer
  tell application "Microsoft PowerPoint"
    set thePres to active presentation
    if (count of slide show windows) > 0 then
      set ssw to slide show window 1
      go to slide (slideshow view of ssw) number slideNum
    else
      set dw to document window 1
      go to slide (view of dw) number slideNum
    end if
  end tell
end run
`

const CURRENT_SLIDE_SCRIPT = `
on run argv
  tell application "Microsoft PowerPoint"
    set thePres to active presentation
    if (count of slide show windows) > 0 then
      set ssw to slide show window 1
      return (slide number of (slide of (slideshow view of ssw))) as text
    else
      set dw to document window 1
      return (slide number of (slide of (view of dw))) as text
    end if
  end tell
end run
`

const STOP_SCRIPT = `
on run argv
  tell application "Microsoft PowerPoint"
    try
      if (count of slide show windows) > 0 then close slide show window 1
    end try
  end tell
end run
`

const POLL_INTERVAL_MS = 400

/** Bridges the renderer to a real, currently-open PowerPoint document via osascript.
 *  Mirrors keynoteBridge.ts's shape (open/goTo/close/poll), but frame export is a
 *  per-slide clipboard round-trip instead of one bulk export — see the runAppleScript
 *  doc comment above for why. */
export class PowerPointBridgeMac extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null
  private lastKnownPage = 0

  async open(filePath: string): Promise<PowerPointOpenResult> {
    this.stopPolling()

    const raw = await runAppleScript(OPEN_SCRIPT, [filePath])
    const [slideCountStr, notesJoined] = raw.split(RECORD_SEP)
    const totalPages = parseInt(slideCountStr, 10)
    const notes = notesJoined ? notesJoined.split(UNIT_SEP) : []

    const notesBySlide: Record<number, string> = {}
    notes.forEach((note, i) => {
      if (note) notesBySlide[i + 1] = note
    })

    const framesDir = await mkdtemp(join(tmpdir(), 'presentation-commander-powerpoint-'))
    const frameFiles: string[] = []
    for (let i = 1; i <= totalPages; i++) {
      const framePath = join(framesDir, `slide-${i}.png`)
      await runAppleScript(EXPORT_FRAME_SCRIPT, [String(i), framePath])
      frameFiles.push(framePath)
    }

    const { width: slideWidth, height: slideHeight } = await getSlideDimensions(filePath)

    this.lastKnownPage = 1
    this.startPolling()

    return { totalPages, notesBySlide, frameFiles, slideWidth, slideHeight }
  }

  async goTo(page: number): Promise<void> {
    this.lastKnownPage = page
    await runAppleScript(GOTO_SCRIPT, [String(page)])
  }

  async close(): Promise<void> {
    this.stopPolling()
    try {
      await runAppleScript(STOP_SCRIPT)
    } catch (err) {
      console.error('[powerpoint-bridge] Failed to stop slide show on close:', err)
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      runAppleScript(CURRENT_SLIDE_SCRIPT)
        .then((raw) => {
          const page = parseInt(raw, 10)
          if (!Number.isNaN(page) && page !== this.lastKnownPage) {
            this.lastKnownPage = page
            this.emit('current-slide-changed', page)
          }
        })
        .catch((err) => console.error('[powerpoint-bridge] Failed to poll current slide:', err))
    }, POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }
}
