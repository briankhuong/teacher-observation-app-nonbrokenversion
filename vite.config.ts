import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  server: {
    proxy: {
      // 🔹 PROXY RULE:
      // Any request made to "/api/ocr-azure" in your React code
      // will be silently forwarded to "http://localhost:4001/api/ocr-azure"
      '/api/ocr-azure': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})