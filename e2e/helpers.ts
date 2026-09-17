import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface OpenWebAppOptions {
  /** Milliseconds per fake step in the in-browser demo engine. 0 (default) makes reviews instant. */
  stepMs?: number
  /** Path relative to the project's baseURL. */
  path?: string
}

/** Loads the browser build with the demo engine paced at `stepMs`. Call before any other navigation on the page. */
export async function openWebApp(page: Page, opts: OpenWebAppOptions = {}): Promise<Page> {
  const stepMs = opts.stepMs ?? 0
  await page.addInitScript((ms: number) => {
    ;(window as Window & { __OVERLOOK_DEMO_STEP_MS__?: number }).__OVERLOOK_DEMO_STEP_MS__ = ms
  }, stepMs)
  await page.goto(opts.path ?? '/')
  await page.waitForLoadState('domcontentloaded')
  return page
}

export interface ElectronHarness {
  app: ElectronApplication
  page: Page
  /** The fresh profile directory this instance writes state.json into. */
  userData: string
}

export interface LaunchElectronOptions {
  /** Reuse a profile from an earlier launch (restart tests); a fresh temp dir otherwise. */
  userData?: string
  env?: Record<string, string>
}

function definedEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') out[k] = v
  // Inherited from Electron-hosted terminals; it turns the app into a bare Node process.
  delete out['ELECTRON_RUN_AS_NODE']
  return out
}

/** Starts the built app (`pnpm build` first) in demo mode against an isolated profile and waits for the first window. */
export async function launchElectron(opts: LaunchElectronOptions = {}): Promise<ElectronHarness> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'overlook-e2e-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...definedEnv(),
      OVERLOOK_DEMO: '1',
      OVERLOOK_USER_DATA: userData,
      ELECTRON_ENABLE_LOGGING: '1',
      ...opts.env
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userData }
}
