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
  
  const headerText = schoolName ? `${schoolName} ${campus ? `• ${campus}` : ""}` : "GrapeSEED Support";
  
  const container = "max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;";
  const header = "background-color: #065f46; padding: 20px; text-align: center;"; // Green-ish for "Done"
  const body = "padding: 30px 25px; color: #374151; line-height: 1.6;";
  const button = "display: inline-block; background-color: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;";
  const footer = "background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280;";

  return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  
  <div style="${container}">
    <div style="${header}">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.5px;">SUPPORT SUMMARY</h2>
      <p style="margin: 5px 0 0; color: #a7f3d0; font-size: 13px;">${headerText}</p>
    </div>

    <div style="${body}">
      <p style="margin-top: 0;">Dear <strong>${teacherName}</strong>,</p>
      
      <p>Thank you for your time today! It was a pleasure to discuss your class and work together on strategies for your students.</p>

      ${teacherWorkbookUrl ? `
      <div style="text-align: center; margin: 25px 0;">
        <p style="margin-bottom: 10px; font-size: 14px; color: #6b7280;">Access your updated action plan:</p>
        <a href="${teacherWorkbookUrl}" style="${button}">📂 Open Teacher Workbook</a>
      </div>` : ""}

      ${surveyUrl ? `
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 25px 0;" />
      <p style="font-size: 14px;"><strong>We value your feedback.</strong> When you have a moment, please let us know how we did:</p>
      <p><a href="${surveyUrl}" style="color: #059669; font-weight: 600;">Take Short Survey &rarr;</a></p>
      ` : ""}

      <p style="margin-bottom: 0;">Best regards,<br><strong>${trainerName}</strong></p>
    </div>

    <div style="${footer}">
      GrapeSEED Support Team
    </div>
  </div>

</body>
</html>
`;
}