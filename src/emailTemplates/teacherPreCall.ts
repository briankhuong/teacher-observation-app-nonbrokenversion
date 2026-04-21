export interface TeacherPreCallTemplateParams {
  teacherName: string;
  schoolName?: string | null;
  campus?: string | null;
  trainerName: string;
  bookingUrl?: string; // 🟢 Optional
  teacherWorkbookUrl?: string | null;
}

export function buildTeacherPreCallHtml({
  teacherName,
  schoolName,
  campus,
  trainerName,
  bookingUrl,
  teacherWorkbookUrl,
}: TeacherPreCallTemplateParams): string {
  
  const headerText = schoolName ? `${schoolName} ${campus ? `• ${campus}` : ""}` : "GrapeSEED Support";

  // Shared Styles
  const container = "max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;";
  const header = "background-color: #1e3a8a; padding: 20px; text-align: center;";
  const body = "padding: 30px 25px; color: #374151; line-height: 1.6;";
  const button = "display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;";
  const footer = "background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280;";

  // 🟢 LOGIC: Only show the button if bookingUrl exists.
  // Otherwise, just show the polite intro text.
  const bookingSection = bookingUrl
    ? `
      <p style="margin-top: 0;">I’m looking forward to our upcoming GrapeSEED support call. To ensure we find a time that fits your schedule perfectly, please use the button below to book your slot.</p>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${bookingUrl}" style="${button}">📅 Schedule Support Call</a>
      </div>
      `
    : `<p style="margin-top: 0;">I’m looking forward to our upcoming GrapeSEED support call.</p>`;

  return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  
  <div style="${container}">
    <div style="${header}">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.5px;">PRE-CALL CHECK IN</h2>
      <p style="margin: 5px 0 0; color: #bfdbfe; font-size: 13px;">${headerText}</p>
    </div>

    <div style="${body}">
      <p style="margin-top: 0;">Dear <strong>${teacherName}</strong>,</p>
      
      ${bookingSection}

      ${teacherWorkbookUrl ? `
      <div style="background: #eff6ff; padding: 15px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #2563eb;">
        <p style="margin: 0; font-size: 14px;"><strong>Review Notes:</strong> You can see the latest observation notes in your workbook here: <a href="${teacherWorkbookUrl}" style="color: #2563eb;">Open Feedback file</a></p>
      </div>` : ""}

      <p>During our call, we will celebrate your progress and discuss a few next steps to keep your class engaging and effective. In the mean time, <strong><u>please read the comments in the workbook above and answer all the questions to prepare for your call</u></strong>. For the answers, you can just type them under the questions.</p>

      <p>Note that after you select a time slot in the booking page above, there'll be an automatic email sent to you to confirm the schedule with <strong><u>a link</u></strong> that you can use to enter our call.</p>

      <p>Thank you in advance for your time and look forward to hearing from you soon!</p>

      <p style="margin-bottom: 0;">Best regards,<br><strong>${trainerName}</strong><br><span style="color: #6b7280; font-size: 13px;">GrapeSEED Trainer</span></p>
      </div>

    <div style="${footer}">
      GrapeSEED Vietnam Training Team
    </div>
  </div>

</body>
</html>
`;
}