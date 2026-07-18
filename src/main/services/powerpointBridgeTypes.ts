export interface PowerPointOpenResult {
  totalPages: number
  notesBySlide: Record<number, string>
  /** Absolute paths to the exported slide PNGs, in slide order (index 0 = slide 1). */
  frameFiles: string[]
  /** The deck's own slide dimensions — used to constrain region-detection to the slide's real aspect ratio. Units differ per platform (EMU on Mac, points on Windows) but only the ratio matters. */
  slideWidth: number
  slideHeight: number
}
