import type { ProgramOutState } from '../../../shared/programOut'
import type { SlideSource } from './types'

interface BrowserSlideUpdate {
  app: 'google-slides' | 'canva'
  presentationId: string | null
  slideId: string
  index: number | null
  total: number | null
  frameDataUrl: string | null
  notes: string
}

/** The subset of window.api.browserBridge a CanvaSource needs. */
export interface BrowserBridgeHandle {
  navigate(direction: 'next' | 'previous', app: 'google-slides' | 'canva'): Promise<void>
  onSlideUpdate(callback: (update: BrowserSlideUpdate) => void): () => void
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load Canva frame'))
    img.src = url
  })
}

/** Resolves once the extension reports an index different from
 * `beforeIndex`, or after `timeoutMs` — bounds a stuck-tab from hanging a
 * multi-step goTo() forever. */
function waitForIndexChange(
  handle: BrowserBridgeHandle,
  beforeIndex: number,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve()
    }, timeoutMs)
    const unsubscribe = handle.onSlideUpdate((update) => {
      if (update.app === 'canva' && update.index !== null && update.index !== beforeIndex) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    })
  })
}

/**
 * SlideSource backed by the Canva browser extension (extension/) — see
 * main/services/browserBridge.ts for the local WebSocket side. Mirrors
 * googleSlidesSource.ts: no local file, state arrives incrementally from
 * the extension as the presenter navigates Canva's Presenter Window.
 * Unlike Google Slides, Canva's notes are scraped directly from the
 * Presenter Window's DOM (there's no equivalent public notes API), so they
 * arrive already resolved on the same 'slide-update' the frame does.
 */
export function createCanvaSource(handle: BrowserBridgeHandle): SlideSource {
  let latest: BrowserSlideUpdate | null = null
  const unsubscribeInternal = handle.onSlideUpdate((update) => {
    if (update.app !== 'canva') return
    latest = update
  })

  return {
    kind: 'canva',
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
    async goTo(page) {
      // The extension only exposes single-step next/previous, not an
      // arbitrary jump — step repeatedly toward the target, waiting for the
      // extension to actually confirm each step (not just for the navigate
      // IPC call to complete) before sending the next one. Capped well
      // above any real deck size as a safety guard against runaway loops if
      // `latest.index` ever stops updating mid-navigation.
      const MAX_STEPS = 1000
      for (let steps = 0; steps < MAX_STEPS; steps++) {
        if (!latest?.index || page === latest.index) return
        const beforeIndex = latest.index
        await handle.navigate(page > latest.index ? 'next' : 'previous', 'canva')
        await waitForIndexChange(handle, beforeIndex, 1500)
      }
    },
    onExternalPageChange(callback) {
      return handle.onSlideUpdate((update) => {
        if (update.app === 'canva' && update.index !== null) callback(update.index)
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
