import { EventEmitter } from 'events'
import WebSocket from 'ws'
import type {
  ConnectionStatus,
  RegisterMessage,
  RemoteCommandMessage,
  ServerToClientMessage,
  SlideStateMessage
} from '../../shared/protocol'

/**
 * Persistent link to the Master Server's client hub (ws://<host>:9800).
 *
 * Sends `register` on open then `slide-state` as the deck moves; receives
 * `command` (next/previous slide) pushed back down. The message shapes live in
 * shared/protocol.ts and are MIRRORED BY HAND in the server repo — nothing
 * imports across the two, so a shape change here breaks the master server with
 * no compile error to catch it.
 *
 * THERE IS NO RECONNECT. connect() opens exactly one socket; when it closes,
 * status goes to 'disconnected' and stays there until something calls connect()
 * again. A network blip, a switch reboot or the server restarting mid-show
 * leaves the app presenting perfectly well and silently no longer
 * remote-controllable. If a reconnect loop is added, note the server keys
 * clients by NAME and will reuse the same client id — reconnecting is cheap and
 * does not pile up duplicates.
 */
class ServerLink extends EventEmitter {
  private socket: WebSocket | null = null
  private registerInfo: RegisterMessage | null = null

  /**
   * Open the link and register. `host` is "host:port" — it is interpolated
   * straight into the ws:// URL, so the caller owns the port.
   *
   * Disconnects any existing socket first, so calling this twice is safe.
   * Registration is fire-and-forget: `register` goes out on open and slide
   * state can start flowing immediately, without waiting for the server's
   * `registered` reply.
   */
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

  /**
   * Send the current slide position and note set.
   *
   * DROPS SILENTLY if the socket isn't open — no queue, no error, no return
   * value. Combined with the lack of reconnect above, that means slide state
   * can stop reaching the server with nothing in this class to say so; the
   * 'status' event is the only signal.
   *
   * The server replaces its whole note set for this client on every call, so
   * this must always send the complete map rather than a delta.
   */
  pushSlideState(state: Omit<SlideStateMessage, 'type'>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'slide-state', ...state }))
    }
  }
}

export const serverLink = new ServerLink()
