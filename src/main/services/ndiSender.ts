import { NdiSender } from 'ndi-send'

interface Frame {
  buffer: Buffer
  width: number
  height: number
}

interface StreamState {
  sender: NdiSender
  pending: Frame | null
  lastSent: Frame | null
  sending: boolean
  keepAliveTimer: NodeJS.Timeout
}

/**
 * Thin coalescing wrapper around the native sender, keyed by streamId so
 * independent NDI outputs (e.g. Program Out and a separate Next Slide
 * Preview) can run concurrently — the native addon supports multiple
 * NDIlib senders in one process, so the only shared state here is this
 * map. Per stream, only one NDIlib send call is ever in flight at a time
 * (queuing further calls from the same JS process risks two threadpool
 * workers touching the same sender instance concurrently), and a 1s
 * keep-alive resends the last frame so a static slide doesn't go stale
 * for receivers that expect a steady feed.
 */
class NdiSenderService {
  private streams = new Map<string, StreamState>()

  start(streamId: string, name: string): void {
    if (this.streams.has(streamId)) return
    const sender = new NdiSender(name)
    const state: StreamState = {
      sender,
      pending: null,
      lastSent: null,
      sending: false,
      keepAliveTimer: setInterval(() => {
        if (state.lastSent) this.queue(streamId, state.lastSent)
      }, 1000)
    }
    this.streams.set(streamId, state)
  }

  isActive(streamId: string): boolean {
    return this.streams.has(streamId)
  }

  sendFrame(streamId: string, buffer: Buffer, width: number, height: number): void {
    this.queue(streamId, { buffer, width, height })
  }

  stop(streamId: string): void {
    const state = this.streams.get(streamId)
    if (!state) return
    clearInterval(state.keepAliveTimer)
    state.sender.destroy()
    this.streams.delete(streamId)
  }

  stopAll(): void {
    for (const streamId of [...this.streams.keys()]) this.stop(streamId)
  }

  private queue(streamId: string, frame: Frame): void {
    const state = this.streams.get(streamId)
    if (!state) return
    state.pending = frame
    state.lastSent = frame
    this.drain(streamId)
  }

  private drain(streamId: string): void {
    const state = this.streams.get(streamId)
    if (!state || state.sending || !state.pending) return
    const frame = state.pending
    state.pending = null
    state.sending = true
    state.sender
      .sendFrame(frame.buffer, frame.width, frame.height)
      .catch((err) => console.error(`[ndi-sender:${streamId}] sendFrame failed:`, err))
      .finally(() => {
        state.sending = false
        this.drain(streamId)
      })
  }
}

export const ndiSenderService = new NdiSenderService()
