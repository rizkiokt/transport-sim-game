import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/,
// so the bundle needs a matching base path. The deploy workflow sets
// BASE_PATH; local dev and user/org pages fall back to root.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/game', import.meta.url)),
      '@content': fileURLToPath(new URL('./src/content', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The whole game is hand-written code with no runtime deps, so a single
    // chunk avoids waterfall requests on slow tablet connections.
    cssCodeSplit: false,
  },
  server: {
    host: true,
    port: 5173,
  },
})
