import type { ProgramOutState } from '../../../shared/programOut'
import type { SlideSource } from './types'

interface BrowserSlideUpdate {
  presentationId: string | null
  slideId: string
  index: number | null
  total: number | null
  frameDataUrl: string | null
  notes: string
}

/** The subset of window.api.browserBridge a GoogleSlidesSource needs. */
export interface BrowserBridgeHandle {
  navigate(direction: 'next' | 'previous'): Promise<void>
  onSlideUpdate(callback: (update: BrowserSlideUpdate) => void): () => void
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load Google Slides frame'))
    img.src = url
  })
}

/**
 * SlideSource backed by the Google Slides browser extension (extension/) —
 * see main/services/browserBridge.ts for the local WebSocket side. Unlike
 * Keynote's pre-exported deck, the extension only ever reports the *current*
 * slide it's watching — there's no way to pre-fetch a "next" frame without
 * actually navigating there, so renderFrame only has real pixels for
 * whatever page the extension last reported and draws nothing otherwise.
 */
export function createGoogleSlidesSource(handle: BrowserBridgeHandle): SlideSource {
  let latest: BrowserSlideUpdate | null = null
  const unsubscribeInternal = handle.onSlideUpdate((update) => {
    latest = update
  })

  return {
    kind: 'google-slides',
    async renderFrame(page, canvas, maxWidth, maxHeight) {
      if (!latest || latest.index !== page || !latest.frameDataUrl) return
      const img = await loadImage(latest.frameDataUrl)
      const scale = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight)
      canvas.width = img.naturalWidth * scale
      canvas.height = img.naturalHeight * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    },
    goTo(page) {
      if (!latest?.index || page === latest.index) return Promise.resolve()
      return handle.navigate(page > latest.index ? 'next' : 'previous')
    },
    onExternalPageChange(callback) {
      return handle.onSlideUpdate((update) => {
        if (update.index !== null) callback(update.index)
      })
    },
    getProgramOutPayload(page): ProgramOutState {
      return { kind: 'image', fileUrl: latest?.frameDataUrl ?? '', currentPage: page }
    },
    dispose() {
      unsubscribeInternal()
    }
  }
}
