import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Relative base + HashRouter means the build works on GitHub Pages under any
// repository name without extra configuration.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
