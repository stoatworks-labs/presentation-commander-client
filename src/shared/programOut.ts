/**
 * What the Program Out window renders. PDF sources push raw PDF bytes and
 * let Program Out re-render via pdf.js (existing behavior). Sources with
 * no PDF document to hand over (Keynote, and eventually PowerPoint/Google
 * Slides/Canva) push a file:// URL to a pre-rendered image instead.
 */
export type ProgramOutState =
  | { kind: 'pdf'; data: string; currentPage: number }
  | { kind: 'image'; fileUrl: string; currentPage: number }
