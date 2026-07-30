import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { serverLink } from './services/serverLink'
import { ndiSenderService } from './services/ndiSender'
import { keynoteBridge } from './services/keynoteBridge'
import { powerpointBridge } from './services/powerpointBridge'
import { browserBridge } from './services/browserBridge'
import type { BrowserSourceApp } from './services/browserBridge'
import { screenCaptureService } from './services/screenCapture'
import { getOAuthStatus, setOAuthClientId } from './services/googleSlidesSetup'
import { oscControlServer } from './services/oscControlServer'
import { fileControl } from './services/fileControl'
import { setWallpaper } from './services/wallpaper'
import type { RegisterMessage, SlideStateMessage } from '../shared/protocol'
import type { ProgramOutState, LaserPosition } from '../shared/programOut'
import type { OscArg, OscConfig } from '../shared/osc'
import { collectDiagnostics, init as initDiag, say } from './diag/index.js'
import { installElectronDiagnostics } from './diag/electron.js'

// Before anything that can fail, so a failure during startup is logged and
// captured like any other. An Electron app is several processes, so the
// renderer and GPU hooks go in too - neither raises anything the main
// process's uncaughtException handler can see.
initDiag({
  app: 'presentation-commander-client',
  envPrefix: 'PC_CLIENT',
  version: '1.1.0',
  cwd: app_diag_cwd()
})
installElectronDiagnostics()

if (process.argv.includes('--collect-diagnostics')) {
  // stdout, so it can be used in a script; logging went to stderr.
  say.info(collectDiagnostics())
  app.exit(0)
}

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

/**
 * A sidecar written by `presentation-converter`.
 *
 * That tool records provenance alongside the notes (source deck, engines used,
 * per-slide detail, and whether hidden slides shifted the page mapping), so the
 * notes live under a `notes` key rather than at the top level.
 */
interface GeneratedSidecar {
  schemaVersion: number
  notes: Record<string, string>
  slides?: Array<{ page: number | null; index: number; notes: string; hidden: boolean }>
}

function isGeneratedSidecar(value: unknown): value is GeneratedSidecar {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GeneratedSidecar>
  return typeof candidate.schemaVersion === 'number' && typeof candidate.notes === 'object'
}

/**
 * Reads either sidecar shape: the generated one above, or the bare
 * `{ "1": "note" }` map this app has always written itself.
 */
function notesFromSidecar(parsed: unknown): Record<number, string> {
  const source = isGeneratedSidecar(parsed) ? parsed.notes : parsed
  const notes: Record<number, string> = {}
  if (!source || typeof source !== 'object') return notes
  for (const [key, note] of Object.entries(source as Record<string, unknown>)) {
    if (/^\d+$/.test(key) && typeof note === 'string') notes[Number(key)] = note
  }
  return notes
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
      sandbox: false,
      // Confirmed live: Chromium throttles setInterval in backgrounded
      // windows hard enough to stall the live-capture push loop (see
      // liveCapture.ts) within seconds — and this app is backgrounded by
      // design during real use, since the presenter app (Keynote/
      // PowerPoint) is what's actually frontmost while presenting. Without
      // this flag, live capture only works while this window happens to be
      // focused, which defeats the point of it.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Closing the console shouldn't leave Program Out orphaned and
  // unreachable — confirmed live as a real bug (Windows, in the sibling
  // pdf-presenter-lite app, same shape here): 'window-all-closed' never
  // fires while Program Out is still open, and closing it afterward
  // crashes trying to notify an already-destroyed mainWindow (see the
  // 'closed' handler below).
  mainWindow.on('close', () => {
    programOutWindow?.close()
  })

  if (is.dev) {
    mainWindow.webContents.on('console-message', (event) => {
      say.info(`[renderer:${event.level}] ${event.message}`)
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
      say.info(`[program-out:${event.level}] ${event.message}`)
    })
  }

  win.on('closed', () => {
    programOutWindow = null
    // mainWindow may already be destroyed by the time this fires (e.g. the
    // main window closed first and is tearing down Program Out as part of
    // that, per the 'close' handler above) — sending to a destroyed window
    // throws.
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('program-out:open-changed', false)
    }
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

  // These listeners live for the app's whole lifetime and close over this
  // one mainWindow instance — guarded against it being destroyed (e.g.
  // mid-shutdown, or an event racing the window close) rather than
  // throwing on a stale reference.
  serverLink.on('status', (status) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('server:status', status)
  })
  serverLink.on('command', (command) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('server:command', command)
  })
  keynoteBridge.on('current-slide-changed', (page: number) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('keynote:current-slide-changed', page)
    }
  })
  powerpointBridge.on('current-slide-changed', (page: number) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('powerpoint:current-slide-changed', page)
    }
  })
  browserBridge.on('slide-update', (update) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-bridge:slide-update', update)
    }
  })
  browserBridge.start()
  screenCaptureService.installDisplayMediaHandler()

  oscControlServer.on('action', (action) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('osc:action', action)
  })
  oscControlServer.on('status-changed', (running: boolean) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('osc:status-changed', running)
  })
  oscControlServer.loadConfig().then((config) => {
    if (config.autoStart) oscControlServer.start()
  })
  fileControl.loadConfig()

  ipcMain.handle('screen-capture:list-sources', () => screenCaptureService.listSources())
  ipcMain.handle('screen-capture:set-active', (_e, sourceId: string | null) =>
    screenCaptureService.setActiveSource(sourceId)
  )
  ipcMain.handle('screen-capture:permission-status', () =>
    screenCaptureService.getPermissionStatus()
  )
  ipcMain.handle('screen-capture:open-permission-settings', () =>
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  )

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

  ipcMain.handle('powerpoint:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const opened = await powerpointBridge.open(filePath)
    return { filePath, ...opened }
  })
  ipcMain.handle('powerpoint:goto', (_e, page: number) => powerpointBridge.goTo(page))
  ipcMain.handle('powerpoint:close', () => powerpointBridge.close())
  ipcMain.handle('powerpoint:media-toggle', () => powerpointBridge.mediaToggle())
  ipcMain.handle('powerpoint:media-duration', (_e, page: number) =>
    powerpointBridge.getMediaDuration(page)
  )

  ipcMain.handle(
    'browser-bridge:navigate',
    (_e, direction: 'next' | 'previous', app: BrowserSourceApp) =>
      browserBridge.navigate(direction, app)
  )

  ipcMain.handle('google-slides-setup:get-status', () => getOAuthStatus())
  ipcMain.handle('google-slides-setup:set-client-id', (_e, clientId: string) =>
    setOAuthClientId(clientId)
  )

  ipcMain.handle('notes:load', async (_e, pdfPath: string) => {
    try {
      const raw = await readFile(notesPathFor(pdfPath), 'utf-8')
      return notesFromSidecar(JSON.parse(raw))
    } catch {
      return {}
    }
  })

  ipcMain.handle('notes:save', async (_e, pdfPath: string, notes: Record<number, string>) => {
    const path = notesPathFor(pdfPath)

    // Preserve a generated sidecar's envelope. Writing the bare note map over
    // it would discard the source deck, engine record and hidden-slide mapping
    // that presentation-converter put there.
    try {
      const existing: unknown = JSON.parse(await readFile(path, 'utf-8'))
      if (isGeneratedSidecar(existing)) {
        const merged = {
          ...existing,
          notes: Object.fromEntries(Object.entries(notes).map(([page, note]) => [page, note])),
          ...(existing.slides
            ? {
                slides: existing.slides.map((slide) =>
                  slide.page === null ? slide : { ...slide, notes: notes[slide.page] ?? '' }
                )
              }
            : {})
        }
        await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
        return
      }
    } catch {
      // No readable sidecar yet — fall through and write the plain map.
    }

    await writeFile(path, JSON.stringify(notes, null, 2), 'utf-8')
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
  // High-frequency (mousemove-driven) — deliberately not persisted like
  // latestProgramOutState above, since replaying a stale position to a
  // freshly-opened Program Out window has no value (the presenter's mouse
  // has long since moved on).
  ipcMain.handle('program-out:push-laser-position', (_e, position: LaserPosition | null) => {
    programOutWindow?.webContents.send('program-out:laser-position', position)
  })

  screen.on('display-added', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('program-out:displays-changed', listDisplays())
    }
  })
  screen.on('display-removed', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('program-out:displays-changed', listDisplays())
    }
  })

  ipcMain.handle('ndi:toggle', (_e, streamId: string, name: string) => {
    if (ndiSenderService.isActive(streamId)) {
      ndiSenderService.stop(streamId)
    } else {
      ndiSenderService.start(streamId, name)
    }
    return ndiSenderService.isActive(streamId)
  })
  ipcMain.handle('ndi:is-active', (_e, streamId: string) => ndiSenderService.isActive(streamId))
  ipcMain.handle(
    'ndi:push-frame',
    (_e, streamId: string, data: Uint8Array, width: number, height: number) => {
      ndiSenderService.sendFrame(
        streamId,
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        width,
        height
      )
    }
  )

  ipcMain.handle('osc:start', () => oscControlServer.start())
  ipcMain.handle('osc:stop', () => oscControlServer.stop())
  ipcMain.handle('osc:is-running', () => oscControlServer.isRunning())
  ipcMain.handle('osc:get-config', () => oscControlServer.getConfig())
  ipcMain.handle('osc:set-config', (_e, next: Partial<OscConfig>) =>
    oscControlServer.setConfig(next)
  )
  ipcMain.handle('osc:send', (_e, address: string, args: OscArg[]) =>
    oscControlServer.send(address, args)
  )

  ipcMain.handle('wallpaper:set', (_e, base64Png: string) =>
    setWallpaper(Buffer.from(base64Png, 'base64'))
  )

  ipcMain.handle('files:get-config', () => fileControl.getConfig())
  ipcMain.handle('files:set-enabled', (_e, enabled: boolean) => fileControl.setEnabled(enabled))
  ipcMain.handle('files:set-folder-relative', (_e, relativePath: string) =>
    fileControl.setFolderPathRelativeToHome(relativePath)
  )
  ipcMain.handle('files:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return fileControl.getConfig()
    return fileControl.setFolderPath(result.filePaths[0])
  })
  ipcMain.handle('files:list', () => fileControl.listFiles())
  ipcMain.handle('files:open', async (_e, filename: string) => {
    const filePath = fileControl.resolveFilename(filename)
    if (!filePath) return null
    const ext = extname(filePath).toLowerCase()
    try {
      if (ext === '.pdf') {
        const data = await readFile(filePath)
        return { kind: 'pdf' as const, filePath, data: data.toString('base64') }
      }
      if (ext === '.key') {
        const opened = await keynoteBridge.open(filePath)
        return { kind: 'keynote' as const, filePath, ...opened }
      }
      if (ext === '.pptx' || ext === '.ppt') {
        const opened = await powerpointBridge.open(filePath)
        return { kind: 'powerpoint' as const, filePath, ...opened }
      }
      return null
    } catch (err) {
      say.error(`Failed to open OSC-requested file ${filePath}`, err)
      return null
    }
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  serverLink.disconnect()
  ndiSenderService.stopAll()
  oscControlServer.shutdown()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})


/** Repo root when running from source; irrelevant once packaged, where
 *  there is no .git and the git revision reads as 'unknown'. */
function app_diag_cwd(): string {
  return join(__dirname, '../../..')
}
