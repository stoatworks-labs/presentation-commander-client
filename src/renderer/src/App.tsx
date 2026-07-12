import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ConnectionStatus } from '../../shared/protocol'
import './App.css'
import { loadPdf } from './pdf'
import PdfViewer from './components/PdfViewer'
import NotesPanel from './components/NotesPanel'
import Transport from './components/Transport'
import ConnectionPanel from './components/ConnectionPanel'

function App(): React.JSX.Element {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [notesBySlide, setNotesBySlide] = useState<Record<number, string>>({})

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [host, setHost] = useState('localhost:9800')
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<'windows' | 'macos'>('macos')

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
    setFilePath(result.filePath)
    setPdfDoc(doc)
    setTotalPages(doc.numPages)
    setCurrentPage(1)
    setNotesBySlide(notes)
  }

  const changeNotes = (text: string): void => {
    const next = { ...notesBySlide, [currentPage]: text }
    setNotesBySlide(next)
    if (filePath) window.api.notes.save(filePath, next)
  }

  return (
    <div className="app-shell">
      <div className="app-titlebar">
        <span>LiveMaster Client Node</span>
        <button className="transport-btn" onClick={openPdf}>
          {filePath ? 'Open Different PDF…' : 'Open PDF…'}
        </button>
      </div>

      <ConnectionPanel
        status={status}
        host={host}
        name={name}
        onHostChange={setHost}
        onNameChange={setName}
        onConnect={() => window.api.server.connect(host, { name, platform, app: 'pdf' })}
        onDisconnect={() => window.api.server.disconnect()}
      />

      {pdfDoc ? (
        <>
          <PdfViewer doc={pdfDoc} currentPage={currentPage} totalPages={totalPages} />
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
      ) : (
        <div className="empty-state">Open a PDF to start presenting.</div>
      )}
    </div>
  )
}

export default App
