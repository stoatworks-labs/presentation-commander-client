import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'

const execFileAsync = promisify(execFile)

/**
 * Keynote has no push API for its own state, so control/introspection all
 * goes through `osascript`. JXA (not AppleScript) so results come back as
 * real JSON instead of hand-parsed AppleScript list text. Script source is
 * passed via `-e` and args via argv — execFile never touches a shell, so
 * file paths with spaces/quotes need no escaping.
 */
async function runJxa(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script, ...args])
  return stdout.trim()
}

const OPEN_AND_EXPORT_SCRIPT = `
function run(argv) {
  const filePath = argv[0]
  const framesDir = argv[1]
  const Keynote = Application('Keynote')
  Keynote.activate()
  const doc = Keynote.open(Path(filePath))
  const slides = doc.slides()
  const notes = slides.map((s) => s.presenterNotes())
  doc.export({ to: Path(framesDir), as: 'slide images' })
  return JSON.stringify({
    totalPages: slides.length,
    notes: notes,
    slideWidth: doc.width(),
    slideHeight: doc.height()
  })
}
`

const GOTO_SCRIPT = `
function run(argv) {
  const page = parseInt(argv[0], 10)
  const Keynote = Application('Keynote')
  const doc = Keynote.documents[0]
  const slide = doc.slides[page - 1]
  if (Keynote.playing()) {
    Keynote.show(slide)
  } else {
    Keynote.start(doc, { from: slide })
  }
}
`

const CURRENT_SLIDE_SCRIPT = `
function run(argv) {
  const Keynote = Application('Keynote')
  const doc = Keynote.documents[0]
  return String(doc.currentSlide().slideNumber())
}
`

const STOP_SCRIPT = `
function run(argv) {
  const Keynote = Application('Keynote')
  if (Keynote.playing()) Keynote.stop()
}
`

const POLL_INTERVAL_MS = 400

export interface KeynoteOpenResult {
  totalPages: number
  notesBySlide: Record<number, string>
  /** Absolute paths to the exported slide PNGs, in slide order (index 0 = slide 1). */
  frameFiles: string[]
  /** The deck's own slide dimensions (points) — used to constrain region-detection to the slide's real aspect ratio. */
  slideWidth: number
  slideHeight: number
}

/** Sorts by the first number found in each filename, so "2.png" < "10.png" regardless of padding. */
function byLeadingNumber(a: string, b: string): number {
  const numA = parseInt(a.match(/\d+/)?.[0] ?? '0', 10)
  const numB = parseInt(b.match(/\d+/)?.[0] ?? '0', 10)
  return numA - numB
}

/** Bridges the renderer to a real, currently-open Keynote document via osascript/JXA. */
class KeynoteBridge extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null
  private lastKnownPage = 0

  async open(filePath: string): Promise<KeynoteOpenResult> {
    this.stopPolling()
    const framesDir = await mkdtemp(join(tmpdir(), 'presentation-commander-keynote-'))

    const raw = await runJxa(OPEN_AND_EXPORT_SCRIPT, [filePath, framesDir])
    const parsed = JSON.parse(raw) as {
      totalPages: number
      notes: string[]
      slideWidth: number
      slideHeight: number
    }

    const notesBySlide: Record<number, string> = {}
    parsed.notes.forEach((note, i) => {
      if (note) notesBySlide[i + 1] = note
    })

    const entries = await readdir(framesDir)
    const frameFiles = entries.sort(byLeadingNumber).map((entry) => join(framesDir, entry))

    this.lastKnownPage = 1
    this.startPolling()

    return {
      totalPages: parsed.totalPages,
      notesBySlide,
      frameFiles,
      slideWidth: parsed.slideWidth,
      slideHeight: parsed.slideHeight
    }
  }

  async goTo(page: number): Promise<void> {
    this.lastKnownPage = page
    await runJxa(GOTO_SCRIPT, [String(page)])
  }

  async close(): Promise<void> {
    this.stopPolling()
    try {
      await runJxa(STOP_SCRIPT)
    } catch (err) {
      console.error('[keynote-bridge] Failed to stop slideshow on close:', err)
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      runJxa(CURRENT_SLIDE_SCRIPT)
        .then((raw) => {
          const page = parseInt(raw, 10)
          if (!Number.isNaN(page) && page !== this.lastKnownPage) {
            this.lastKnownPage = page
            this.emit('current-slide-changed', page)
          }
        })
        .catch((err) => console.error('[keynote-bridge] Failed to poll current slide:', err))
    }, POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }
}

export const keynoteBridge = new KeynoteBridge()
