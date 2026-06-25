import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Sentinel dashboard SPA. The bot hosts the REST + WS API on API_PORT (default 4000);
// in dev we proxy /api and /ws to it so the client can use same-origin paths.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
