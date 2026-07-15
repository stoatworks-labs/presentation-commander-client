import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ProgramOutState } from '../../shared/programOut'
import './App.css'
import { loadPdf, renderPageContain } from './pdf'

function ProgramOut(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [state, setState] = useState<ProgramOutState | null>(null)
  const lastPdfDataRef = useRef<string | null>(null)

  useEffect(() => {
    return window.api.programOut.onState((next) => {
      setState(next)
      if (next.kind === 'pdf' && next.data !== lastPdfDataRef.current) {
        lastPdfDataRef.current = next.data
        loadPdf(next.data).then(setDoc)
      }
    })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || state?.kind !== 'pdf' || !canvas) return
    renderPageContain(doc, state.currentPage, canvas, window.innerWidth, window.innerHeight).catch(
      (err) => console.error('Failed to render program-out page', err)
    )
  }, [doc, state])

  return (
    <div className="program-out-shell">
      {state?.kind === 'pdf' && doc ? (
        <canvas ref={canvasRef} />
      ) : state?.kind === 'image' ? (
        <img src={state.fileUrl} alt="" />
      ) : (
        <div className="program-out-empty">No Program</div>
      )}
    </div>
  )
}

export default ProgramOut
