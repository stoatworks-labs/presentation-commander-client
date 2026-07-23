/** A named range of slides. Only PDF (via its outline/bookmarks) and
 * PowerPoint on Windows (via native COM SectionProperties) can populate
 * this — Keynote has no native section feature, Google Slides/Canva have
 * no section concept in their APIs either, and PowerPoint on Mac's
 * AppleScript dictionary doesn't expose sections the way Windows COM does. */
export interface OscSection {
  name: string
  firstSlide: number
  lastSlide: number
  slideCount: number
}
