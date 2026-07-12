import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { serverLink } from './services/serverLink'
import type { RegisterMessage, SlideStateMessage } from '../shared/protocol'

function notesPathFor(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, '.notes.json')
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.livemaster.client-node')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()

  serverLink.on('status', (status) => mainWindow.webContents.send('server:status', status))
  serverLink.on('command', (command) => mainWindow.webContents.send('server:command', command))

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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  serverLink.disconnect()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
