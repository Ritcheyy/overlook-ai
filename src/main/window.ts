import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The unpackaged icon, present in dev checkouts; packaged builds get theirs from the bundle. */
export function appIconPath(): string | undefined {
  const path = join(app.getAppPath(), 'resources', 'icon.png')
  return existsSync(path) ? path : undefined
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Overlook',
    icon: process.platform === 'darwin' ? undefined : appIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Brings the first open window forward, or opens a new one (macOS keeps the app alive with none). */
export function showMainWindow(): { win: BrowserWindow; created: boolean } {
  const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return { win: existing, created: false }
  }
  return { win: createWindow(), created: true }
}
