export interface DetectedRegion {
  crop: { xPct: number; yPct: number; widthPct: number; heightPct: number }
  areaPct: number
}

const GRID_COLS = 160
const GRID_ROWS = 90
const BRIGHTNESS_THRESHOLD = 96 // luminance 0-255; Presenter Display's background is dark navy, slide content is typically light
const ASPECT_TOLERANCE = 0.2 // 20% relative tolerance vs. the deck's real slide aspect ratio
const MIN_AREA_FRACTION = 0.01 // ignore blobs smaller than 1% of the frame
const MIN_FILL_DENSITY = 0.6 // require the bounding box to be mostly bright, not just sparsely lit (filters out text/UI chrome)

/**
 * Finds candidate slide-shaped rectangles in a captured frame, so calibrating
 * a live-capture crop region (e.g. isolating the "next slide" box out of a
 * captured Presenter Display screen) doesn't require guessing percentages by
 * hand. Presenter Display's layout regions (Current Slide, Next Slide, etc.)
 * turned out not to be queryable via AppleScript or the accessibility tree —
 * confirmed live they're custom-rendered, not native UI elements — so this
 * works from pixels instead: downsamples to a coarse grid, thresholds on
 * brightness (slide content reads bright against the dark background),
 * finds connected bright blobs via flood fill, and keeps the ones whose
 * bounding-box aspect ratio is close to the deck's own known slide aspect
 * ratio (from Keynote's `document.width/height` or PowerPoint's
 * `PageSetup.SlideWidth/SlideHeight`). Heuristic, not exact — good enough to
 * pre-fill the crop fields for the user to nudge, not a guaranteed-correct
 * calibration.
 */
export function detectSlideRegions(
  sourceCanvas: HTMLCanvasElement,
  slideAspectRatio: number
): DetectedRegion[] {
  if (!sourceCanvas.width || !sourceCanvas.height || !slideAspectRatio) return []

  const sample = document.createElement('canvas')
  sample.width = GRID_COLS
  sample.height = GRID_ROWS
  const sctx = sample.getContext('2d')
  if (!sctx) return []
  sctx.drawImage(sourceCanvas, 0, 0, GRID_COLS, GRID_ROWS)
  const { data } = sctx.getImageData(0, 0, GRID_COLS, GRID_ROWS)

  const cellCount = GRID_COLS * GRID_ROWS
  const bright = new Uint8Array(cellCount)
  for (let i = 0; i < cellCount; i++) {
    const luminance = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    bright[i] = luminance > BRIGHTNESS_THRESHOLD ? 1 : 0
  }

  const visited = new Uint8Array(cellCount)
  const regions: DetectedRegion[] = []

  for (let start = 0; start < cellCount; start++) {
    if (!bright[start] || visited[start]) continue

    let minX = start % GRID_COLS
    let maxX = minX
    let minY = Math.floor(start / GRID_COLS)
    let maxY = minY
    let filled = 0
    const stack = [start]
    visited[start] = 1

    while (stack.length > 0) {
      const cur = stack.pop() as number
      const cx = cur % GRID_COLS
      const cy = Math.floor(cur / GRID_COLS)
      filled++
      if (cx < minX) minX = cx
      if (cx > maxX) maxX = cx
      if (cy < minY) minY = cy
      if (cy > maxY) maxY = cy

      const left = cx > 0 ? cur - 1 : -1
      const right = cx < GRID_COLS - 1 ? cur + 1 : -1
      const up = cy > 0 ? cur - GRID_COLS : -1
      const down = cy < GRID_ROWS - 1 ? cur + GRID_COLS : -1
      for (const n of [left, right, up, down]) {
        if (n >= 0 && bright[n] && !visited[n]) {
          visited[n] = 1
          stack.push(n)
        }
      }
    }

    const blobWidth = maxX - minX + 1
    const blobHeight = maxY - minY + 1
    const areaFraction = (blobWidth * blobHeight) / cellCount
    if (areaFraction < MIN_AREA_FRACTION) continue

    const blobAspect = blobWidth / blobHeight
    if (Math.abs(blobAspect - slideAspectRatio) / slideAspectRatio > ASPECT_TOLERANCE) continue

    const density = filled / (blobWidth * blobHeight)
    if (density < MIN_FILL_DENSITY) continue

    regions.push({
      crop: {
        xPct: (minX / GRID_COLS) * 100,
        yPct: (minY / GRID_ROWS) * 100,
        widthPct: (blobWidth / GRID_COLS) * 100,
        heightPct: (blobHeight / GRID_ROWS) * 100
      },
      areaPct: areaFraction * 100
    })
  }

  return regions.sort((a, b) => b.areaPct - a.areaPct)
}
