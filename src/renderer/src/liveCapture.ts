/**
 * Live screen capture for Keynote/PowerPoint's real on-screen output —
 * genuinely live video (animations, transitions, embedded video playback),
 * unlike the rest of the SlideSource pipeline which draws pre-exported
 * static PNGs. See main/services/screenCapture.ts for why this captures a
 * whole display rather than a specific window: fullscreen presentation
 * windows aren't enumerable via desktopCapturer's window-level sources.
 *
 * `getDisplayMedia({video:true})` resolves immediately with whichever
 * source `window.api.screenCapture.setActive(sourceId)` was last told to
 * use — no OS picker UI — because the main process installs a
 * `setDisplayMediaRequestHandler` that supplies it directly.
 *
 * `crop` lets one captured display (e.g. a Presenter Display screen showing
 * current + next + notes together) be split into independent live feeds —
 * the same mechanism serves both "main output" (no crop) and "next slide
 * box" (a sub-rectangle of a Presenter Display capture) without needing
 * separate implementations.
 */
export interface CropRect {
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export interface LiveCaptureHandle {
  start(sourceId: string): Promise<void>
  stop(): void
  isActive(): boolean
  /** Draws the current frame (optionally cropped) into `canvas`, contain-fit within maxWidth x maxHeight. Returns false if there's no frame ready yet. */
  drawCurrentFrame(
    canvas: HTMLCanvasElement,
    maxWidth: number,
    maxHeight: number,
    crop?: CropRect | null
  ): boolean
}

export function createLiveCapture(): LiveCaptureHandle {
  let stream: MediaStream | null = null
  let videoEl: HTMLVideoElement | null = null

  return {
    async start(sourceId) {
      await window.api.screenCapture.setActive(sourceId)
      let acquired: MediaStream
      try {
        acquired = await navigator.mediaDevices.getDisplayMedia({ video: true })
      } catch (err) {
        // Confirmed live on a Parallels Windows VM: getDisplayMedia's capture
        // pipeline throws AbortError "Error starting capture" even with a
        // working, hardware-accelerated GPU (WebGL/D3D11 confirmed fine) —
        // this VM's virtual display adapter doesn't support whatever capture
        // API Chromium's newer getDisplayMedia path requires. The legacy
        // chromeMediaSource desktop-capture API (mandatory constraints) uses
        // a different, more compatible Chromium code path and works
        // reliably in the same environment — confirmed live. It doesn't
        // trigger an OS picker either, since a specific sourceId is always
        // supplied here, so falling back to it costs nothing on platforms
        // where getDisplayMedia already works fine.
        console.warn(
          '[live-capture] getDisplayMedia failed, falling back to legacy desktop capture:',
          err
        )
        acquired = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          } as MediaTrackConstraints
        })
      }
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = acquired
      // Confirmed live: a video element left detached from the document
      // delivers frames normally for the first several seconds, then
      // Chromium silently stops updating it — presumably a visibility-based
      // resource-management heuristic, since it isn't considered "on
      // screen." Attaching it (off-screen, non-interactive) keeps frames
      // flowing indefinitely.
      video.style.position = 'fixed'
      video.style.top = '-10000px'
      video.style.left = '-10000px'
      video.style.pointerEvents = 'none'
      document.body.appendChild(video)
      await video.play()
      stream = acquired
      videoEl = video
    },

    stop() {
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      videoEl?.remove()
      videoEl = null
      window.api.screenCapture.setActive(null)
    },

    isActive() {
      return stream !== null && videoEl !== null
    },

    drawCurrentFrame(canvas, maxWidth, maxHeight, crop) {
      if (!videoEl || videoEl.readyState < 2) return false
      const videoWidth = videoEl.videoWidth
      const videoHeight = videoEl.videoHeight
      if (!videoWidth || !videoHeight) return false

      const sx = crop ? (crop.xPct / 100) * videoWidth : 0
      const sy = crop ? (crop.yPct / 100) * videoHeight : 0
      const sw = crop ? (crop.widthPct / 100) * videoWidth : videoWidth
      const sh = crop ? (crop.heightPct / 100) * videoHeight : videoHeight
      if (sw <= 0 || sh <= 0) return false

      const scale = Math.min(maxWidth / sw, maxHeight / sh)
      canvas.width = Math.max(1, Math.round(sw * scale))
      canvas.height = Math.max(1, Math.round(sh * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return false
      ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      return true
    }
  }
}
