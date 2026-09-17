import { app, BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrap } from './bootstrap'
import { appIconPath, createWindow } from './window'

// Must run before `ready`: the e2e harness points each run at a fresh
// profile so state and Chromium caches never leak between runs.
const userData = process.env['OVERLOOK_USER_DATA']
if (userData) {
  const sessionData = join(userData, 'session')
  mkdirSync(sessionData, { recursive: true })
  app.setPath('userData', userData)
  app.setPath('sessionData', sessionData)
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const icon = appIconPath()
    if (icon) app.dock?.setIcon(icon)
  }
  const engine = await bootstrap()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // The engine persists on a debounce, so quitting straight after an action
  // would lose it; hold the quit until the final save has landed.
  let stopping: Promise<void> | null = null
  app.on('before-quit', (event) => {
    if (stopping) return
    event.preventDefault()
    stopping = engine
      .stop()
      .catch(() => undefined)
      .then(() => app.quit())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
