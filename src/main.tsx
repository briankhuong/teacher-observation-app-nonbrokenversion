// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./AuthGate";

// 🟢 PWA: Import the service worker registration
import { registerSW } from 'virtual:pwa-register';

// 🟢 PWA: Register the Service Worker immediately
const updateSW = registerSW({
  onNeedRefresh() {
    // This runs when you push a new update (e.g., fixed a bug).
    // It asks the user if they want to load the new version.
    if (confirm("New content available. Reload?")) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    // This confirms the app has finished caching and will work without Wi-Fi.
    console.log("✅ App is ready to work offline!");
  },
});

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);