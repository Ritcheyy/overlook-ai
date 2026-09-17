import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@core': resolve('src/core') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@core': resolve('src/core') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
