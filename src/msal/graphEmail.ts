// src/msal/graphEmail.ts
import { getGraphAccessToken } from "./getGraphToken";

// ✅ Updated signature to accept ccAddresses
export async function sendGraphEmail(
  toAddresses: string[], 
  ccAddresses: string[], // <--- NEW PARAMETER
  subject: string, 
  bodyHtml: string
) {
  const token = await getGraphAccessToken();

  // Helper to format recipients
  const formatRecipients = (emails: string[]) => 
    emails.map((email) => ({ emailAddress: { address: email.trim() } }));

  const message = {
    subject: subject,
    body: {
      contentType: "HTML",
      content: bodyHtml,
    },
    toRecipients: formatRecipients(toAddresses),
    ccRecipients: formatRecipients(ccAddresses), // <--- NEW FIELD
  };

  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph API Error: ${response.status} ${errorText}`);
  }
}