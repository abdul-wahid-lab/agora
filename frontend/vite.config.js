import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths - the dev server doesn't care, but the packaged
  // Electron build loads dist/index.html via file:// (electron/main.cjs),
  // where Vite's default absolute "/assets/..." paths resolve to the
  // filesystem root instead of the app's own folder.
  base: './',
})
