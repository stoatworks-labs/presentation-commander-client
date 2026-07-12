import { EventEmitter } from 'events'
import WebSocket from 'ws'
import type {
  ConnectionStatus,
  RegisterMessage,
  RemoteCommandMessage,
  ServerToClientMessage,
  SlideStateMessage
} from '../../shared/protocol'

/** Persistent link to the Master Server's client hub (ws://<host>:9800). */
class ServerLink extends EventEmitter {
  private socket: WebSocket | null = null
  private registerInfo: RegisterMessage | null = null

  connect(host: string, info: Omit<RegisterMessage, 'type'>): void {
    this.disconnect()
    this.registerInfo = { type: 'register', ...info }
    this.emit('status', 'connecting' satisfies ConnectionStatus)

    const socket = new WebSocket(`ws://${host}`)
    this.socket = socket

    socket.on('open', () => {
      this.emit('status', 'connected' satisfies ConnectionStatus)
      if (this.registerInfo) socket.send(JSON.stringify(this.registerInfo))
    })

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ServerToClientMessage
        if (message.type === 'command') {
          this.emit('command', message.command satisfies RemoteCommandMessage['command'])
        }
      } catch {
        // ignore malformed frames
      }
    })

    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.emit('status', 'disconnected' satisfies ConnectionStatus)
      }
    })

    socket.on('error', () => {
      this.emit('status', 'error' satisfies ConnectionStatus)
    })
  }

  disconnect(): void {
    this.registerInfo = null
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.close()
      this.socket = null
      this.emit('status', 'disconnected' satisfies ConnectionStatus)
    }
  }

  pushSlideState(state: Omit<SlideStateMessage, 'type'>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'slide-state', ...state }))
    }
  }
}

export const serverLink = new ServerLink()
