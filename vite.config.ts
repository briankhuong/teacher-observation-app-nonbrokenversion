import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa' // 🟢 1. Import PWA Plugin

export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    // 🟢 2. Add PWA Configuration here
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'GrapeSEED Observations',
        short_name: 'GS Obs',
        description: 'Offline-capable Teacher Observation App',
        theme_color: '#0f172a', // Matches your dark theme
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png', // Ensure this file exists in /public
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png', // Ensure this file exists in /public
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    // 🔒 Your existing Proxy Rules (KEPT SAFE)
    proxy: {
      '/api/ocr-azure': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})