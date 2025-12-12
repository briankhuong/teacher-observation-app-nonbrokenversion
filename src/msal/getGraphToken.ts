// src/msal/getGraphToken.ts
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { msalInstance, GRAPH_SCOPES } from "./msalInstance";

function pickAccount(): AccountInfo | null {
  const active = msalInstance.getActiveAccount();
  if (active) return active;

  const all = msalInstance.getAllAccounts();
  if (all.length > 0) return all[0];

  return null;
}

/**
 * Get a delegated Graph access token.
 * - Tries silent first.
 * - Falls back to popup ONLY when needed.
 *
 * Call this inside Merge Teacher/Admin click handlers.
 */
export async function getGraphAccessToken(): Promise<string> {
  // Ensure MSAL is initialized
  await msalInstance.initialize();

  let account = pickAccount();

  // If no MSAL account yet, do interactive sign-in (popup) and then continue
  if (!account) {
    const loginResult = await msalInstance.loginPopup({
      scopes: GRAPH_SCOPES,
      prompt: "select_account",
    });
    msalInstance.setActiveAccount(loginResult.account);
    account = loginResult.account;
  }

  // Try silent token acquisition
  try {
    const result: AuthenticationResult = await msalInstance.acquireTokenSilent({
      scopes: GRAPH_SCOPES,
      account: account!,
    });
    return result.accessToken;
  } catch (err: any) {
    // If interaction is required, do popup token acquisition
    if (err instanceof InteractionRequiredAuthError) {
      const result = await msalInstance.acquireTokenPopup({
        scopes: GRAPH_SCOPES,
        account: account!,
      });
      return result.accessToken;
    }
    throw err;
  }
}