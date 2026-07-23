import type { OscArg, OscAction } from '../../../shared/osc'
import type { ScreenBlank } from '../../../shared/programOut'
import type { OscSection } from '../../../shared/sections'

export interface OscMessage {
  address: string
  args: OscArg[]
}

/** Everything the dispatcher/feedback-builders need to know about current
 * app state — a plain snapshot, not a live subscription, so callers can
 * read it from a ref without worrying about stale closures. */
export interface OscSnapshot {
  currentPage: number
  totalPages: number
  notesBySlide: Record<number, string>
  fileName: string | null
  filePath: string | null
  sourceKind: string | null
  screenBlank: ScreenBlank
  programOutOpen: boolean
  actionsEnabled: boolean
  feedbacksEnabled: boolean
  filesEnabled: boolean
  filesFolderRelative: string | null
  filesFolderFullPath: string | null
  sections: OscSection[]
  laserPointerEnabled: boolean
  /** Total duration (ms) of the current page's media, or null if there is
   * none / it can't be determined — see SlideSource.getMediaDuration's doc
   * comment for why position/remaining/state aren't tracked alongside it. */
  mediaDurationMs: number | null
  /** Whether the presenter has turned on timed auto-advance at all —
   * pause/resume only make sense (and only take effect) once this is
   * true: pause/resume suspend an *already-configured* auto-advance
   * timer, they don't turn the feature on from cold. */
  autoAdvanceEnabled: boolean
  autoAdvancePaused: boolean
}

export interface OscHandlers {
  goToPage(page: number): void
  nextPage(): void
  previousPage(): void
  setScreenBlank(next: ScreenBlank): void
  openProgramOut(): void
  closeProgramOut(): void
  setLaserPointerEnabled(enabled: boolean): void
  /** Renders whatever's on screen right now to width x height (default
   * 1920x1080 if either is omitted) and sets it as the desktop wallpaper. */
  setWallpaper(width?: number, height?: number): void
  /** No-op when autoAdvanceEnabled is false — checked by the dispatcher. */
  setAutoAdvancePaused(paused: boolean): void
  setActionsEnabled(enabled: boolean): void
  setFeedbacksEnabled(enabled: boolean): void
  /** All four call through to the same underlying toggle on every source
   * that implements media control today (see SlideSource.mediaPlay's doc
   * comment) — kept as four separate slots since the OSC addresses
   * themselves are distinct, and a future source might genuinely
   * distinguish them. */
  mediaPlay(): void
  mediaPause(): void
  mediaPlayPause(): void
  mediaStop(): void
  /** Resend the full current feedback state right now — used both for the
   * explicit feedbacks/refresh action and the "also triggers a refresh"
   * behavior feedbacks/enable carries. Always sends, regardless of the
   * feedbacksEnabled flag, since it's an explicit, deliberate request. */
  refreshFeedback(): void
  /** All three are no-ops when filesEnabled is false — checked by the
   * dispatcher before calling any of these, not by the handlers themselves. */
  setFilesPath(relativeToHome: string): void
  requestFilesList(): void
  openFileByName(filename: string): void
}

function argInt(value: number): OscArg {
  return { type: 'integer', value }
}

function argStr(value: string): OscArg {
  return { type: 'string', value }
}

function argBlobUtf8(value: string): OscArg {
  const bytes = new TextEncoder().encode(value)
  return { type: 'blob', value: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
}

function argToNumber(arg: OscArg | undefined): number | undefined {
  if (!arg || Array.isArray((arg as { value?: unknown }).value)) return undefined
  if (arg.type === 'integer' || arg.type === 'float' || arg.type === 'double') return arg.value
  if (arg.type === 'bigint') return Number(arg.value)
  return undefined
}

function argToBoolean(arg: OscArg | undefined): boolean | undefined {
  const n = argToNumber(arg)
  if (n !== undefined) return n !== 0
  if (arg?.type === 'true') return true
  if (arg?.type === 'false') return false
  return undefined
}

function argBool(value: boolean): OscArg {
  return value ? { type: 'true', value: true } : { type: 'false', value: false }
}

/** String args can arrive as ASCII (`string` type) or UTF-8 (`blob` type) —
 * accept either. */
function argToString(arg: OscArg | undefined): string | undefined {
  if (!arg) return undefined
  if (arg.type === 'string' || arg.type === 'symbol' || arg.type === 'character') return arg.value
  if (arg.type === 'blob') {
    return new TextDecoder('utf-8').decode(
      new Uint8Array(arg.value.buffer, arg.value.byteOffset, arg.value.byteLength)
    )
  }
  return undefined
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(Math.round(page), 1), Math.max(totalPages, 1))
}

function resolveBlankToggle(
  arg: OscArg | undefined,
  color: 'black' | 'white',
  current: ScreenBlank
): ScreenBlank {
  const on = argToBoolean(arg)
  if (on === undefined) return current === color ? 'none' : color
  return on ? color : 'none'
}

function slideshowStateValue(s: OscSnapshot): 'edit' | 'running' | 'paused' {
  if (!s.programOutOpen) return 'edit'
  return s.autoAdvanceEnabled && s.autoAdvancePaused ? 'paused' : 'running'
}

/** Builds the /presentcommander/presentation + presentation/* feedback messages. */
export function presentationFeedback(s: OscSnapshot): OscMessage[] {
  const presentationJson = JSON.stringify({
    name: s.fileName ?? '',
    path: s.filePath ?? '',
    slideCount: s.totalPages,
    saved: true,
    active: s.totalPages > 0,
    slideshow: s.programOutOpen,
    sections: s.sections.length ? s.sections.map((sec, i) => ({ id: String(i), ...sec })) : null
  })
  return [
    { address: '/presentcommander/presentation', args: [argStr(presentationJson)] },
    { address: '/presentcommander/presentation/name', args: [argStr(s.fileName ?? '')] },
    { address: '/presentcommander/presentation/slides/count', args: [argInt(s.totalPages)] },
    {
      address: '/presentcommander/presentation/slides/count/visible',
      args: [argInt(s.totalPages)]
    },
    { address: '/presentcommander/slideshow/state', args: [argStr(slideshowStateValue(s))] }
  ]
}

/** Builds the slideshow/currentslide + slidesremaining feedback messages —
 * only meaningful once a source with real pages is loaded. */
export function slideFeedback(s: OscSnapshot): OscMessage[] {
  if (s.totalPages === 0) return []
  return [
    { address: '/presentcommander/slideshow/currentslide', args: [argInt(s.currentPage)] },
    {
      address: '/presentcommander/slideshow/slidesremaining',
      args: [argInt(Math.max(s.totalPages - s.currentPage, 0))]
    }
  ]
}

/** Builds the notes feedback pair (ASCII string + UTF-8 blob), for
 * non-ASCII-safe text. */
export function notesFeedback(s: OscSnapshot): OscMessage[] {
  if (s.totalPages === 0) return []
  const notes = s.notesBySlide[s.currentPage] ?? ''
  return [
    { address: '/presentcommander/slideshow/notes', args: [argStr(notes)] },
    { address: '/presentcommander/slideshow/notes-utf8', args: [argBlobUtf8(notes)] }
  ]
}

/** Builds the slideshow/section/* feedback messages — only sent when the
 * current page actually falls inside a known section (no fabricated
 * section-of-1 data when there are no sections). */
export function sectionFeedback(s: OscSnapshot): OscMessage[] {
  const index = s.sections.findIndex(
    (sec) => s.currentPage >= sec.firstSlide && s.currentPage <= sec.lastSlide
  )
  if (index === -1) return []
  const section = s.sections[index]
  return [
    { address: '/presentcommander/slideshow/section/index', args: [argInt(index + 1)] },
    { address: '/presentcommander/slideshow/section/name', args: [argStr(section.name)] },
    {
      address: '/presentcommander/slideshow/section/slidesremaining',
      args: [argInt(Math.max(section.lastSlide - s.currentPage, 0))]
    }
  ]
}

/** Builds the /presentcommander/files/* feedback messages. */
export function filesFeedback(s: OscSnapshot): OscMessage[] {
  return [
    { address: '/presentcommander/files/enabled', args: [argBool(s.filesEnabled)] },
    {
      address: '/presentcommander/files/activefolder',
      args: [argStr(s.filesFolderRelative ?? '')]
    },
    {
      address: '/presentcommander/files/activefolder/fullpath',
      args: [argStr(s.filesFolderFullPath ?? '')]
    }
  ]
}

/** Builds the media/duration feedback — only sent when a duration is
 * actually known (see OscSnapshot.mediaDurationMs's doc comment for why
 * state/position/remaining/durationtrimmed/startpoint/endpoint aren't
 * included alongside it). */
export function mediaFeedback(s: OscSnapshot): OscMessage[] {
  if (s.mediaDurationMs === null) return []
  return [
    { address: '/presentcommander/slideshow/media/duration', args: [argInt(s.mediaDurationMs)] }
  ]
}

export function allFeedback(s: OscSnapshot): OscMessage[] {
  return [
    ...presentationFeedback(s),
    ...slideFeedback(s),
    ...notesFeedback(s),
    ...sectionFeedback(s),
    ...filesFeedback(s),
    ...mediaFeedback(s)
  ]
}

/**
 * Dispatches one inbound OSC message to the app. Addresses this app can't
 * fulfill for the current source (sections, media — see each SlideSource
 * implementation's optional methods) simply aren't implemented — they fall
 * through the switch's default case and are silently ignored, not treated
 * as an error.
 */
export function handleOscAction(
  action: OscAction,
  snapshot: OscSnapshot,
  handlers: OscHandlers
): void {
  const { address, args } = action

  // Every message except this one is ignored while actions are disabled.
  if (address === '/presentcommander/actions/enable') {
    handlers.setActionsEnabled(true)
    return
  }
  if (!snapshot.actionsEnabled) return

  switch (address) {
    case '/presentcommander/actions/disable':
      handlers.setActionsEnabled(false)
      return
    case '/presentcommander/feedbacks/enable':
      handlers.setFeedbacksEnabled(true)
      handlers.refreshFeedback()
      return
    case '/presentcommander/feedbacks/disable':
      handlers.setFeedbacksEnabled(false)
      return
    case '/presentcommander/feedbacks/refresh':
      handlers.refreshFeedback()
      return
    case '/presentcommander/next':
      handlers.nextPage()
      return
    case '/presentcommander/previous':
      handlers.previousPage()
      return
    case '/presentcommander/goto/slide/first':
      handlers.goToPage(1)
      return
    case '/presentcommander/goto/slide/last':
      handlers.goToPage(snapshot.totalPages)
      return
    case '/presentcommander/goto/section': {
      // Case-sensitive; does nothing if the name isn't found rather than
      // erroring.
      const name = argToString(args[0])
      if (name === undefined) return
      const section = snapshot.sections.find((sec) => sec.name === name)
      if (!section) return
      handlers.goToPage(section.firstSlide)
      return
    }
    case '/presentcommander/goto/slide': {
      const n = argToNumber(args[0])
      if (n === undefined) return
      handlers.goToPage(clampPage(n, snapshot.totalPages))
      return
    }
    case '/presentcommander/slideshow/start': {
      handlers.openProgramOut()
      const n = argToNumber(args[0])
      handlers.goToPage(n !== undefined ? clampPage(n, snapshot.totalPages) : 1)
      return
    }
    case '/presentcommander/slideshow/start/current':
      handlers.openProgramOut()
      return
    case '/presentcommander/slideshow/end':
      handlers.closeProgramOut()
      return
    case '/presentcommander/slideshow/black':
      handlers.setScreenBlank(resolveBlankToggle(args[0], 'black', snapshot.screenBlank))
      return
    case '/presentcommander/slideshow/white':
      handlers.setScreenBlank(resolveBlankToggle(args[0], 'white', snapshot.screenBlank))
      return
    case '/presentcommander/slideshow/laserpointer': {
      const on = argToBoolean(args[0])
      handlers.setLaserPointerEnabled(on === undefined ? !snapshot.laserPointerEnabled : on)
      return
    }
    case '/presentcommander/slideshow/setwallpaper':
      handlers.setWallpaper(argToNumber(args[0]), argToNumber(args[1]))
      return
    case '/presentcommander/slideshow/pause':
      if (!snapshot.autoAdvanceEnabled) return
      handlers.setAutoAdvancePaused(true)
      return
    case '/presentcommander/slideshow/resume':
      if (!snapshot.autoAdvanceEnabled) return
      handlers.setAutoAdvancePaused(false)
      return
    case '/presentcommander/files/setpath': {
      if (!snapshot.filesEnabled) return
      const path = argToString(args[0])
      if (path === undefined) return
      handlers.setFilesPath(path)
      return
    }
    case '/presentcommander/files/list':
      if (!snapshot.filesEnabled) return
      handlers.requestFilesList()
      return
    case '/presentcommander/files/open': {
      if (!snapshot.filesEnabled) return
      const filename = argToString(args[0])
      if (filename === undefined) return
      handlers.openFileByName(filename)
      return
    }
    case '/presentcommander/media/play':
      handlers.mediaPlay()
      return
    case '/presentcommander/media/pause':
      handlers.mediaPause()
      return
    case '/presentcommander/media/playpause':
      handlers.mediaPlayPause()
      return
    case '/presentcommander/media/stop':
      handlers.mediaStop()
      return
    default:
      return
  }
}
