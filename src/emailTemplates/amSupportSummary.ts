export interface AmSummaryEmailRow {
  schoolName: string;
  campus: string;
  teacherName: string;
  statusLabel: string; 
  nextStepsOneLine: string; 
  status?: "green" | "red" | "none"; 
}

export interface AmSupportSummaryTemplateParams {
  amName: string;
  amEmail?: string | null;
  summaryMonth: string; 
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
  
  // "GrapeSEED Pro" Theme Styles
  const container = "max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; border: 1px solid #e5e7eb;";
  const header = "background-color: #111827; padding: 25px; text-align: center;"; // Dark/Black for Official Report
  const body = "padding: 30px 25px; color: #374151; line-height: 1.6;";
  const footer = "background-color: #f9fafb; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb;";

  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="5" style="padding:15px; text-align:center; color:#9ca3af;">No observations found.</td></tr>`
    : rows.map((r) => {
        // Status Colors
        let bg = "#ffffff";
        let text = "#374151";
        let badge = `<span>-</span>`;

        if (r.status === "green") {
          bg = "#f0fdf4"; // Very light green row
          badge = `<span style="display:inline-block; background:#dcfce7; color:#166534; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:700;">GREEN</span>`;
        } else if (r.status === "red") {
          bg = "#fef2f2"; // Very light red row
          badge = `<span style="display:inline-block; background:#fee2e2; color:#991b1b; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:700;">RED</span>`;
        }

        return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px; font-size: 13px; color: #111827; font-weight: 500;">${r.schoolName}</td>
          <td style="padding: 12px; font-size: 13px; color: #4b5563;">${r.campus}</td>
          <td style="padding: 12px; font-size: 13px; color: #4b5563;">${r.teacherName}</td>
          <td style="padding: 12px; text-align: center;">${badge}</td>
          <td style="padding: 12px; font-size: 13px; color: #4b5563; line-height: 1.4;">${r.nextStepsOneLine}</td>
        </tr>`;
      }).join("");

  return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  
  <div style="${container}">
    <div style="${header}">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.5px; text-transform: uppercase;">Monthly Support Summary</h2>
      <p style="margin: 5px 0 0; color: #9ca3af; font-size: 13px;">${summaryMonth} • For ${amName}</p>
    </div>

    <div style="${body}">
      <p style="margin-top: 0;">Dear <strong>${amName}</strong>,</p>
      
      <p>Below is the summary of GrapeSEED classroom support for your schools during <strong>${summaryMonth}</strong>.</p>

      <div style="overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 6px; margin: 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; min-width: 600px;">
          <thead>
            <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
              <th align="left" style="padding: 10px 12px; font-size: 11px; color: #6b7280; text-transform: uppercase;">School</th>
              <th align="left" style="padding: 10px 12px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Campus</th>
              <th align="left" style="padding: 10px 12px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Teacher</th>
              <th align="center" style="padding: 10px 12px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Status</th>
              <th align="left" style="padding: 10px 12px; font-size: 11px; color: #6b7280; text-transform: uppercase; width: 40%;">Next Steps</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <p style="margin-top: 25px;">If you would like to discuss any of these teachers in more detail, please let me know.</p>

      <p style="margin-bottom: 0;">Best regards,<br><strong>${trainerName}</strong><br><span style="color: #6b7280; font-size: 13px;">GrapeSEED Trainer</span></p>
    </div>

    <div style="${footer}">
      Internal Use Only • GrapeSEED Support
    </div>
  </div>

</body>
</html>
`;
}