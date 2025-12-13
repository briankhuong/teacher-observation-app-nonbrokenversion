// src/msal/msalInstance.ts
import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

// ✅ Put these in .env (Vite) as VITE_* variables
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;

// Usually: http://localhost:5173
const redirectUri =
  (import.meta.env.VITE_AZURE_REDIRECT_URI as string | undefined) ||
  window.location.origin;

if (!clientId || !tenantId) {
  console.error(
    "[MSAL] Missing VITE_AZURE_CLIENT_ID or VITE_AZURE_TENANT_ID in your .env"
  );
}

const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "",
    authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
    redirectUri,
  },
  cache: {
    // Session storage prevents “remembered forever” surprises.
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

// Scopes required for Excel workbook writes via Graph (delegated)
// Add Mail.Send later if you need sending emails from Graph.
export const GRAPH_SCOPES = [
  "User.Read",
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
];