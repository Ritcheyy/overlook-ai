/**
 * Typed client for the engine. Inside Electron it goes over the preload
 * bridge; in a plain browser (dev:web, Playwright web project) it runs the
 * demo engine in-process so the whole UI works without Electron.
 */
import type { Api, ApiArgs, ApiMethod, ApiResult, Engine, PushEvent, PushEvents } from '@core/ipc-contract'
import { API_METHODS } from '@core/ipc-contract'
import { createDemoEngine } from '@core/demo/engine'

let demoEngine: Engine | null = null

function getDemoEngine(): Engine {
  if (!demoEngine) {
    const stepMs = typeof window.__OVERLOOK_DEMO_STEP_MS__ === 'number' ? window.__OVERLOOK_DEMO_STEP_MS__ : 1500
    demoEngine = createDemoEngine({
      stepMs,
      version: 'web-demo',
      openExternal: async (url) => {
        window.open(url, '_blank', 'noopener')
      }
    })
    void demoEngine.start()
  }
  return demoEngine
}

function bridgeApi(): Api {
  const bridge = window.bridge!
  const api = {} as Record<ApiMethod, (...args: unknown[]) => Promise<unknown>>
  for (const method of API_METHODS) {
    api[method] = (...args: unknown[]) =>
      bridge.invoke(method, ...(args as ApiArgs<typeof method>)) as Promise<ApiResult<typeof method>>
  }
  return api as unknown as Api
}

export const isElectron = typeof window !== 'undefined' && !!window.bridge

export const api: Api = isElectron ? bridgeApi() : getDemoEngine().api

export function onPush<E extends PushEvent>(event: E, cb: (payload: PushEvents[E]) => void): () => void {
  if (isElectron) return window.bridge!.on(event, cb)
  return getDemoEngine().subscribe(event, cb)
}
