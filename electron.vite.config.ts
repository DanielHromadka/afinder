import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), activityEmbeddingWorker: resolve(__dirname, 'src/main/services/activityEmbeddingWorker.ts'), fileAssistantWorker: resolve(__dirname, 'src/main/services/fileAssistantWorker.ts') } } }
  },
  preload: {
    resolve: { alias: shared },
    // sandboxed preload must be a single self-contained CJS bundle (screen.ts and remote.ts import no shared values)
    build: { externalizeDeps: false, rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), screen: resolve(__dirname, 'src/preload/screen.ts'), remote: resolve(__dirname, 'src/preload/remote.ts') } } }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()],
    // screen.html: the hidden window that captures a monitor for a viewer; remote.html: the remote desktop window;
    // doom.html: the Games panel's Doom frame, the only page allowed to compile WebAssembly.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), screen: resolve(__dirname, 'src/renderer/screen.html'), remote: resolve(__dirname, 'src/renderer/remote.html'), doom: resolve(__dirname, 'src/renderer/doom.html') } } }
  }
})
