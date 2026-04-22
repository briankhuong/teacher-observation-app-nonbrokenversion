export interface AdminUpdateTemplateParams {
  adminName: string;
  schoolName: string;
  campus?: string | null;
  trainerName: string;
  teacherName?: string | null;
  adminWorkbookUrl?: string | null;
  viewOnlyUrl?: string | null; // <--- ADD THIS LINE to fix the error
  phoneNumber?: string | null;
  extraNotesVi?: string | null;
}

export function buildAdminUpdateHtml({
  adminName,
  schoolName,
  campus,
  trainerName,
  teacherName,
  adminWorkbookUrl,
  viewOnlyUrl,
  extraNotesVi,
  phoneNumber, // 🟢 Destructure new field
}: AdminUpdateTemplateParams): string {
  
  const headerText = schoolName ? `${schoolName} ${campus ? `• ${campus}` : ""}` : "GrapeSEED Support";
  const contactNumber = phoneNumber || "0912824120"; // Fallback to default if missing
  
  // "GrapeSEED Pro" Theme Styles
  const container = "max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; border: 1px solid #e5e7eb;";
  const header = "background-color: #4f46e5; padding: 25px; text-align: center;"; // Indigo/Purple for Admin
  const body = "padding: 30px 25px; color: #374151; line-height: 1.6;";
  const button = "display: inline-block; background-color: #4338ca; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;";
  const footer = "background-color: #f9fafb; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb;";

  // Prefer View Only URL
  const urlToUse = viewOnlyUrl || adminWorkbookUrl;

  return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  
  <div style="${container}">
    <div style="${header}">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.5px; text-transform: uppercase;">Admin Update</h2>
      <p style="margin: 5px 0 0; color: #c7d2fe; font-size: 13px;">${headerText}</p>
    </div>

    <div style="${body}">
      <p style="margin-top: 0;">Kính gửi anh/chị <strong>${adminName}</strong>,</p>
      
      <p>Cảm ơn anh/chị đã luôn đồng hành và tạo điều kiện để giáo viên triển khai chương trình GrapeSEED tại trường một cách hiệu quả nhất. Em xin gửi lại một số nhận xét sau khi làm việc với giáo viên ạ!</p>

      ${teacherName ? `<div style="background: #eef2ff; padding: 12px 16px; border-radius: 6px; border-left: 4px solid #4f46e5; margin: 15px 0;">
        <p style="margin:0; font-size: 14px; color: #312e81;"><strong>Giáo viên:</strong> ${teacherName}</p>
      </div>` : ""}

      <p>Email này nhằm cập nhật tổng quan về tình hình lớp, điểm giáo viên đang làm tốt và một số sự điều chỉnh cần được thực hiện trong thời gian tới để lớp học hiệu quả hơn.</p>

      ${urlToUse ? `
      <div style="text-align: center; margin: 30px 0;">
        <a href="${urlToUse}" style="${button}">📂 Mở File Nhận Xét</a>
        <p style="margin-top: 10px; font-size: 12px; color: #9ca3af;">(Link này bao gồm các ghi chú chi tiết từ buổi hỗ trợ)</p>
      </div>` : ""}

      ${extraNotesVi ? `
      <div style="margin-top: 20px;">
        <p style="font-weight: 600; margin-bottom: 5px;">Ghi chú bổ sung:</p>
        <p style="background: #fffbeb; padding: 15px; border-radius: 6px; color: #92400e; margin: 0;">${extraNotesVi}</p>
      </div>` : ""}

      <p style="margin-top: 25px;">Nếu anh/chị cần thêm thông tin chi tiết, anh chị vui lòng trả lời mail hoặc liên hệ với em qua số zalo ${contactNumber} ạ!</p>

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