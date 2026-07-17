import { desktopCapturer, session, systemPreferences } from 'electron'

export interface CaptureSourceInfo {
  id: string
  name: string
  thumbnailDataUrl: string
}

/**
 * Live screen/display capture for Keynote and PowerPoint's "main output" and
 * "presenter view" — a genuinely different mechanism from the rest of the
 * SlideSource pipeline, which draws pre-exported static PNGs. Fullscreen
 * presentation windows are NOT enumerable via desktopCapturer's window-level
 * sources (confirmed live: macOS elevates a fullscreen slideshow window above
 * the level CGWindowListCopyWindowInfo's normal "on-screen windows" query
 * returns, so it's invisible to `types: ['window']` even while genuinely
 * on-screen) — so this only offers `types: ['screen']` sources. Capturing
 * the physical display the presentation is actually fullscreen on works
 * regardless of that window-level quirk, since it reads the framebuffer
 * directly rather than enumerating windows. This also matches the existing
 * Program Out display-picker UX: pick a display, not a window.
 *
 * Uses `session.setDisplayMediaRequestHandler` (not the legacy
 * `chromeMediaSource` mandatory-constraint getUserMedia syntax) so the
 * renderer's plain `getDisplayMedia({video:true})` call resolves immediately
 * with the source this module was told to use, instead of popping the OS's
 * own screen-picker UI.
 */
class ScreenCaptureService {
  private activeSourceId: string | null = null
  private handlerInstalled = false

  installDisplayMediaHandler(): void {
    if (this.handlerInstalled) return
    this.handlerInstalled = true
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      if (!this.activeSourceId) {
        callback({})
        return
      }
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      const match = sources.find((s) => s.id === this.activeSourceId)
      callback(match ? { video: match } : {})
    })
  }

  getPermissionStatus(): 'granted' | 'denied' | 'restricted' | 'unknown' | 'not-determined' {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen')
  }

  async listSources(): Promise<CaptureSourceInfo[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL()
    }))
  }

  setActiveSource(sourceId: string | null): void {
    this.activeSourceId = sourceId
  }
}

export const screenCaptureService = new ScreenCaptureService()
