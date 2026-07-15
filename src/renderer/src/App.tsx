import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '../../shared/protocol'
import type { SlideSource } from './sources/types'
import './App.css'
import { loadPdf } from './pdf'
import { createPdfSource } from './sources/pdfSource'
import { createKeynoteSource } from './sources/keynoteSource'
import { createGoogleSlidesSource } from './sources/googleSlidesSource'
import SlideViewer from './components/SlideViewer'
import NotesPanel from './components/NotesPanel'
import Transport from './components/Transport'
import ConnectionPanel from './components/ConnectionPanel'
import ProgramOutControl from './components/ProgramOutControl'
import NdiOutputControl from './components/NdiOutputControl'

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
    window.api.ndiOutput.isActive().then(setNdiActive)
  }, [])

  useEffect(() => {
    if (!ndiActive || !activeSource || !currentPage) return
    const canvas = ndiCanvasRef.current
    activeSource
      .renderFrame(currentPage, canvas, 1920, 1080)
      .then(() => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        window.api.ndiOutput.pushFrame(
          new Uint8Array(imageData.data.buffer),
          canvas.width,
          canvas.height
        )
      })
      .catch((err) => console.error('Failed to render frame for NDI output', err))
  }, [ndiActive, activeSource, currentPage])

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

  // Google Slides has no local file to read totalPages/notes from up front —
  // both arrive incrementally from the extension as the presenter navigates,
  // so build them up here instead of at "open" time like PDF/Keynote.
  useEffect(() => {
    if (activeSource?.kind !== 'google-slides') return
    return window.api.browserBridge.onSlideUpdate((update) => {
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

  const toggleNdi = async (): Promise<void> => {
    try {
      const nowActive = await window.api.ndiOutput.toggle(
        `${name || 'Presentation Commander'} (Program Out)`
      )
      setNdiActive(nowActive)
    } catch (err) {
      console.error('Failed to toggle NDI output', err)
    }
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
          <ProgramOutControl disabled={!activeSource} />
          <button className="transport-btn" onClick={openPdf}>
            {filePath ? 'Open Different PDF…' : 'Open PDF…'}
          </button>
          <button className="transport-btn" onClick={openKeynote}>
            Open Keynote…
          </button>
          <button className="transport-btn" onClick={connectGoogleSlides}>
            Connect Google Slides…
          </button>
        </div>
      </div>

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
          <SlideViewer source={activeSource} currentPage={currentPage} totalPages={totalPages} />
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
      ) : (
        <div className="empty-state">Open a PDF to start presenting.</div>
      )}
    </div>
  )
}

export default App
