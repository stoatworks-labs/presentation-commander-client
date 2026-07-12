import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ConnectionStatus,
  RegisterMessage,
  RemoteCommandMessage,
  SlideStateMessage
} from '../shared/protocol'

interface OpenPdfResult {
  filePath: string
  data: string
}

interface SystemInfo {
  hostname: string
  platform: 'windows' | 'macos'
}

const api = {
  system: {
    info: (): Promise<SystemInfo> => ipcRenderer.invoke('system:info')
  },
  pdf: {
    open: (): Promise<OpenPdfResult | null> => ipcRenderer.invoke('pdf:open')
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
