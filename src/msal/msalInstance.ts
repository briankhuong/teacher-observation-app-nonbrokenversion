import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

// 1. Get Environment Variables (Client ID and Tenant ID are mandatory)
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;

// 2. Define the Redirect URI based on the environment
let redirectUri: string;

if (import.meta.env.VITE_AZURE_REDIRECT_URI_PROD) {
    // 🟢 PRODUCTION FIX: If the production variable is set (on Vercel), use it.
    // This variable must be set in Vercel to your live URL: 
    // https://teacher-observation-app-nonbrokenve-delta.vercel.app
    redirectUri = import.meta.env.VITE_AZURE_REDIRECT_URI_PROD as string;
} else {
    // 🟢 LOCAL DEVELOPMENT FALLBACK: Use the current browser URL.
    // This is for local testing (http://localhost:5173 or https://192.168.0.86:5173).
    redirectUri = window.location.origin; 
}


if (!clientId || !tenantId) {
  console.error(
    "[MSAL] Missing VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_ID in your .env"
  );
}

// 3. MSAL Configuration
const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "",
    // Use the common authority endpoint for multi-tenant access (or tenant-specific ID)
    authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
    redirectUri, // <--- Uses the dynamically determined URI
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