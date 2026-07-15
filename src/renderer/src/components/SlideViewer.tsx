import { useEffect, useRef } from 'react'
import type { SlideSource } from '../sources/types'

interface Props {
  source: SlideSource | null
  currentPage: number
  totalPages: number
}

function SlideCanvas({
  source,
  pageNumber,
  label
}: {
  source: SlideSource | null
  pageNumber: number | null
  label: string
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!source || !pageNumber || !canvas || !container) return
    const maxWidth = container.clientWidth || 640
    const maxHeight = container.clientHeight || 360
    source
      .renderFrame(pageNumber, canvas, maxWidth, maxHeight)
      .catch((err) => console.error('Failed to render slide', err))
  }, [source, pageNumber])

  return (
    <div className="slide-slot">
      <div className="slide-slot-label">{label}</div>
      <div className="slide-slot-canvas" ref={containerRef}>
        {pageNumber ? <canvas ref={canvasRef} /> : <div className="slide-slot-empty">—</div>}
      </div>
    </div>
  )
}

function SlideViewer({ source, currentPage, totalPages }: Props): React.JSX.Element {
  const nextPage = currentPage < totalPages ? currentPage + 1 : null

  return (
    <div className="pdf-viewer">
      <SlideCanvas source={source} pageNumber={source ? currentPage : null} label="Now" />
      <SlideCanvas source={source} pageNumber={nextPage} label="Next" />
    </div>
  )
}

export default SlideViewer
