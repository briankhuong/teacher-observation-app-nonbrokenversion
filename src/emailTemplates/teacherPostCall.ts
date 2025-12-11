// src/emailTemplates/teacherPostCall.ts

export interface TeacherPostCallTemplateParams {
  teacherName: string;
  schoolName?: string | null;
  campus?: string | null;
  trainerName: string;
  teacherWorkbookUrl?: string | null;
  surveyUrl?: string | null;
}

export function buildTeacherPostCallHtml({
  teacherName,
  schoolName,
  campus,
  trainerName,
  teacherWorkbookUrl,
  surveyUrl,
}: TeacherPostCallTemplateParams): string {
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
          <p style="margin:0 0 6px 0;color:#0f172a;font-size:14px;">
            Here is the workbook with notes from our recent support:
          </p>
          <p style="margin:0 0 6px 0;">
            <a href="${teacherWorkbookUrl}" style="color:#2563eb;text-decoration:none;">
              Open teacher workbook
            </a>
          </p>
        </td>
      </tr>
    `
    : "";

  const surveyBlock = surveyUrl
    ? `
      <tr>
        <td style="padding:12px 24px 0 24px;">
          <p style="margin:0 0 8px 0;color:#0f172a;font-size:14px;">
            When you have a moment, please take a short survey about your experience:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" bgcolor="#16a34a" style="border-radius:999px;">
                <a
                  href="${surveyUrl}"
                  style="display:inline-block;padding:10px 22px;color:#ecfdf5;
                         font-size:14px;font-weight:500;text-decoration:none;
                         border-radius:999px;background:#16a34a;"
                >
                  Open teacher survey
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">
            Or copy and paste this link into your browser:<br />
            <span style="word-break:break-all;color:#9ca3af;">${surveyUrl}</span>
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
    <title>Post-call – GrapeSEED Support</title>
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
                  GrapeSEED • Teacher Follow-up
                </p>
                <h1 style="margin:6px 0 0 0;font-size:20px;color:#e5e7eb;font-weight:600;">
                  Thank you for your time and effort
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
                  Thank you for your time and for all the work you put into supporting
                  your students with GrapeSEED. It was a pleasure to observe your class
                  and talk through what is going well and what we can continue to grow.
                </p>
              </td>
            </tr>

            ${workbookBlock}

            <tr>
              <td style="padding:16px 24px 0 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  In our conversation, we highlighted some key next steps to keep your
                  implementation strong. Please feel free to revisit the notes and reach
                  out if something is unclear or if you would like to schedule another
                  check-in.
                </p>
              </td>
            </tr>

            ${surveyBlock}

            <tr>
              <td style="padding:20px 24px 16px 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 4px 0;">
                  With appreciation,
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
                  This message contains information related to GrapeSEED classroom
                  support and teaching practice. Thank you for partnering with us.
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