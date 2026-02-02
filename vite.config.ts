import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
//import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
//    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      
      // 🟢 ENABLE TESTING IN DEV MODE (Important!)
      devOptions: {
        enabled: true
      },

      // 🟢 CRITICAL CACHING RULES
      // This tells the browser to save these files for offline use
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },

      manifest: {
        name: 'GrapeSEED Observations',
        short_name: 'GS Obs',
        description: 'Offline-capable Teacher Observation App',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
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
  // 🟢 NEW: Optimization for Transformers.js and WebGPU/M4
  optimizeDeps: {
    exclude: ['@xenova/transformers']
  },
  build: {
    target: 'esnext'
  },
  server: {
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