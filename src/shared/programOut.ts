/** Blanks the Program Out window to a solid color instead of the current
 * slide — matches PowerPoint's "B"/"W" presenter shortcuts, for hiding
 * content without losing your place. */
export type ScreenBlank = 'none' | 'black' | 'white'

/**
 * What the Program Out window renders. PDF sources push raw PDF bytes and
 * let Program Out re-render via pdf.js (existing behavior). Sources with
 * no PDF document to hand over (Keynote, and eventually PowerPoint/Google
 * Slides/Canva) push a file:// URL to a pre-rendered image instead.
 *
 * screenBlank/hideCursor are display-level concerns independent of which
 * source produced the slide, so App.tsx's pushState call site sets them
 * directly rather than every SlideSource.getProgramOutPayload() knowing
 * about them.
 */
export type ProgramOutState = (
  | { kind: 'pdf'; data: string; currentPage: number }
  | { kind: 'image'; fileUrl: string; currentPage: number }
) & {
  screenBlank?: ScreenBlank
  /** Hides the OS mouse cursor while it's over the Program Out window. */
  hideCursor?: boolean
}
