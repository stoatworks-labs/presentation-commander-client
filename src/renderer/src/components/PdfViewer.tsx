import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderPageToCanvas } from '../pdf'

interface Props {
  doc: PDFDocumentProxy | null
  currentPage: number
  totalPages: number
}

function SlideCanvas({
  doc,
  pageNumber,
  label
}: {
  doc: PDFDocumentProxy | null
  pageNumber: number | null
  label: string
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!doc || !pageNumber || !canvas || !container) return
    const targetWidth = container.clientWidth || 640
    renderPageToCanvas(doc, pageNumber, canvas, targetWidth).catch((err) =>
      console.error('Failed to render PDF page', err)
    )
  }, [doc, pageNumber])

  return (
    <div className="slide-slot">
      <div className="slide-slot-label">{label}</div>
      <div className="slide-slot-canvas" ref={containerRef}>
        {pageNumber ? <canvas ref={canvasRef} /> : <div className="slide-slot-empty">—</div>}
      </div>
    </div>
  )
}

function PdfViewer({ doc, currentPage, totalPages }: Props): React.JSX.Element {
  const nextPage = currentPage < totalPages ? currentPage + 1 : null

  return (
    <div className="pdf-viewer">
      <SlideCanvas doc={doc} pageNumber={doc ? currentPage : null} label="Now" />
      <SlideCanvas doc={doc} pageNumber={nextPage} label="Next" />
    </div>
  )
}

export default PdfViewer
