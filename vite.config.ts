import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    proxy: {
      // 1. Existing OCR Rule (Keep this)
      '/api/ocr-azure': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
      },
      // 2. NEW EXCEL MERGE RULE (Add this!)
      // This catches /api/merge-admin and /api/merge-teacher
      '/api': {
        target: 'http://localhost:4000', // Points to your Main Server
        changeOrigin: true,
        secure: false,
      },
    },
  },
})