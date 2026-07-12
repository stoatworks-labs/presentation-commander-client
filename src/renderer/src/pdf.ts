import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function loadPdf(base64: string): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: base64ToUint8Array(base64) }).promise
}

const activeRenders = new WeakMap<HTMLCanvasElement, RenderTask>()

async function renderAtScale(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<void> {
  activeRenders.get(canvas)?.cancel()

  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })

  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  if (!context) return

  const task = page.render({ canvasContext: context, viewport })
  activeRenders.set(canvas, task)
  try {
    await task.promise
  } catch (err) {
    if (err instanceof Error && err.name === 'RenderingCancelledException') return
    throw err
  }
}

export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number
): Promise<void> {
  const page = await doc.getPage(pageNumber)
  const unscaledViewport = page.getViewport({ scale: 1 })
  await renderAtScale(doc, pageNumber, canvas, targetWidth / unscaledViewport.width)
}

/** Scales to fit entirely within maxWidth x maxHeight, preserving aspect ratio. */
export async function renderPageContain(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
  maxHeight: number
): Promise<void> {
  const page = await doc.getPage(pageNumber)
  const unscaledViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(maxWidth / unscaledViewport.width, maxHeight / unscaledViewport.height)
  await renderAtScale(doc, pageNumber, canvas, scale)
}
