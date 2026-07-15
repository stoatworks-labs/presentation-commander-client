import { EventEmitter } from 'events'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = 9801

export type BrowserSourceApp = 'google-slides' | 'canva'

export interface BrowserSlideUpdate {
  app: BrowserSourceApp
  presentationId: string | null
  slideId: string
  index: number | null
  total: number | null
  frameDataUrl: string | null
  notes: string
}

interface IncomingMessage {
  type: 'slide-update' | 'slide-notes'
  app: BrowserSourceApp
  presentationId: string | null
  slideId: string
  index?: number | null
  total?: number | null
  frameDataUrl?: string | null
  notes?: string
}

/**
 * Local bridge for the browser extension (extension/) — it connects here
 * from its background service worker and reports live slide/notes state
 * from whichever platform it's watching (Google Slides' audience tab or
 * Canva's Presenter popout). Frame + index arrive immediately on
 * 'slide-update'; Google Slides' notes resolve a beat later via a separate
 * 'slide-notes' message (fetched from the Slides API, not scraped) and get
 * cached by slideId, while Canva's notes are scraped in-page and arrive
 * already populated on 'slide-update'. Only one platform is ever actively
 * presenting at a time, but `app` tags every update so each SlideSource can
 * ignore updates meant for the other.
 */
class BrowserBridgeService extends EventEmitter {
  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private notesBySlideId = new Map<string, string>()
  private latest: BrowserSlideUpdate | null = null

  start(): void {
    if (this.wss) return
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: PORT })

    this.wss.on('connection', (socket) => {
      this.socket = socket

      socket.on('message', (raw) => {
        let message: IncomingMessage
        try {
          message = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (message.type === 'slide-update') {
          this.latest = {
            app: message.app,
            presentationId: message.presentationId,
            slideId: message.slideId,
            index: message.index ?? null,
            total: message.total ?? null,
            frameDataUrl: message.frameDataUrl ?? null,
            // Canva already resolves notes in-page and sends them here directly
            // (message.notes); Google Slides sends '' here and fills it in a beat
            // later via 'slide-notes', keyed off the notesBySlideId cache instead.
            notes: message.notes || this.notesBySlideId.get(message.slideId) || ''
          }
          this.emit('slide-update', this.latest)
        } else if (message.type === 'slide-notes') {
          this.notesBySlideId.set(message.slideId, message.notes ?? '')
          if (this.latest && this.latest.slideId === message.slideId) {
            this.latest = { ...this.latest, notes: message.notes ?? '' }
            this.emit('slide-update', this.latest)
          }
        }
      })

      socket.on('close', () => {
        if (this.socket === socket) this.socket = null
      })
    })

    this.wss.on('error', (err) => console.error('[browser-bridge] server error:', err))
  }

  stop(): void {
    this.socket = null
    this.latest = null
    this.notesBySlideId.clear()
    this.wss?.close()
    this.wss = null
  }

  navigate(direction: 'next' | 'previous', app: BrowserSourceApp): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'navigate', direction, app }))
    }
  }
}

export const browserBridge = new BrowserBridgeService()
