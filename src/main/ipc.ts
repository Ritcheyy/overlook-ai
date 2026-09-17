import { BrowserWindow, ipcMain } from 'electron'
import type { Api, ApiMethod, Engine, PushEvent, PushEvents } from '@core/ipc-contract'
import { API_METHODS, PUSH_EVENTS, apiChannel, pushChannel } from '@core/ipc-contract'

/** Exposes every Api method over `api:<method>` and forwards pushes to all windows. */
export function wireEngineToIpc(engine: Engine): () => void {
  const api = engine.api
  for (const method of API_METHODS) {
    ipcMain.handle(apiChannel(method), (_event, ...args: unknown[]) => {
      const fn = api[method as ApiMethod] as (...a: unknown[]) => Promise<unknown>
      return fn.apply(api, args)
    })
  }
  const unsubs = PUSH_EVENTS.map((event) =>
    engine.subscribe(event as PushEvent, (payload: PushEvents[PushEvent]) => broadcast(event, payload))
  )
  return () => {
    for (const method of API_METHODS) ipcMain.removeHandler(apiChannel(method))
    unsubs.forEach((u) => u())
  }
}

export function broadcast<E extends PushEvent>(event: E, payload: PushEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(pushChannel(event), payload)
  }
}

export type { Api }
