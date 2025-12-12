import { PublicClientApplication } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_MS_TENANT_ID as string;
const clientId = import.meta.env.VITE_MS_CLIENT_ID as string;

if (!tenantId || !clientId) {
  console.error("[MSAL] Missing VITE_MS_TENANT_ID or VITE_MS_CLIENT_ID");
}

export const msalApp = new PublicClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin, // http://localhost:5173
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
});

// Scopes you already know work in your “simple app”
export const GRAPH_SCOPES = [
  "User.Read",
  "Mail.Send",
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
  "openid",
  "profile",
];

export async function ensureGraphLogin() {
  await msalApp.initialize();
  const accounts = msalApp.getAllAccounts();
  if (accounts.length) {
    msalApp.setActiveAccount(accounts[0]);
    return accounts[0];
  }
  const login = await msalApp.loginPopup({ scopes: GRAPH_SCOPES });
  msalApp.setActiveAccount(login.account);
  return login.account;
}

export async function getGraphAccessToken(): Promise<string> {
  await msalApp.initialize();
  const account = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0];
  if (!account) {
    throw new Error("Not connected to Microsoft yet. Click 'Connect Microsoft' first.");
  }

  try {
    const resp = await msalApp.acquireTokenSilent({
      account,
      scopes: GRAPH_SCOPES,
    });
    return resp.accessToken;
  } catch {
    // fallback if silent fails
    const resp = await msalApp.acquireTokenPopup({
      account,
      scopes: GRAPH_SCOPES,
    });
    return resp.accessToken;
  }
}