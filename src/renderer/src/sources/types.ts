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

  dispose(): void
}
