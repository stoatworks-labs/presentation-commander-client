import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import './App.css'
import { loadPdf, renderPageContain } from './pdf'

function ProgramOut(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState<number | null>(null)
  const lastDataRef = useRef<string | null>(null)

  useEffect(() => {
    return window.api.programOut.onState((state) => {
      setCurrentPage(state.currentPage)
      if (state.data !== lastDataRef.current) {
        lastDataRef.current = state.data
        loadPdf(state.data).then(setDoc)
      }
    })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || !currentPage || !canvas) return
    renderPageContain(doc, currentPage, canvas, window.innerWidth, window.innerHeight).catch(
      (err) => console.error('Failed to render program-out page', err)
    )
  }, [doc, currentPage])

  return (
    <div className="program-out-shell">
      {doc && currentPage ? (
        <canvas ref={canvasRef} />
      ) : (
        <div className="program-out-empty">No Program</div>
      )}
    </div>
  )
}

export default ProgramOut
