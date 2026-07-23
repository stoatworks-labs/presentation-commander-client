import type { ProgramOutState } from '../../../shared/programOut'
import type { OscSection } from '../../../shared/sections'
import type { PageLinksResult } from '../pdf'

/**
 * A SlideSource is whatever is currently driving the presentation — a PDF
 * rendered locally, or (eventually) a live Keynote/PowerPoint/Google
 * Slides/Canva deck being remote-controlled. App.tsx keeps owning the
 * reactive state (currentPage, totalPages, notesBySlide) exactly as it
 * does today; a SlideSource is just the strategy for rendering a given
 * page and, where the underlying app has independent state of its own
 * (Keynote), keeping it in sync. This keeps the refactor small: only the
 * pdf.js-specific calls in App.tsx's effects get replaced with calls
 * through this interface.
 */
export interface SlideSource {
  readonly kind: 'pdf' | 'keynote' | 'powerpoint' | 'google-slides' | 'canva'

  /** Draws `page` onto `canvas`, scaled to fit within maxWidth x maxHeight. */
  renderFrame(
    page: number,
    canvas: HTMLCanvasElement,
    maxWidth: number,
    maxHeight: number
  ): Promise<void>

  /** Navigates to `page` (1-indexed). Drives the underlying app too, if it has one; no-op for PDF. */
  goTo(page: number): Promise<void>

  /**
   * Subscribes to page changes the source detects on its own (e.g. the
   * presenter advancing Keynote directly rather than through our UI).
   * Returns an unsubscribe function. No-op subscription for PDF.
   */
  onExternalPageChange(callback: (page: number) => void): () => void

  /** What Program Out should render for `page` — see shared/programOut.ts. */
  getProgramOutPayload(page: number): ProgramOutState

  /**
   * Internal "jump to page" links authored into the source itself (PDF
   * table-of-contents / "back to agenda" links). Only meaningful for
   * sources with real page content to scan for annotations — omitted
   * entirely (not just returning an empty result) for sources where the
   * concept doesn't apply, e.g. Keynote/PowerPoint/Google Slides/Canva.
   */
  getLinks?(page: number): Promise<PageLinksResult>

  /**
   * OSCPoint's "section" concept, mapped from whatever the underlying
   * source has a native equivalent of. Omitted entirely for sources with
   * no such concept (Keynote, Google Slides, Canva, and PowerPoint on Mac
   * — see shared/sections.ts) rather than returning an empty array, so
   * the dispatcher can tell "no sections exist" apart from "this source
   * doesn't support sections at all" if that distinction ever matters.
   */
  getSections?(): Promise<OscSection[]>

  /**
   * OSCPoint's media-control actions (/oscpoint/media/play|pause|stop).
   * Only implemented for PowerPoint on Windows, via a keyboard-shortcut
   * toggle that requires the presenter to have a live PowerPoint slideshow
   * running independently of this bridge (see powerpointBridgeWin.ts's
   * MEDIA_TOGGLE_SCRIPT doc comment) — a real, working path for that case,
   * not a stub. Not implementable anywhere else:
   *   - PDF: pdf.js has no embedded-video playback model at all.
   *   - Keynote: confirmed via direct inspection of Keynote.sdef that its
   *     `movie` class exposes zero playback commands (only static
   *     properties — file name, volume, opacity, rotation).
   *   - PowerPoint on Mac: confirmed via direct inspection of
   *     PowerPoint.sdef that its media object classes expose only
   *     read-only file-name/link properties — even less than Keynote.
   *   - Google Slides / Canva: not attempted in this pass.
   * There's no separate play-only/pause-only shortcut and no documented
   * way to query current playback state via COM, so all three call the
   * same underlying toggle — a real, disclosed limitation, not a bug.
   * Seeking (/media/goto/position/*) and bookmark navigation
   * (/media/goto/bookmark/*) aren't exposed here at all, on any source —
   * no known automation technique reaches them even where play/pause/stop
   * might.
   */
  mediaPlay?(): Promise<void>
  mediaPause?(): Promise<void>
  mediaStop?(): Promise<void>

  /**
   * Total duration (milliseconds) of the first media shape on `page`, or
   * null if that slide has none. Only implemented for PowerPoint, via the
   * real, documented `Shape.MediaFormat.Length` COM property — works
   * against the plain Slides collection, no live slideshow required
   * (unlike mediaPlay/mediaPause/mediaStop above). Position/remaining/state
   * aren't exposed anywhere: no equivalently-documented COM property for a
   * live video's current playback position was found.
   */
  getMediaDuration?(page: number): Promise<number | null>

  dispose(): void
}
