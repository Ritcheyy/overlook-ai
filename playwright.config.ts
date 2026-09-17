import { defineConfig, devices } from '@playwright/test'

const WEB_PORT = 5199
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`

/** Headless Chromium has no GPU; SwiftShader keeps the WebGL floor rendering. */
const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

/** `--project=electron` (or `--project electron`) alone should not boot the web preview. */
function onlyProject(name: string): boolean {
  const argv = process.argv
  const wanted = argv.flatMap((a, i) => (a === '--project' ? [argv[i + 1]] : a.startsWith('--project=') ? [a.slice('--project='.length)] : []))
  return wanted.length > 0 && wanted.every((p) => p === name)
}

export default defineConfig({
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'web',
      testDir: 'e2e/web',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: WEB_URL,
        launchOptions: { args: SOFTWARE_GL_ARGS }
      }
    },
    {
      name: 'electron',
      testDir: 'e2e/electron'
    }
  ],
  webServer: onlyProject('electron')
    ? undefined
    : {
        // Serves dist-web; run `pnpm build:web` first. Bound to 127.0.0.1 explicitly
        // because `localhost` may resolve to ::1 only, which the baseURL would miss.
        command: `npx vite preview --config vite.web.config.ts --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 60_000
      }
})
