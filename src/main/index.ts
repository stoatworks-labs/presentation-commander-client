import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { serverLink } from './services/serverLink'
import { ndiSenderService } from './services/ndiSender'
import { keynoteBridge } from './services/keynoteBridge'
import { browserBridge } from './services/browserBridge'
import type { RegisterMessage, SlideStateMessage } from '../shared/protocol'
import type { ProgramOutState } from '../shared/programOut'

interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  internal: boolean
  primary: boolean
}

let programOutWindow: BrowserWindow | null = null
let latestProgramOutState: ProgramOutState | null = null

function notesPathFor(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, '.notes.json')
}

function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || (d.internal ? 'Built-in Display' : `Display ${i + 1}`),
    width: d.bounds.width,
    height: d.bounds.height,
    internal: d.internal ?? false,
    primary: d.id === primary.id
  }))
}

function loadRenderer(win: BrowserWindow, mode?: string): void {
  const search = mode ? `mode=${mode}` : undefined
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (mode) url.searchParams.set('mode', mode)
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), search ? { search } : undefined)
  }
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1013',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`)
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(mainWindow)

  return mainWindow
}

function closeProgramOut(): void {
  programOutWindow?.close()
}

function openProgramOut(mainWindow: BrowserWindow, displayId?: number): void {
  if (programOutWindow) return

  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const chosen = displayId !== undefined ? displays.find((d) => d.id === displayId) : undefined
  const target = chosen ?? displays.find((d) => d.id !== primary.id) ?? primary

  const win = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Setting fullscreen at construction time can leave the window invisible
  // to the OS window server on macOS; show it plain first, then transition.
  win.once('ready-to-show', () => {
    win.show()
    win.setFullScreen(true)
  })

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') closeProgramOut()
  })

  if (is.dev) {
    win.webContents.on('console-message', (event) => {
      console.log(`[program-out:${event.level}] ${event.message}`)
    })
  }

  win.on('closed', () => {
    programOutWindow = null
    mainWindow.webContents.send('program-out:open-changed', false)
  })

  win.webContents.once('did-finish-load', () => {
    if (latestProgramOutState) win.webContents.send('program-out:state', latestProgramOutState)
  })

  loadRenderer(win, 'program-out')
  programOutWindow = win
  mainWindow.webContents.send('program-out:open-changed', true)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.presentationcommander.client')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()

  serverLink.on('status', (status) => mainWindow.webContents.send('server:status', status))
  serverLink.on('command', (command) => mainWindow.webContents.send('server:command', command))
  keynoteBridge.on('current-slide-changed', (page: number) =>
    mainWindow.webContents.send('keynote:current-slide-changed', page)
  )
  browserBridge.on('slide-update', (update) =>
    mainWindow.webContents.send('browser-bridge:slide-update', update)
  )
  browserBridge.start()

  ipcMain.handle('system:info', () => ({
    hostname: os.hostname().replace(/\.local$/, ''),
    platform: process.platform === 'darwin' ? 'macos' : 'windows'
  }))

  ipcMain.handle('pdf:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const data = await readFile(filePath)
    return { filePath, data: data.toString('base64') }
  })

  ipcMain.handle('keynote:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Keynote', extensions: ['key'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const opened = await keynoteBridge.open(filePath)
    return { filePath, ...opened }
  })
  ipcMain.handle('keynote:goto', (_e, page: number) => keynoteBridge.goTo(page))
  ipcMain.handle('keynote:close', () => keynoteBridge.close())

  ipcMain.handle('browser-bridge:navigate', (_e, direction: 'next' | 'previous') =>
    browserBridge.navigate(direction)
  )

  ipcMain.handle('notes:load', async (_e, pdfPath: string) => {
    try {
      const raw = await readFile(notesPathFor(pdfPath), 'utf-8')
      return JSON.parse(raw) as Record<number, string>
    } catch {
      return {}
    }
  })

  ipcMain.handle('notes:save', async (_e, pdfPath: string, notes: Record<number, string>) => {
    await writeFile(notesPathFor(pdfPath), JSON.stringify(notes, null, 2), 'utf-8')
  })

  ipcMain.handle('server:connect', (_e, host: string, info: Omit<RegisterMessage, 'type'>) =>
    serverLink.connect(host, info)
  )
  ipcMain.handle('server:disconnect', () => serverLink.disconnect())
  ipcMain.handle('server:push-slide-state', (_e, state: Omit<SlideStateMessage, 'type'>) =>
    serverLink.pushSlideState(state)
  )

  ipcMain.handle('program-out:list-displays', () => listDisplays())
  ipcMain.handle('program-out:open', (_e, displayId?: number) =>
    openProgramOut(mainWindow, displayId)
  )
  ipcMain.handle('program-out:close', () => closeProgramOut())
  ipcMain.handle('program-out:is-open', () => programOutWindow !== null)
  ipcMain.handle('program-out:push-state', (_e, state: ProgramOutState) => {
    latestProgramOutState = state
    programOutWindow?.webContents.send('program-out:state', state)
  })

  screen.on('display-added', () =>
    mainWindow.webContents.send('program-out:displays-changed', listDisplays())
  )
  screen.on('display-removed', () =>
    mainWindow.webContents.send('program-out:displays-changed', listDisplays())
  )

  ipcMain.handle('ndi:toggle', (_e, name: string) => {
    if (ndiSenderService.isActive()) {
      ndiSenderService.stop()
    } else {
      ndiSenderService.start(name)
    }
    return ndiSenderService.isActive()
  })
  ipcMain.handle('ndi:is-active', () => ndiSenderService.isActive())
  ipcMain.handle('ndi:push-frame', (_e, data: Uint8Array, width: number, height: number) => {
    ndiSenderService.sendFrame(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      width,
      height
    )
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  serverLink.disconnect()
  ndiSenderService.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
