// src/msal/msalInstance.ts
import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;

// ❌ REMOVED: import.meta.env.VITE_AZURE_REDIRECT_URI ...
// ✅ NEW: Always use the current browser URL (Dynamic)
// On Mac, this is "https://localhost:5173"
// On iPad, this is "https://192.168.0.86:5173"
const redirectUri = window.location.origin; 

if (!clientId || !tenantId) {
  console.error(
    "[MSAL] Missing VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_ID in your .env"
  );
}

const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "",
    authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
    redirectUri, // <--- Now it is always dynamic
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const GRAPH_SCOPES = [
  "User.Read",
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
];