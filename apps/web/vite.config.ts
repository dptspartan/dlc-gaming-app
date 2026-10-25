import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// Relative base + HashRouter means the build works on GitHub Pages under any
// repository name without extra configuration.
export default defineConfig(({ mode }) => {
  // A misspelt theme lock would silently bring the switcher back, so fail the build instead.
  const lock = loadEnv(mode, process.cwd(), 'VITE_').VITE_THEME_LOCK
  if (lock && lock !== 'dlc-labs' && lock !== 'classic') {
    throw new Error(`VITE_THEME_LOCK must be "dlc-labs" or "classic", got "${lock}"`)
  }
  return {
    base: './',
    plugins: [react(), tailwindcss()],
  }
})
