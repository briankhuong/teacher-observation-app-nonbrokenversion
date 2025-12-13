export interface AdminUpdateTemplateParams {
  adminName: string;
  schoolName: string;
  campus?: string | null;
  trainerName: string;
  teacherName?: string | null;
  adminWorkbookUrl?: string | null;
  viewOnlyUrl?: string | null; // This is the fixed property
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
}: AdminUpdateTemplateParams): string {
  const campusLine = campus
    ? `${schoolName} – ${campus}`
    : schoolName;

  const teacherLine = teacherName
    ? `<p style="margin:0 0 6px 0;color:#cbd5f5;font-size:14px;">
         Giáo viên: <strong>${teacherName}</strong>
       </p>`
    : "";

  // Prefer View Only URL, fallback to edit URL
  const urlToUse = viewOnlyUrl || adminWorkbookUrl;

  const workbookBlock = urlToUse
    ? `
      <tr>
        <td style="padding:16px 24px 0 24px;">
          <p style="margin:0 0 6px 0;color:#e5e7eb;font-size:14px;">
            Anh/chị có thể xem chi tiết ghi chú và kế hoạch hỗ trợ trong file dưới đây:
          </p>
          <p style="margin:0 0 6px 0;">
            <a href="${urlToUse}" style="color:#38bdf8;text-decoration:none;">
              Mở file tổng hợp hỗ trợ (Admin workbook)
            </a>
          </p>
          <p style="margin:4px 0 0 0;font-size:12px;color:#64748b;">
            (Nếu không mở được, vui lòng sao chép đường link và dán vào trình duyệt.)
          </p>
        </td>
      </tr>
    `
    : "";

  const extraNotesBlock = extraNotesVi
    ? `
      <tr>
        <td style="padding:16px 24px 0 24px;">
          <p style="margin:0 0 4px 0;color:#e5e7eb;font-size:14px;font-weight:500;">
            Ghi chú bổ sung:
          </p>
          <p style="margin:0;color:#cbd5f5;font-size:14px;line-height:1.6;">
            ${extraNotesVi}
          </p>
        </td>
      </tr>
    `
    : "";

  return `
<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <title>Cập nhật hỗ trợ GrapeSEED – ${schoolName}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background-color:#020617;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#020617;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background:#020617;border-radius:16px;border:1px solid #1f2937;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <tr>
              <td style="padding:20px 24px 12px 24px;border-bottom:1px solid #1f2937;">
                <p style="margin:0;color:#64748b;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">
                  GrapeSEED • Cập nhật hỗ trợ
                </p>
                <h1 style="margin:6px 0 4px 0;font-size:20px;color:#e5e7eb;font-weight:600;">
                  Cập nhật hỗ trợ lớp GrapeSEED
                </h1>
                <p style="margin:0;color:#9ca3af;font-size:13px;">
                  ${campusLine}
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px 0 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  Kính gửi anh/chị ${adminName},
                </p>
                <p style="margin:8px 0 8px 0;">
                  Cảm ơn anh/chị đã luôn đồng hành và tạo điều kiện để giáo viên triển khai
                  chương trình GrapeSEED tại trường. Gần đây, chúng tôi đã có buổi hỗ trợ/
                  dự giờ và làm việc với giáo viên phụ trách lớp GrapeSEED.
                </p>
                ${teacherLine}
                <p style="margin:8px 0 8px 0;">
                  Email này nhằm cập nhật tổng quan về tình hình lớp, những điểm tích cực
                  và một số đề xuất để tiếp tục nâng cao chất lượng triển khai.
                </p>
              </td>
            </tr>

            ${workbookBlock}

            ${extraNotesBlock}

            <tr>
              <td style="padding:20px 24px 16px 24px;color:#e5e7eb;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 8px 0;">
                  Nếu anh/chị cần thêm thông tin chi tiết, hoặc muốn trao đổi cụ thể hơn
                  về kế hoạch hỗ trợ tiếp theo, em rất sẵn sàng sắp xếp một buổi trao đổi
                  trực tuyến hoặc trực tiếp.
                </p>
                <p style="margin:0 0 4px 0;">
                  Trân trọng,
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
                  Đây là email cập nhật nội bộ về quá trình triển khai và hỗ trợ chương trình
                  GrapeSEED tại trường. Vui lòng không chuyển tiếp ra bên ngoài hệ thống
                  nhà trường nếu không cần thiết.
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