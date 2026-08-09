import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ProgramOutState, LaserPosition } from '../../shared/programOut'
import { DEFAULT_TRANSITION } from '../../shared/transitions'
import './App.css'
import { loadPdf, renderPageContain } from './pdf'
import { transitionToSlide } from './transitions'

function ProgramOut(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [state, setState] = useState<ProgramOutState | null>(null)
  const [laserPosition, setLaserPosition] = useState<LaserPosition | null>(null)
  const lastPdfDataRef = useRef<string | null>(null)
  // A freshly opened deck cuts rather than transitioning: swapping documents
  // is a reset, not a slide change, and dissolving from someone else's last
  // slide into a new deck's first one reads as a mistake.
  const deckChangedRef = useRef(true)

  useEffect(() => {
    return window.api.programOut.onState((next) => {
      setState(next)
      if (next.kind === 'pdf' && next.data !== lastPdfDataRef.current) {
        lastPdfDataRef.current = next.data
        deckChangedRef.current = true
        loadPdf(next.data).then(setDoc)
      }
    })
  }, [])

  useEffect(() => {
    return window.api.programOut.onLaserPosition(setLaserPosition)
  }, [])

  // What's currently drawn, so a state push that changed something unrelated
  // (a laser toggle, or the transition settings themselves) doesn't re-render
  // — and, worse, doesn't play a transition from a slide to itself.
  const lastRenderRef = useRef<{
    canvas: HTMLCanvasElement
    doc: PDFDocumentProxy
    page: number
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!doc || state?.kind !== 'pdf' || !canvas || !frame) return
    if ((state.screenBlank ?? 'none') !== 'none') return
    // Nothing useful can be rendered into a window with no size (not yet laid
    // out, or hidden). Bail *before* recording it as rendered, so the next
    // state push tries again — otherwise the slide would never appear.
    if (window.innerWidth < 1 || window.innerHeight < 1) return

    const last = lastRenderRef.current
    if (last && last.canvas === canvas && last.doc === doc && last.page === state.currentPage)
      return

    const page = state.currentPage
    lastRenderRef.current = { canvas, doc, page }

    const render = (): Promise<void> =>
      renderPageContain(doc, page, canvas, window.innerWidth, window.innerHeight)

    // The canvas is remounted from scratch coming back from a blank, or from
    // an image-kind source, so there's nothing on it to transition from.
    const cut = deckChangedRef.current || last?.canvas !== canvas
    deckChangedRef.current = false

    const settings = cut
      ? { ...DEFAULT_TRANSITION, effect: 'cut' as const }
      : (state.transition ?? DEFAULT_TRANSITION)

    transitionToSlide(frame, canvas, settings, render).catch((err) =>
      console.error('Failed to render program-out page', err)
    )
  }, [doc, state])

  const blank = state?.screenBlank ?? 'none'
  const showLaser = state?.laserPointerEnabled && blank === 'none' && laserPosition

  return (
    <div
      className={`program-out-shell${state?.hideCursor ? ' program-out-shell--no-cursor' : ''}`}
      style={
        blank === 'black'
          ? { background: '#000' }
          : blank === 'white'
            ? { background: '#fff' }
            : undefined
      }
    >
      {blank !== 'none' ? null : state?.kind === 'pdf' && doc ? (
        <div className="program-out-canvas-frame" ref={frameRef}>
          <canvas ref={canvasRef} />
          {showLaser && (
            <div
              className="laser-dot"
              style={{ left: `${laserPosition.xPct}%`, top: `${laserPosition.yPct}%` }}
            />
          )}
        </div>
      ) : state?.kind === 'image' ? (
        <div className="program-out-canvas-frame">
          <img src={state.fileUrl} alt="" />
          {showLaser && (
            <div
              className="laser-dot"
              style={{ left: `${laserPosition.xPct}%`, top: `${laserPosition.yPct}%` }}
            />
          )}
        </div>
      ) : (
        <div className="program-out-empty">No Program</div>
      )}
    </div>
  )
}

export default ProgramOut
