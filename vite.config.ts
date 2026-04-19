import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "mask-icon.svg"
      ],

      // Enable PWA in dev mode (for local testing)
      devOptions: {
        enabled: true,
      },

      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Increase the maximum file size to cache (default is 2 MiB)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
      },

      manifest: {
        name: "GrapeSEED Observations",
        short_name: "GS Obs",
        description: "Offline-capable Teacher Observation App",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],

  optimizeDeps: {
    exclude: ["@xenova/transformers"],
  },

  build: {
    target: "esnext",
  },

  server: {
    proxy: {
      "/api/ocr-azure": {
        target: "http://localhost:4001",
        changeOrigin: true,
        secure: false,
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});