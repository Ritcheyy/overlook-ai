// Browser-only build of the renderer. With no Electron bridge present the UI
// runs the demo engine in-process, which is what the Playwright web tests use.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  build: { outDir: resolve('dist-web'), emptyOutDir: true },
  server: { port: 5199, strictPort: true }
})
