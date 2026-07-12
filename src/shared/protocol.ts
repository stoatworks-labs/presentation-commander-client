// Wire protocol between a Client Node and the Master Server's client hub
// (ws://<host>:9800). Kept as plain JSON messages, one per WebSocket frame.

export type ClientPlatform = 'windows' | 'macos'
export type ClientApp = 'powerpoint' | 'keynote' | 'google-slides' | 'canva' | 'pdf'

export interface RegisterMessage {
  type: 'register'
  name: string
  platform: ClientPlatform
  app: ClientApp
}

export interface SlideStateMessage {
  type: 'slide-state'
  totalSlides: number
  currentSlideIndex: number
  notesBySlide: Record<number, string>
}

export type ClientToServerMessage = RegisterMessage | SlideStateMessage

export interface RegisteredMessage {
  type: 'registered'
  clientId: string
}

export interface RemoteCommandMessage {
  type: 'command'
  command: { type: 'next-slide' } | { type: 'previous-slide' }
}

export type ServerToClientMessage = RegisteredMessage | RemoteCommandMessage

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
