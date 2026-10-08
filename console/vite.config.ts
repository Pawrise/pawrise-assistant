import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = 'http://127.0.0.1:8100'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1500 },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: { '/graph': API, '/debug': API, '/v1': API, '/health': API },
  },
})
