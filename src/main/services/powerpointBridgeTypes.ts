export interface PowerPointOpenResult {
  totalPages: number
  notesBySlide: Record<number, string>
  /** Absolute paths to the exported slide PNGs, in slide order (index 0 = slide 1). */
  frameFiles: string[]
}
