// server/msGraphEmail.js
import * as msal from "@azure/msal-node";
import fetch from "node-fetch";

// Uses app registration with client credentials
// ENV you must set for REAL sending:
// - MS_TENANT_ID
// - MS_CLIENT_ID
// - MS_CLIENT_SECRET
// - MS_SENDER_UPN  (e.g. "trainer.bot@yourorg.com")

const tenantId = process.env.MS_TENANT_ID;
const clientId = process.env.MS_CLIENT_ID;
const clientSecret = process.env.MS_CLIENT_SECRET;
const senderUpn = process.env.MS_SENDER_UPN;

// Do we have a complete config?
const hasConfig =
  !!tenantId && !!clientId && !!clientSecret && !!senderUpn;

if (!hasConfig) {
  console.warn(
    "[msGraphEmail] Missing one of MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_SENDER_UPN env vars. " +
      "Emails will NOT actually be sent in this environment."
  );
}

let cca = null;
if (hasConfig) {
  cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });
}

async function getGraphToken() {
  if (!cca) {
    throw new Error(
      "Graph email is not configured (missing env vars)."
    );
  }

  const result = await cca.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });

  if (!result || !result.accessToken) {
    throw new Error("Failed to acquire Graph access token");
  }
  return result.accessToken;
}


/**
 * Send an HTML email through Microsoft Graph with optional attachments.
 *
 * @param {{to: string[], subject: string, htmlBody: string, attachments?: {name: string, contentType: string, contentBytes: string}[]}} opts
 */
export async function sendGraphMail({
  to,
  subject,
  htmlBody,
  attachments = [],
}) {
  // DEV FALLBACK: if Graph is not configured, just log and return.
  if (!hasConfig) {
    console.log(
      "[msGraphEmail] (DEV noop) Would send mail:",
      JSON.stringify(
        {
          to,
          subject,
          attachmentsCount: attachments.length,
        },
        null,
        2
      )
    );
    return;
  }

  const token = await getGraphToken();

  const payload = {
    message: {
      subject,
      body: {
        contentType: "HTML",
        content: htmlBody,
      },
      toRecipients: to.map((addr) => ({
        emailAddress: { address: addr },
      })),
      attachments: attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.name,
        contentType: att.contentType,
        contentBytes: att.contentBytes, // base64 string
      })),
    },
    saveToSentItems: true,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      senderUpn
    )}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[msGraphEmail] sendMail failed:", res.status, text);
    throw new Error(`Graph sendMail failed: ${res.status}`);
  }
}
