import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url))))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths - the dev server doesn't care, but the packaged
  // Electron build loads dist/index.html via file:// (electron/main.cjs),
  // where Vite's default absolute "/assets/..." paths resolve to the
  // filesystem root instead of the app's own folder.
  base: './',
  define: {
    // Settings > About shows a real version number, not a hardcoded
    // string that could drift from package.json - single source of truth.
    __AGORA_VERSION__: JSON.stringify(pkg.version),
  },
})
