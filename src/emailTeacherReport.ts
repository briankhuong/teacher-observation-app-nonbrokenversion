// src/emailTeacherReport.ts
import type { TeacherExportModel } from "./exportTeacherModel";

export interface EmailTeacherPayload {
  teacherEmail: string;
  teacherName: string;
  model: TeacherExportModel;
}

/**
 * Base URL for the Node OCR + Email server.
 *
 * - In dev you can override with VITE_EMAIL_API_BASE in .env.local
 * - Otherwise it falls back to http://<current-hostname>:4000
 */
const EMAIL_API_BASE: string =
  (import.meta as any).env?.VITE_EMAIL_API_BASE ??
  `http://${window.location.hostname}:4000`;

/**
 * Call the Node server to send the teacher report via Microsoft Graph.
 * Assumes:
 *   - server/index.js is running on EMAIL_API_BASE
 *   - server/index.js has `app.use("/api/email", emailTeacherRoute);`
 *   - emailTeacherRoute.js uses msGraphEmail.js to send the mail
 */
export async function emailTeacherReport(
  payload: EmailTeacherPayload
): Promise<void> {
  const res = await fetch(`${EMAIL_API_BASE}/api/email/teacher-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      "[emailTeacherReport] backend failed",
      res.status,
      text || "<no body>"
    );
    throw new Error(
      `Failed to email teacher report (Graph status ${res.status}).`
    );
  }

  // Optionally check { ok: true } from the backend
  // const json = await res.json().catch(() => null);
  // if (!json?.ok) throw new Error("Backend did not confirm success");
}