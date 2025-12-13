export interface AmSummaryEmailRow {
  schoolName: string;
  campus: string;
  teacherName: string;
  statusLabel: string; // e.g. "Green", "Red", "-" (already mapped in dashboard)
  nextStepsOneLine: string; // single-line
  status?: "green" | "red" | "none"; // Raw status for styling
}

export interface AmSupportSummaryTemplateParams {
  amName: string;
  amEmail?: string | null;
  summaryMonth: string; // e.g. "11.2025" or "November 2025"
  trainerName: string;
  rows: AmSummaryEmailRow[];
}

export function buildAmSupportSummaryHtml({
  amName,
  amEmail,
  summaryMonth,
  trainerName,
  rows,
}: AmSupportSummaryTemplateParams): string {
  const rowsHtml =
    rows.length === 0
      ? `
        <tr>
          <td colspan="5" style="padding:12px 16px;font-size:14px;color:#9ca3af;text-align:center;">
            No observations found for this period.
          </td>
        </tr>
      `
      : rows
          .map((r) => {
            // Background Colors
            let bgStyle = "background-color:#020617;"; // Default Dark
            let textStyle = "color:#e5e7eb;";
            
            // Note: Outlook prefers simple inline styles. 
            // We use slightly muted backgrounds for readability.
            if (r.status === "green") {
              bgStyle = "background-color:#064e3b;"; // Dark Green
              textStyle = "color:#ecfdf5;";
            } else if (r.status === "red") {
              bgStyle = "background-color:#450a0a;"; // Dark Red
              textStyle = "color:#fef2f2;";
            }

            return `
        <tr style="${bgStyle}">
          <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:13px;${textStyle}">
            ${r.schoolName}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:13px;${textStyle}">
            ${r.campus}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:13px;${textStyle}">
            ${r.teacherName}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:13px;white-space:nowrap;${textStyle}">
            <strong>${r.statusLabel}</strong>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:13px;${textStyle}">
            ${r.nextStepsOneLine}
          </td>
        </tr>
      `;
          })
          .join("");

  const monthLabel = summaryMonth;

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>GrapeSEED Support Summary – ${monthLabel}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background-color:#020617;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#020617;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:720px;background:#020617;border-radius:16px;border:1px solid #1f2937;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <tr>
              <td style="padding:20px 24px 12px 24px;border-bottom:1px solid #1f2937;">
                <p style="margin:0;color:#64748b;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">
                  GrapeSEED • Support Summary
                </p>
                <h1 style="margin:6px 0 4px 0;font-size:20px;color:#e5e7eb;font-weight:600;">
                  Monthly support summary – ${monthLabel}
                </h1>
                ${
                  amEmail
                    ? `<p style="margin:0;color:#9ca3af;font-size:13px;">For: ${amName} (${amEmail})</p>`
                    : `<p style="margin:0;color:#9ca3af;font-size:13px;">For: ${amName}</p>`
                }
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px 0 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  Dear ${amName},
                </p>
                <p style="margin:8px 0 8px 0;">
                  Below is a summary of GrapeSEED classroom support for your schools
                  during <strong>${monthLabel}</strong>. Each row highlights a school,
                  campus, teacher, overall status, and key next steps or issues.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 16px 12px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-radius:12px;overflow:hidden;background:#020617;border:1px solid #1f2937;">
                  <thead>
                    <tr style="background:#111827;">
                      <th align="left" style="padding:8px 12px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">
                        School
                      </th>
                      <th align="left" style="padding:8px 12px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">
                        Campus
                      </th>
                      <th align="left" style="padding:8px 12px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">
                        Teacher
                      </th>
                      <th align="left" style="padding:8px 12px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">
                        Status
                      </th>
                      <th align="left" style="padding:8px 12px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">
                        Next steps / key issues
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px 16px 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  If you would like to discuss any of these teachers or schools in
                  more detail, I would be happy to schedule a follow-up call.
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
                  This summary is based on GrapeSEED classroom observations and support
                  sessions during the selected month. Please keep this information
                  internal to your organization.
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