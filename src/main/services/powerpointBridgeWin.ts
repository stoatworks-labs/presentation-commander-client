import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { PowerPointOpenResult } from './powerpointBridgeTypes'

const execFileAsync = promisify(execFile)

/**
 * PowerShell COM automation (`New-Object -ComObject PowerPoint.Application`),
 * confirmed working end-to-end against a real install (including under
 * Windows-on-ARM's x64 emulation — COM automation is out-of-process, so an
 * architecture mismatch between PowerShell and PowerPoint isn't a problem).
 * Each PowerShell process is short-lived, so goTo/poll reconnect to the
 * already-running PowerPoint instance via
 * `[Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')`
 * (confirmed working) rather than keeping one PowerShell process alive.
 *
 * Unlike the Mac side, `Slide.Export(path, "PNG", w, h)` genuinely works here
 * — no clipboard round-trip needed. `SlideShowSettings.Run()` is declared and
 * returns a non-null object, but confirmed unreliable at actually producing a
 * rendered fullscreen show in this environment (same class of issue as
 * Keynote's equivalent on macOS — see gotoScript's doc comment below), so
 * this drives the normal editing view instead, which is fully reliable and
 * sufficient for what the app actually needs.
 *
 * Scripts are passed via `-EncodedCommand` (base64 UTF-16LE), not `-File` —
 * this keeps them exempt from the execution-policy restriction that gates
 * loading .ps1 files (a deliberate choice over `-ExecutionPolicy Bypass`,
 * which would weaken a real security control instead of just sidestepping a
 * restriction that was never meant to apply to inline automation like this)
 * and sidesteps quoting entirely, since the script never touches a shell.
 */
function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function runPowerShell(script: string): Promise<string> {
  const encoded = encodePowerShellCommand(script)
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded
  ])
  return stdout.trim()
}

const UNIT_SEP = '\x1F'
const RECORD_SEP = '\x1E'

function openAndReadScript(filePath: string, framesDir: string): string {
  // PowerShell string literals here use '' for a literal single quote — filePath/
  // framesDir come from Electron's own file/temp-dir APIs, never user-typed text,
  // so no other escaping is needed.
  const escapedPath = filePath.replace(/'/g, "''")
  const escapedFramesDir = framesDir.replace(/'/g, "''")
  return `
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = -1
$pres = $ppt.Presentations.Open('${escapedPath}', 0, 0, -1)
$slideCount = $pres.Slides.Count
$notes = New-Object System.Collections.Generic.List[string]
for ($i = 1; $i -le $slideCount; $i++) {
  $slide = $pres.Slides.Item($i)
  $noteText = ''
  try {
    $notesShapes = $slide.NotesPage.Shapes
    for ($j = 1; $j -le $notesShapes.Count; $j++) {
      $sh = $notesShapes.Item($j)
      if ($sh.HasTextFrame -and $sh.PlaceholderFormat.Type -eq 2) {
        $noteText = $sh.TextFrame.TextRange.Text
      }
    }
  } catch {}
  $notes.Add($noteText)
  $slide.Export("${escapedFramesDir}\\slide-$i.png", "PNG", 1920, 1080)
}
$notesJoined = [string]::Join([char]0x1F, $notes)
Write-Output ($slideCount.ToString() + [char]0x1E + $notesJoined)
`
}

function gotoScript(page: number): string {
  // Targets the normal editing view (DocumentWindow.View), not a live fullscreen
  // SlideShowWindow — SlideShowSettings.Run() is declared and returns a non-null
  // object, but confirmed unreliable at actually producing a rendered fullscreen
  // show in this environment (same class of issue as Keynote's equivalent on
  // macOS: fullscreen exclusive mode is inherently fragile under automation/
  // virtualization). Not needed anyway: goTo(page) always receives an absolute
  // target page from the renderer, and Slide.Export() (used for frame capture)
  // works directly off Slides.Item(i) regardless of any live-show state — so
  // driving the editing view's current slide is sufficient for everything this
  // app actually needs.
  return `
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
$pres = $ppt.ActivePresentation
$pres.Windows.Item(1).View.GotoSlide(${page})
`
}

const CURRENT_SLIDE_SCRIPT = `
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
$pres = $ppt.ActivePresentation
Write-Output $pres.Windows.Item(1).View.Slide.SlideNumber
`

const POLL_INTERVAL_MS = 400

/** Bridges the renderer to a real, currently-open PowerPoint document via PowerShell
 *  COM automation — see the runPowerShell doc comment above for why -EncodedCommand
 *  over -File/-Command, and why this is a considerably more reliable API surface
 *  than powerpointBridgeMac.ts's AppleScript equivalent. */
export class PowerPointBridgeWindows extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null
  private lastKnownPage = 0

  async open(filePath: string): Promise<PowerPointOpenResult> {
    this.stopPolling()

    const framesDir = await mkdtemp(join(tmpdir(), 'presentation-commander-powerpoint-'))
    const raw = await runPowerShell(openAndReadScript(filePath, framesDir))
    const [slideCountStr, notesJoined] = raw.split(RECORD_SEP)
    const totalPages = parseInt(slideCountStr, 10)
    const notes = notesJoined ? notesJoined.split(UNIT_SEP) : []

    const notesBySlide: Record<number, string> = {}
    notes.forEach((note, i) => {
      if (note) notesBySlide[i + 1] = note
    })

    const frameFiles: string[] = []
    for (let i = 1; i <= totalPages; i++) {
      frameFiles.push(join(framesDir, `slide-${i}.png`))
    }

    this.lastKnownPage = 1
    this.startPolling()

    return { totalPages, notesBySlide, frameFiles }
  }

  async goTo(page: number): Promise<void> {
    this.lastKnownPage = page
    await runPowerShell(gotoScript(page))
  }

  /** Deliberately leaves PowerPoint and the open document alone — there's no live
   *  fullscreen show to stop (see gotoScript's doc comment), and force-closing the
   *  presenter's actual document/app on disconnect would risk losing unsaved
   *  changes they made directly in PowerPoint. Only the poll loop stops. */
  async close(): Promise<void> {
    this.stopPolling()
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      runPowerShell(CURRENT_SLIDE_SCRIPT)
        .then((raw) => {
          const page = parseInt(raw, 10)
          if (!Number.isNaN(page) && page !== this.lastKnownPage) {
            this.lastKnownPage = page
            this.emit('current-slide-changed', page)
          }
        })
        .catch((err) => console.error('[powerpoint-bridge-win] Failed to poll current slide:', err))
    }, POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }
}
