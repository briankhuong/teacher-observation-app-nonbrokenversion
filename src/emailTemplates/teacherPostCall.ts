export interface TeacherPostCallTemplateParams {
  teacherName: string;
  schoolName?: string | null;
  campus?: string | null;
  trainerName: string;
  teacherWorkbookUrl?: string | null;
  surveyUrl?: string | null;
  visitationId?: string | null;
  schoolId?: string | null;   // official code
}

export function buildTeacherPostCallHtml({
  teacherName,
  schoolName,
  campus,
  trainerName,
  teacherWorkbookUrl,
  surveyUrl,
  visitationId,
  schoolId,
}: TeacherPostCallTemplateParams): string {
  
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
  const headerText = schoolName ? `${schoolName} ${campus ? `• ${campus}` : ""}` : "GrapeSEED Support";
  
  const container = "max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; border: 1px solid #e5e7eb;";
  const header = "background-color: #065f46; padding: 20px; text-align: center;"; 
  const body = "padding: 30px 25px; color: #374151; line-height: 1.6; font-size: 15px;";
  const button = "display: inline-block; background-color: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;";
  const footer = "background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280;";

  const portalUrl = visitationId && schoolId
    ? `https://schools.grapeseed.com/regions/${VIETNAM_REGION_ID}/schools/${schoolId}/visitations/${visitationId}/teacher`
    : null;

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
      
      <p>Thank you again for your time and dedication during our recent support session. I truly appreciate the effort you put into your teaching and your willingness to reflect on your practice to create the best learning environment for your students. I have put together all the discussed points and summarized the next steps in the Feedback file below. Feel free to refer back to it anytime.</p>

      ${teacherWorkbookUrl ? `
      <div style="text-align: center; margin: 25px 0;">
        <a href="${teacherWorkbookUrl}" style="${button}">📂 View your feedback file</a>
        <p style="margin-top: 10px; font-size: 12px; color: #6b7280;">(This file contains your detailed observation notes and next steps)</p>
      </div>` : ""}

      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 25px 0;" />

      <p style="font-size: 16px; font-weight: 600; color: #065f46;">Help me support you better:</p>

      ${portalUrl ? `
      <p>I would greatly appreciate it if you could take 2-3 minutes to complete a short survey about our support session. Your honest feedback will help me understand:</p>
      <ul style="margin: 10px 0 20px 20px; padding-left: 0;">
        <li>What I did well that was helpful to you</li>
        <li>What I could improve or do differently next time</li>
        <li>Whether the feedback and strategies were clear and useful</li>
      </ul>
      
      <div style="text-align: center; margin: 25px 0;">
        <a href="${portalUrl}" style="${button}">📋 Go to the survey</a>
      </div>` : ""}

      ${surveyUrl ? `
      <div style="text-align: center; margin: 25px 0;">
        <a href="${surveyUrl}" style="${button}">📋 Go to the survey</a>
      </div>` : ""}

      <p>Thank you once again for your commitment to continuous improvement. Please don't hesitate to reach out if you have any questions about the feedback or need clarification on any of the next steps.</p>

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