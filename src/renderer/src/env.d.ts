/// <reference types="vite/client" />
import type { Bridge } from '@core/ipc-contract'

declare global {
  interface Window {
    bridge?: Bridge
    /** Set by the e2e harness to make the in-browser demo run instantly. */
    __OVERLOOK_DEMO_STEP_MS__?: number
  }
}

export {}
