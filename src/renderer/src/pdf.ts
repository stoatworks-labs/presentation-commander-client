import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'

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

export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number
): Promise<void> {
  const page = await doc.getPage(pageNumber)
  const unscaledViewport = page.getViewport({ scale: 1 })
  const scale = targetWidth / unscaledViewport.width
  const viewport = page.getViewport({ scale })

  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  if (!context) return

  await page.render({ canvasContext: context, viewport, canvas }).promise
}
