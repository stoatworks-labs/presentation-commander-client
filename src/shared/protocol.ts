// Wire protocol between a Client Node and the Master Server's client hub
// (ws://<host>:9800). Kept as plain JSON messages, one per WebSocket frame.

// Both apps are packaged for Linux, but the client used to report every Linux
// box as 'windows' — it derived this from a two-way darwin/else test, so the
// Control Deck and the automation API both showed the wrong platform. The hub
// does not validate the value, so an older server still accepts 'linux'.
export type ClientPlatform = 'windows' | 'macos' | 'linux'
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
