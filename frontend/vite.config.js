import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, API calls are proxied to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000', '/docs': 'http://localhost:8000', '/openapi.json': 'http://localhost:8000' } },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'], qr: ['html5-qrcode'] },
      },
    },
  },
})
