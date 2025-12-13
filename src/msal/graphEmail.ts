// src/msal/graphEmail.ts
import { getGraphAccessToken } from "./getGraphToken";

export async function sendGraphEmail(
  toAddresses: string[], 
  subject: string, 
  bodyHtml: string
) {
  const token = await getGraphAccessToken();

  // Graph API expects an array of objects for recipients
  const toRecipients = toAddresses.map((email) => ({
    emailAddress: { address: email.trim() },
  }));

  const message = {
    subject: subject,
    body: {
      contentType: "HTML",
      content: bodyHtml,
    },
    toRecipients: toRecipients,
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