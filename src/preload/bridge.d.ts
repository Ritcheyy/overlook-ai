import type { Bridge } from '@core/ipc-contract'

declare global {
  interface Window {
    bridge?: Bridge
  }
}

export {}
