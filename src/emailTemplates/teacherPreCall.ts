// src/emailTemplates/teacherPreCall.ts

export interface TeacherPreCallTemplateParams {
  teacherName: string;
  schoolName?: string | null;
  campus?: string | null;
  trainerName: string;
  bookingUrl?: string;
  teacherWorkbookUrl?: string | null; // optional for now
}

export function buildTeacherPreCallHtml({
  teacherName,
  schoolName,
  campus,
  trainerName,
  bookingUrl = "https://outlook.office.com/bookwithme/user/4934be01038a468f96e53d4680caf11d@grapeseed.com/meetingtype/wxCeX3Ld6kmEZYhHNBBmGg2?anonymous&ismsaljsauthenabled&ep=mlink",
  teacherWorkbookUrl,
}: TeacherPreCallTemplateParams): string {
  const contextLine =
    schoolName || campus
      ? `<p style="margin:0 0 8px 0;color:#64748b;font-size:14px;">
           <strong>${schoolName ?? ""}</strong>${schoolName && campus ? " – " : ""}${
          campus ?? ""
        }
         </p>`
      : "";

  const workbookBlock = teacherWorkbookUrl
    ? `
      <tr>
        <td style="padding:16px 24px 0 24px;">
          <p style="margin:0 0 8px 0;color:#0f172a;font-size:14px;">
            You can review the latest support notes here:
          </p>
          <p style="margin:0;">
            <a href="${teacherWorkbookUrl}" style="color:#2563eb;text-decoration:none;">
              Open teacher workbook
            </a>
          </p>
        </td>
      </tr>
    `
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Pre-call – GrapeSEED Support</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background-color:#0b1120;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0b1120;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background:#020617;border-radius:16px;border:1px solid #1e293b;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <tr>
              <td style="padding:20px 24px 12px 24px;border-bottom:1px solid #1e293b;">
                <p style="margin:0;color:#64748b;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">
                  GrapeSEED • Teacher Pre-call
                </p>
                <h1 style="margin:6px 0 0 0;font-size:20px;color:#e5e7eb;font-weight:600;">
                  Quick check-in before our coaching call
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px 0 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  Dear ${teacherName},
                </p>
                ${contextLine}
                <p style="margin:8px 0 8px 0;">
                  I’m looking forward to our upcoming GrapeSEED support call. To make
                  the most of our time together, please use the link below to choose a
                  time that works best for you.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 24px 4px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" bgcolor="#2563eb" style="border-radius:999px;">
                      <a
                        href="${bookingUrl}"
                        style="display:inline-block;padding:10px 22px;color:#e5e7eb;
                               font-size:14px;font-weight:500;text-decoration:none;
                               border-radius:999px;background:#2563eb;"
                      >
                        Schedule your support call
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">
                  If the link does not work, please copy and paste this into your browser:<br />
                  <span style="word-break:break-all;color:#9ca3af;">${bookingUrl}</span>
                </p>
              </td>
            </tr>

            ${workbookBlock}

            <tr>
              <td style="padding:20px 24px 0 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  During our call, we can:
                </p>
                <ul style="margin:0 0 12px 20px;padding:0;color:#cbd5f5;font-size:14px;">
                  <li>Review how your students are engaging with GrapeSEED.</li>
                  <li>Celebrate what is going well in your classroom.</li>
                  <li>Discuss next steps or adjustments to better support your class.</li>
                </ul>
                <p style="margin:0 0 16px 0;">
                  If you have any specific questions or topics you’d like to focus on,
                  feel free to reply to this email.
                </p>
                <p style="margin:0 0 4px 0;">
                  Best regards,
                </p>
                <p style="margin:0;">
                  ${trainerName}<br />
                  GrapeSEED Trainer
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px 20px 24px;">
                <p style="margin:0;font-size:11px;color:#6b7280;">
                  This message is intended for the designated recipient teacher and contains
                  information related to GrapeSEED support and coaching.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}