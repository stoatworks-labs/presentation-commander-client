import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ConnectionStatus,
  RegisterMessage,
  RemoteCommandMessage,
  SlideStateMessage
} from '../shared/protocol'
import type { ProgramOutState } from '../shared/programOut'

interface OpenPdfResult {
  filePath: string
  data: string
}

interface OpenKeynoteResult {
  filePath: string
  totalPages: number
  notesBySlide: Record<number, string>
  frameFiles: string[]
}

interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  internal: boolean
  primary: boolean
}

interface BrowserSlideUpdate {
  presentationId: string | null
  slideId: string
  index: number | null
  total: number | null
  frameDataUrl: string | null
  notes: string
}

interface SystemInfo {
  hostname: string
  platform: 'windows' | 'macos'
}

interface OAuthStatus {
  configured: boolean
  clientId: string | null
  extensionId: string
}

const api = {
  system: {
    info: (): Promise<SystemInfo> => ipcRenderer.invoke('system:info')
  },
  pdf: {
    open: (): Promise<OpenPdfResult | null> => ipcRenderer.invoke('pdf:open')
  },
  keynote: {
    open: (): Promise<OpenKeynoteResult | null> => ipcRenderer.invoke('keynote:open'),
    goTo: (page: number): Promise<void> => ipcRenderer.invoke('keynote:goto', page),
    close: (): Promise<void> => ipcRenderer.invoke('keynote:close'),
    onCurrentSlideChanged: (callback: (page: number) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, page: number): void => callback(page)
      ipcRenderer.on('keynote:current-slide-changed', listener)
      return (): void => {
        ipcRenderer.removeListener('keynote:current-slide-changed', listener)
      }
    }
  },
  browserBridge: {
    navigate: (direction: 'next' | 'previous'): Promise<void> =>
      ipcRenderer.invoke('browser-bridge:navigate', direction),
    onSlideUpdate: (callback: (update: BrowserSlideUpdate) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, update: BrowserSlideUpdate): void =>
        callback(update)
      ipcRenderer.on('browser-bridge:slide-update', listener)
      return (): void => {
        ipcRenderer.removeListener('browser-bridge:slide-update', listener)
      }
    }
  },
  googleSlidesSetup: {
    getStatus: (): Promise<OAuthStatus> => ipcRenderer.invoke('google-slides-setup:get-status'),
    setClientId: (clientId: string): Promise<void> =>
      ipcRenderer.invoke('google-slides-setup:set-client-id', clientId)
  },
  notes: {
    load: (pdfPath: string): Promise<Record<number, string>> =>
      ipcRenderer.invoke('notes:load', pdfPath),
    save: (pdfPath: string, notes: Record<number, string>): Promise<void> =>
      ipcRenderer.invoke('notes:save', pdfPath, notes)
  },
  server: {
    connect: (host: string, info: Omit<RegisterMessage, 'type'>): Promise<void> =>
      ipcRenderer.invoke('server:connect', host, info),
    disconnect: (): Promise<void> => ipcRenderer.invoke('server:disconnect'),
    pushSlideState: (state: Omit<SlideStateMessage, 'type'>): Promise<void> =>
      ipcRenderer.invoke('server:push-slide-state', state),
    onStatus: (callback: (status: ConnectionStatus) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: ConnectionStatus): void =>
        callback(status)
      ipcRenderer.on('server:status', listener)
      return (): void => {
        ipcRenderer.removeListener('server:status', listener)
      }
    },
    onCommand: (callback: (command: RemoteCommandMessage['command']) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        command: RemoteCommandMessage['command']
      ): void => callback(command)
      ipcRenderer.on('server:command', listener)
      return (): void => {
        ipcRenderer.removeListener('server:command', listener)
      }
    }
  },
  programOut: {
    listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('program-out:list-displays'),
    open: (displayId?: number): Promise<void> => ipcRenderer.invoke('program-out:open', displayId),
    close: (): Promise<void> => ipcRenderer.invoke('program-out:close'),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke('program-out:is-open'),
    pushState: (state: ProgramOutState): Promise<void> =>
      ipcRenderer.invoke('program-out:push-state', state),
    onOpenChanged: (callback: (open: boolean) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, open: boolean): void => callback(open)
      ipcRenderer.on('program-out:open-changed', listener)
      return (): void => {
        ipcRenderer.removeListener('program-out:open-changed', listener)
      }
    },
    onDisplaysChanged: (callback: (displays: DisplayInfo[]) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, displays: DisplayInfo[]): void =>
        callback(displays)
      ipcRenderer.on('program-out:displays-changed', listener)
      return (): void => {
        ipcRenderer.removeListener('program-out:displays-changed', listener)
      }
    },
    onState: (callback: (state: ProgramOutState) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: ProgramOutState): void =>
        callback(state)
      ipcRenderer.on('program-out:state', listener)
      return (): void => {
        ipcRenderer.removeListener('program-out:state', listener)
      }
    }
  },
  ndiOutput: {
    toggle: (streamId: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke('ndi:toggle', streamId, name),
    isActive: (streamId: string): Promise<boolean> => ipcRenderer.invoke('ndi:is-active', streamId),
    pushFrame: (streamId: string, data: Uint8Array, width: number, height: number): Promise<void> =>
      ipcRenderer.invoke('ndi:push-frame', streamId, data, width, height)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
