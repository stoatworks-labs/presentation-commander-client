import type { ProgramOutState } from '../../../shared/programOut'
import type { SlideSource } from './types'

function toFileUrl(absPath: string): string {
  return 'file://' + absPath.split('/').map(encodeURIComponent).join('/')
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load PowerPoint frame: ${url}`))
    img.src = url
  })
}

/** The subset of window.api.powerpoint a PowerPointSource needs — kept separate so App.tsx owns the IPC calls. */
export interface PowerPointHandle {
  frameFiles: string[]
  goTo(page: number): Promise<void>
  onCurrentSlideChanged(callback: (page: number) => void): () => void
  close(): Promise<void>
}

/** SlideSource backed by a live PowerPoint document — see main/services/powerpointBridge.ts for the AppleScript side. */
export function createPowerPointSource(handle: PowerPointHandle): SlideSource {
  const imageCache = new Map<string, HTMLImageElement>()

  async function frameFor(page: number): Promise<HTMLImageElement> {
    const url = toFileUrl(handle.frameFiles[page - 1])
    const cached = imageCache.get(url)
    if (cached) return cached
    const img = await loadImage(url)
    imageCache.set(url, img)
    return img
  }

  return {
    kind: 'powerpoint',
    async renderFrame(page, canvas, maxWidth, maxHeight) {
      const img = await frameFor(page)
      const scale = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight)
      canvas.width = img.naturalWidth * scale
      canvas.height = img.naturalHeight * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    },
    goTo(page) {
      return handle.goTo(page)
    },
    onExternalPageChange(callback) {
      return handle.onCurrentSlideChanged(callback)
    },
    getProgramOutPayload(page): ProgramOutState {
      return { kind: 'image', fileUrl: toFileUrl(handle.frameFiles[page - 1]), currentPage: page }
    },
    dispose() {
      handle.close().catch((err) => console.error('Failed to close PowerPoint source', err))
    }
  }
}
