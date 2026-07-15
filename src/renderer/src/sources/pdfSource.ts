import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { SlideSource } from './types'
import { renderPageContain } from '../pdf'

/** Thin SlideSource adapter around the existing pdf.js rendering path — no behavior change. */
export function createPdfSource(doc: PDFDocumentProxy, pdfData: string): SlideSource {
  return {
    kind: 'pdf',
    renderFrame(page, canvas, maxWidth, maxHeight) {
      return renderPageContain(doc, page, canvas, maxWidth, maxHeight)
    },
    goTo() {
      return Promise.resolve()
    },
    onExternalPageChange() {
      return () => {}
    },
    getProgramOutPayload(page) {
      return { kind: 'pdf', data: pdfData, currentPage: page }
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- nothing to tear down for a static PDF
    dispose() {}
  }
}
