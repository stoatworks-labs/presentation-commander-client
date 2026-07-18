import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '../../shared/protocol'
import type { SlideSource } from './sources/types'
import './App.css'
import { loadPdf } from './pdf'
import { createPdfSource } from './sources/pdfSource'
import { createKeynoteSource } from './sources/keynoteSource'
import { createPowerPointSource } from './sources/powerpointSource'
import { createGoogleSlidesSource } from './sources/googleSlidesSource'
import { createCanvaSource } from './sources/canvaSource'
import SlideViewer from './components/SlideViewer'
import NotesPanel from './components/NotesPanel'
import Transport from './components/Transport'
import ConnectionPanel from './components/ConnectionPanel'
import ProgramOutControl from './components/ProgramOutControl'
import NdiOutputControl from './components/NdiOutputControl'
import GoogleSlidesSetup from './components/GoogleSlidesSetup'
import LiveCaptureControl from './components/LiveCaptureControl'
import { createLiveCapture } from './liveCapture'
import type { CropRect } from './liveCapture'

const NDI_STREAM_PROGRAM = 'program'
const NDI_STREAM_NEXT = 'next'
const LIVE_CAPTURE_FPS = 30

function App(): React.JSX.Element {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<SlideSource | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [notesBySlide, setNotesBySlide] = useState<Record<number, string>>({})

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [host, setHost] = useState('localhost:9800')
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<'windows' | 'macos'>('macos')
  const [ndiActive, setNdiActive] = useState(false)
  const ndiCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const [nextNdiActive, setNextNdiActive] = useState(false)
  const nextNdiCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const [showGoogleSlidesSetup, setShowGoogleSlidesSetup] = useState(false)

  // Live capture: an alternative, genuinely-live source for the Program/Next
  // NDI streams (real animations/transitions/video, unlike the rest of the
  // SlideSource pipeline's pre-exported static PNGs) — see liveCapture.ts.
  // Only relevant for Keynote/PowerPoint, and only engaged when the operator
  // explicitly picks a screen to capture; falls back to the existing static
  // render path otherwise, so nothing about PDF/Slides/Canva changes.
  const [programCaptureActive, setProgramCaptureActive] = useState(false)
  const [nextCaptureActive, setNextCaptureActive] = useState(false)
  const [programCaptureCrop, setProgramCaptureCrop] = useState<CropRect | null>(null)
  const [nextCaptureCrop, setNextCaptureCrop] = useState<CropRect | null>(null)
  // The deck's own slide aspect ratio (width/height) — lets LiveCaptureControl's
  // "Detect Regions" feature constrain its search to boxes that actually look
  // like a slide, instead of guessing blindly. Only Keynote/PowerPoint sources
  // set this (from the bridge's open() result); null elsewhere.
  const [slideAspectRatio, setSlideAspectRatio] = useState<number | null>(null)
  const programCaptureHandleRef = useRef(createLiveCapture())
  const nextCaptureHandleRef = useRef(createLiveCapture())

  // Stop any live capture whenever the active source changes (switching
  // decks, switching apps, or closing down) — otherwise a MediaStream would
  // keep capturing the screen indefinitely after it's no longer relevant.
  useEffect(() => {
    const programHandle = programCaptureHandleRef.current
    const nextHandle = nextCaptureHandleRef.current
    return () => {
      programHandle.stop()
      setProgramCaptureActive(false)
      nextHandle.stop()
      setNextCaptureActive(false)
    }
  }, [activeSource])

  const totalPagesRef = useRef(0)
  useEffect(() => {
    totalPagesRef.current = totalPages
  }, [totalPages])

  useEffect(() => {
    window.api.system.info().then((info) => {
      setName(info.hostname)
      setPlatform(info.platform)
    })
    return window.api.server.onStatus(setStatus)
  }, [])

  useEffect(() => {
    if (!activeSource || !currentPage) return
    window.api.programOut.pushState(activeSource.getProgramOutPayload(currentPage))
  }, [activeSource, currentPage])

  useEffect(() => {
    window.api.ndiOutput.isActive(NDI_STREAM_PROGRAM).then(setNdiActive)
    window.api.ndiOutput.isActive(NDI_STREAM_NEXT).then(setNextNdiActive)
  }, [])

  useEffect(() => {
    if (!ndiActive || !activeSource || !currentPage || programCaptureActive) return
    const canvas = ndiCanvasRef.current
    activeSource
      .renderFrame(currentPage, canvas, 1920, 1080)
      .then(() => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        window.api.ndiOutput.pushFrame(
          NDI_STREAM_PROGRAM,
          new Uint8Array(imageData.data.buffer),
          canvas.width,
          canvas.height
        )
      })
      .catch((err) => console.error('Failed to render frame for NDI output', err))
  }, [ndiActive, activeSource, currentPage, programCaptureActive])

  // Live-capture push loop: unlike the static-render effect above (which
  // only needs to push a new frame when the page changes), a captured
  // display is continuously changing, so this ticks on an interval instead
  // of a dependency change.
  useEffect(() => {
    if (!ndiActive || !programCaptureActive) return
    const canvas = ndiCanvasRef.current
    const handle = programCaptureHandleRef.current
    const timer = setInterval(() => {
      if (!handle.drawCurrentFrame(canvas, 1920, 1080, programCaptureCrop)) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      window.api.ndiOutput.pushFrame(
        NDI_STREAM_PROGRAM,
        new Uint8Array(imageData.data.buffer),
        canvas.width,
        canvas.height
      )
    }, 1000 / LIVE_CAPTURE_FPS)
    return () => clearInterval(timer)
  }, [ndiActive, programCaptureActive, programCaptureCrop])

  // Mirrors the Program Out NDI push above, but for the upcoming slide —
  // same source, same render path SlideViewer already uses for its "Next"
  // preview, just pushed out as its own independent named NDI stream so a
  // separate receiver (e.g. a stage monitor showing what's coming next)
  // can pick it up without needing the composited Confidence Monitor path.
  useEffect(() => {
    if (!nextNdiActive || !activeSource || !totalPages || nextCaptureActive) return
    const nextPage = currentPage < totalPages ? currentPage + 1 : null
    if (!nextPage) return
    const canvas = nextNdiCanvasRef.current
    activeSource
      .renderFrame(nextPage, canvas, 1920, 1080)
      .then(() => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        window.api.ndiOutput.pushFrame(
          NDI_STREAM_NEXT,
          new Uint8Array(imageData.data.buffer),
          canvas.width,
          canvas.height
        )
      })
      .catch((err) => console.error('Failed to render frame for Next Slide NDI output', err))
  }, [nextNdiActive, activeSource, currentPage, totalPages, nextCaptureActive])

  // Live-capture push loop for the Next Slide stream — same rationale as the
  // Program stream's loop above. Typically used with a crop rect to isolate
  // just the "next slide" sub-region of a captured Presenter Display screen.
  useEffect(() => {
    if (!nextNdiActive || !nextCaptureActive) return
    const canvas = nextNdiCanvasRef.current
    const handle = nextCaptureHandleRef.current
    const timer = setInterval(() => {
      if (!handle.drawCurrentFrame(canvas, 1920, 1080, nextCaptureCrop)) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      window.api.ndiOutput.pushFrame(
        NDI_STREAM_NEXT,
        new Uint8Array(imageData.data.buffer),
        canvas.width,
        canvas.height
      )
    }, 1000 / LIVE_CAPTURE_FPS)
    return () => clearInterval(timer)
  }, [nextNdiActive, nextCaptureActive, nextCaptureCrop])

  // Keeps the underlying app (Keynote, etc.) in sync whenever currentPage
  // changes, however it changed — Transport, keyboard, or a remote command.
  // A no-op for PDF. Also fires once when a source first opens (goTo(1)).
  useEffect(() => {
    activeSource?.goTo(currentPage).catch((err) => console.error('Failed to navigate source', err))
  }, [activeSource, currentPage])

  // The reverse direction: the underlying app can advance on its own (the
  // presenter clicking through Keynote directly) — reflect that back here.
  useEffect(() => {
    if (!activeSource) return
    return activeSource.onExternalPageChange(setCurrentPage)
  }, [activeSource])

  // Google Slides and Canva have no local file to read totalPages/notes from
  // up front — both arrive incrementally from the extension as the presenter
  // navigates, so build them up here instead of at "open" time like PDF/Keynote.
  useEffect(() => {
    if (activeSource?.kind !== 'google-slides' && activeSource?.kind !== 'canva') return
    return window.api.browserBridge.onSlideUpdate((update) => {
      if (update.app !== activeSource.kind) return
      if (update.total) setTotalPages(update.total)
      if (update.index !== null) {
        setNotesBySlide((prev) => ({ ...prev, [update.index as number]: update.notes }))
      }
    })
  }, [activeSource])

  useEffect(() => {
    return window.api.server.onCommand((command) => {
      if (command.type === 'next-slide') {
        setCurrentPage((p) => Math.min(p + 1, totalPagesRef.current || p))
      } else {
        setCurrentPage((p) => Math.max(p - 1, 1))
      }
    })
  }, [])

  useEffect(() => {
    if (status !== 'connected' || totalPages === 0) return
    window.api.server.pushSlideState({
      totalSlides: totalPages,
      currentSlideIndex: currentPage,
      notesBySlide
    })
  }, [status, totalPages, currentPage, notesBySlide])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') setCurrentPage((p) => Math.min(p + 1, totalPages || p))
      if (e.key === 'ArrowLeft') setCurrentPage((p) => Math.max(p - 1, 1))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [totalPages])

  const openPdf = async (): Promise<void> => {
    const result = await window.api.pdf.open()
    if (!result) return
    const doc = await loadPdf(result.data)
    const notes = await window.api.notes.load(result.filePath)
    activeSource?.dispose()
    setFilePath(result.filePath)
    setActiveSource(createPdfSource(doc, result.data))
    setTotalPages(doc.numPages)
    setCurrentPage(1)
    setNotesBySlide(notes)
  }

  const openKeynote = async (): Promise<void> => {
    const result = await window.api.keynote.open()
    if (!result) return
    activeSource?.dispose()
    setFilePath(result.filePath)
    setActiveSource(
      createKeynoteSource({
        frameFiles: result.frameFiles,
        goTo: window.api.keynote.goTo,
        onCurrentSlideChanged: window.api.keynote.onCurrentSlideChanged,
        close: window.api.keynote.close
      })
    )
    setTotalPages(result.totalPages)
    setCurrentPage(1)
    setNotesBySlide(result.notesBySlide)
    setSlideAspectRatio(result.slideWidth / result.slideHeight)
  }

  const openPowerPoint = async (): Promise<void> => {
    const result = await window.api.powerpoint.open()
    if (!result) return
    activeSource?.dispose()
    setFilePath(result.filePath)
    setActiveSource(
      createPowerPointSource({
        frameFiles: result.frameFiles,
        goTo: window.api.powerpoint.goTo,
        onCurrentSlideChanged: window.api.powerpoint.onCurrentSlideChanged,
        close: window.api.powerpoint.close
      })
    )
    setTotalPages(result.totalPages)
    setCurrentPage(1)
    setNotesBySlide(result.notesBySlide)
    setSlideAspectRatio(result.slideWidth / result.slideHeight)
  }

  const connectGoogleSlides = (): void => {
    activeSource?.dispose()
    setFilePath(null)
    setActiveSource(
      createGoogleSlidesSource({
        navigate: window.api.browserBridge.navigate,
        onSlideUpdate: window.api.browserBridge.onSlideUpdate
      })
    )
    setTotalPages(0)
    setCurrentPage(1)
    setNotesBySlide({})
  }

  const connectCanva = (): void => {
    activeSource?.dispose()
    setFilePath(null)
    setActiveSource(
      createCanvaSource({
        navigate: window.api.browserBridge.navigate,
        onSlideUpdate: window.api.browserBridge.onSlideUpdate
      })
    )
    setTotalPages(0)
    setCurrentPage(1)
    setNotesBySlide({})
  }

  const toggleNdi = async (): Promise<void> => {
    try {
      const nowActive = await window.api.ndiOutput.toggle(
        NDI_STREAM_PROGRAM,
        `${name || 'Presentation Commander'} (Program Out)`
      )
      setNdiActive(nowActive)
    } catch (err) {
      console.error('Failed to toggle NDI output', err)
    }
  }

  const toggleNextNdi = async (): Promise<void> => {
    try {
      const nowActive = await window.api.ndiOutput.toggle(
        NDI_STREAM_NEXT,
        `${name || 'Presentation Commander'} (Next Slide Preview)`
      )
      setNextNdiActive(nowActive)
    } catch (err) {
      console.error('Failed to toggle Next Slide NDI output', err)
    }
  }

  const startProgramCapture = async (sourceId: string, crop: CropRect | null): Promise<void> => {
    try {
      await programCaptureHandleRef.current.start(sourceId)
      setProgramCaptureCrop(crop)
      setProgramCaptureActive(true)
    } catch (err) {
      console.error('Failed to start live capture for Program NDI', err)
    }
  }

  const stopProgramCapture = (): void => {
    programCaptureHandleRef.current.stop()
    setProgramCaptureActive(false)
  }

  const startNextCapture = async (sourceId: string, crop: CropRect | null): Promise<void> => {
    try {
      await nextCaptureHandleRef.current.start(sourceId)
      setNextCaptureCrop(crop)
      setNextCaptureActive(true)
    } catch (err) {
      console.error('Failed to start live capture for Next Slide NDI', err)
    }
  }

  const stopNextCapture = (): void => {
    nextCaptureHandleRef.current.stop()
    setNextCaptureActive(false)
  }

  // Crop is applied at draw time, not capture time (see the push-loop
  // effects above), so changing it while already active is just a state
  // update — no need to stop/restart the underlying MediaStream.
  const recropProgramCapture = (crop: CropRect | null): void => setProgramCaptureCrop(crop)
  const recropNextCapture = (crop: CropRect | null): void => setNextCaptureCrop(crop)

  // Grabs a full, uncropped snapshot of whatever a capture handle is
  // currently seeing, for LiveCaptureControl's "Detect Regions" feature to
  // analyze — independent of that stream's own (possibly already-cropped)
  // output canvas.
  const getProgramSnapshot = (): HTMLCanvasElement | null => {
    const canvas = document.createElement('canvas')
    return programCaptureHandleRef.current.drawCurrentFrame(canvas, 1920, 1080, null)
      ? canvas
      : null
  }
  const getNextSnapshot = (): HTMLCanvasElement | null => {
    const canvas = document.createElement('canvas')
    return nextCaptureHandleRef.current.drawCurrentFrame(canvas, 1920, 1080, null) ? canvas : null
  }

  const changeNotes = (text: string): void => {
    const next = { ...notesBySlide, [currentPage]: text }
    setNotesBySlide(next)
    if (filePath) window.api.notes.save(filePath, next)
  }

  return (
    <div className="app-shell">
      <div className="app-titlebar">
        <span>Presentation Commander — Client</span>
        <div className="titlebar-actions">
          <NdiOutputControl disabled={!activeSource} active={ndiActive} onToggle={toggleNdi} />
          <NdiOutputControl
            disabled={!activeSource}
            active={nextNdiActive}
            onToggle={toggleNextNdi}
            label="Next Slide NDI"
            activeLabel="Stop Next Slide NDI"
          />
          {(activeSource?.kind === 'keynote' || activeSource?.kind === 'powerpoint') && (
            <>
              <LiveCaptureControl
                label="Main Output"
                disabled={!ndiActive}
                active={programCaptureActive}
                onStart={startProgramCapture}
                onStop={stopProgramCapture}
                onRecrop={recropProgramCapture}
                getSnapshot={getProgramSnapshot}
                slideAspectRatio={slideAspectRatio}
              />
              <LiveCaptureControl
                label="Next Slide"
                disabled={!nextNdiActive}
                active={nextCaptureActive}
                onStart={startNextCapture}
                onStop={stopNextCapture}
                onRecrop={recropNextCapture}
                getSnapshot={getNextSnapshot}
                slideAspectRatio={slideAspectRatio}
              />
            </>
          )}
          <ProgramOutControl disabled={!activeSource} />
          <button className="transport-btn" onClick={openPdf}>
            {filePath ? 'Open Different PDF…' : 'Open PDF…'}
          </button>
          <button className="transport-btn" onClick={openKeynote}>
            Open Keynote…
          </button>
          <button className="transport-btn" onClick={openPowerPoint}>
            Open PowerPoint…
          </button>
          <button className="transport-btn" onClick={connectGoogleSlides}>
            Connect Google Slides…
          </button>
          <button
            className="icon-btn"
            title="Google Slides OAuth setup"
            onClick={() => setShowGoogleSlidesSetup(true)}
          >
            ⚙
          </button>
          <button className="transport-btn" onClick={connectCanva}>
            Connect Canva…
          </button>
        </div>
      </div>

      {showGoogleSlidesSetup && (
        <GoogleSlidesSetup onClose={() => setShowGoogleSlidesSetup(false)} />
      )}

      <ConnectionPanel
        status={status}
        host={host}
        name={name}
        onHostChange={setHost}
        onNameChange={setName}
        onConnect={() =>
          window.api.server.connect(host, { name, platform, app: activeSource?.kind ?? 'pdf' })
        }
        onDisconnect={() => window.api.server.disconnect()}
      />

      {activeSource && totalPages > 0 ? (
        <>
          <SlideViewer
            source={activeSource}
            currentPage={currentPage}
            totalPages={totalPages}
            onNavigate={setCurrentPage}
          />
          <Transport
            currentPage={currentPage}
            totalPages={totalPages}
            onPrev={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            onNext={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
          />
          <NotesPanel
            currentPage={currentPage}
            notes={notesBySlide[currentPage] ?? ''}
            onChange={changeNotes}
          />
        </>
      ) : activeSource?.kind === 'google-slides' ? (
        <div className="empty-state">Waiting for a Google Slides tab to start presenting…</div>
      ) : activeSource?.kind === 'canva' ? (
        <div className="empty-state">Waiting for a Canva Presenter Window to open…</div>
      ) : (
        <div className="empty-state">Open a PDF to start presenting.</div>
      )}
    </div>
  )
}

export default App
