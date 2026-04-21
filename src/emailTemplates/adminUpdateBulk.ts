// src/emailTemplates/adminUpdateBulk.ts

export interface TeacherEntry {
  campus: string;
  teacherName: string;
  unit: string;
  lesson: string;
  dateStr: string; // e.g. "14/12" for display
}

export interface AdminUpdateBulkTemplateParams {
  adminName: string;
  schoolName: string;
  reportMonth: string; // e.g. "December 2025"
  trainerName: string;
  adminWorkbookUrl?: string | null;
  viewOnlyUrl?: string | null;
  teachers: TeacherEntry[];
}

export function buildAdminUpdateBulkHtml({
  adminName,
  schoolName,
  reportMonth,
  trainerName,
  adminWorkbookUrl,
  viewOnlyUrl,
  teachers,
}: AdminUpdateBulkTemplateParams): string {
  
  // "GrapeSEED Pro" Theme
  const container = "max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; border: 1px solid #e5e7eb;";
  const header = "background-color: #4f46e5; padding: 25px; text-align: center;";
  const body = "padding: 30px 25px; color: #374151; line-height: 1.6;";
  const button = "display: inline-block; background-color: #4338ca; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;";
  const footer = "background-color: #f9fafb; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb;";

  const urlToUse = viewOnlyUrl || adminWorkbookUrl;

  // Generate the rows for the teacher table
  const rowsHtml = teachers.map(t => `
    <tr style="border-bottom: 1px solid #f3f4f6;">
      <td style="padding: 10px; font-size: 13px; color: #6b7280;">${t.dateStr}</td>
      <td style="padding: 10px; font-size: 13px; color: #111827;">${t.campus}</td>
      <td style="padding: 10px; font-size: 13px; color: #111827; font-weight: 600;">${t.teacherName}</td>
      <td style="padding: 10px; font-size: 13px; color: #6b7280;">U${t.unit} / L${t.lesson}</td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  
  <div style="${container}">
    <div style="${header}">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.5px; text-transform: uppercase;">Support Update</h2>
      <p style="margin: 5px 0 0; color: #c7d2fe; font-size: 13px;">${schoolName} • ${reportMonth}</p>
    </div>

    <div style="${body}">
      <p style="margin-top: 0;">Kính gửi anh/chị <strong>${adminName}</strong>,</p>
      
      <p>Cảm ơn anh/chị đã tạo điều kiện em hoàn thành đợt hỗ trợ vừa qua. Dưới đây là danh sách giáo viên em đã hỗ trợ trong tháng <strong>${reportMonth}</strong>:</p>

      <div style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
          <thead>
            <tr style="background-color: #f9fafb;">
              <th align="left" style="padding: 10px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Ngày</th>
              <th align="left" style="padding: 10px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Cơ sở</th>
              <th align="left" style="padding: 10px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Giáo viên</th>
              <th align="left" style="padding: 10px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Tiến độ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <p>Anh/chị có thể xem chi tiết các ghi chú và đề xuất trong File tổng hợp Nhận xét bên dưới:</p>

      ${urlToUse ? `
      <div style="text-align: center; margin: 25px 0;">
        <a href="${urlToUse}" style="${button}">📂 Mở File Nhận Xét</a>
      </div>` : ""}
        
      <p style="margin-bottom: 0;">Trân trọng,<br><strong>${trainerName}</strong><br><span style="color: #6b7280; font-size: 13px;">GrapeSEED Trainer</span></p>
    </div>

    <div style="${footer}">
      Thông tin nội bộ - GrapeSEED Vietnam Training Team
    </div>
  </div>

</body>
</html>
`;
}