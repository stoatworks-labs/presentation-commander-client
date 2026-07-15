import { EventEmitter } from 'events'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = 9801

export interface BrowserSlideUpdate {
  presentationId: string | null
  slideId: string
  index: number | null
  total: number | null
  frameDataUrl: string | null
  notes: string
}

interface IncomingMessage {
  type: 'slide-update' | 'slide-notes'
  presentationId: string | null
  slideId: string
  index?: number | null
  total?: number | null
  frameDataUrl?: string | null
  notes?: string
}

/**
 * Local bridge for the Google Slides browser extension (extension/) — it
 * connects here from its background service worker and reports live
 * slide/notes state from the audience-facing Presenter tab it's watching.
 * Frame + index arrive immediately on 'slide-update'; notes resolve a beat
 * later via a separate 'slide-notes' message (fetched from the Slides API,
 * not scraped), so they're cached by slideId and merged into whichever
 * update is current when they land.
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
            presentationId: message.presentationId,
            slideId: message.slideId,
            index: message.index ?? null,
            total: message.total ?? null,
            frameDataUrl: message.frameDataUrl ?? null,
            notes: this.notesBySlideId.get(message.slideId) ?? ''
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

  navigate(direction: 'next' | 'previous'): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'navigate', direction }))
    }
  }
}

export const browserBridge = new BrowserBridgeService()
