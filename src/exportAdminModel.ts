// -------------------------------
// ADMIN EXPORT MODEL
// -------------------------------

import type {
  ObservationMetaForExport,
  IndicatorStateForExport,
} from "./exportTeacherModel";
import {
  buildFileDateLabel,
  buildMonthYearSheetName,
} from "./exportTeacherModel";

type AdminRating = "" | "Không áp dụng" | "Cần cải thiện" | "Tốt" | "Rất tốt";

export interface AdminExportRow {
  rowIndex: number;
  mainCategory: string;   // Mục chính
  aspect: string;         // Khía cạnh
  classroomSigns: string; // Biểu hiện lớp học
  trainerRating: string;  // Không áp dụng / Cần cải thiện / Tốt / Rất tốt
  trainerNotes: string;   // Các điểm GV cần áp dụng / lưu ý
}

export interface AdminExportModel {
  sheetName: string;
  headerLeft: string;   // A1–C2 merged (Trainer + school + type + time + teachers)
  headerRight: string;  // D1–E2 merged (Lưu ý)
  rows: AdminExportRow[];
  fileDate: string;     // YYYY.MM.DD
  trainerName: string;
  schoolName: string;
  supportType: string;
  teacherName: string;

  /**
   * 🆕 Trainer summary for merged cell (E5–E18).
   * Built from indicators where `includeInTrainerSummary === true`.
   * Format:
   * - First flagged comment
   * - Second flagged comment
   * ...
   */
  trainerSummary: string;
}

// -------------------------------
// ADMIN TABLE LAYOUT
// -------------------------------

interface AdminLayoutItem {
  rowIndex: number;
  mainCategory: string;       // Mục chính
  aspect: string;             // Khía cạnh
  vnSigns: string;            // Biểu hiện lớp học (VN text)
  indicatorNumbers: string[]; // EXACT IndicatorState.number values to pull from
}

export const ADMIN_LAYOUT: AdminLayoutItem[] = [
  {
    rowIndex: 1,
    mainCategory: "Môi trường lớp học",
    aspect: "Khu vực giảng dạy",
    vnSigns: `- Học liệu được sắp xếp gọn gàng, dễ tiếp cận
- Học liệu được chuẩn bị đầy đủ trước buổi học
- Học sinh có thể quan sát tài liệu giảng dạy rõ ràng`,
    indicatorNumbers: ["1.1"],
  },
  {
    rowIndex: 2,
    mainCategory: "Môi trường lớp học",
    aspect: "Không gian lớp học",
    vnSigns: `- Lớp học rộng rãi, đủ không gian để học sinh vận động thoải mái, an toàn
- Phòng học được trang trí vui tươi, phù hợp với chủ đề bài học
- Không gian học tập không gây xao nhãng, đảm bảo tập trung`,
    // combine 1.2 + 1.3
    indicatorNumbers: ["1.2", "1.3"],
  },
  {
    rowIndex: 3,
    mainCategory: "Môi trường lớp học",
    aspect: "Phương pháp quản lý lớp học",
    vnSigns: `- Thiết lập quy tắc lớp học rõ ràng và nhất quán, tạo môi trường học tập trật tự
- Theo dõi và điều phối hoạt động của học sinh để đảm bảo mọi học sinh tập trung, tham gia đầy đủ vào các hoạt động học tập
- Xử lý các tình huống về quản lý lớp học và hành vi chưa phù hợp của học sinh một cách kiên nhẫn và hiệu quả`,
    // this is your combined "2.1.– 2.2" indicator
    indicatorNumbers: ["2.1.– 2.2"],
  },
  {
    rowIndex: 4,
    mainCategory: "Môi trường lớp học",
    aspect:
      "Giải quyết sự cố kỹ thuật (Chỉ áp dụng với GrapeSEED Nexus and Connect)",
    vnSigns: `- Giáo viên dụng nhuần nhuyễn các tính năng của Nexus/Connect.
- Giáo viên chủ động giải quyết sự cố kỹ thuật mà không làm gián đoạn bài học`,
    indicatorNumbers: ["2.3"],
  },
  {
    rowIndex: 5,
    mainCategory: "Phương pháp giảng dạy",
    aspect: "Sử dụng đúng kỹ thuật giảng dạy",
    vnSigns: `Giáo viên nắm vững cách dạy các học liệu của GrapeSEED. Do mỗi học liệu có cách giảng dạy và mục đích khác nhau, việc này giúp học sinh đạt được mục tiêu học tập trong mỗi bài học.`,
    indicatorNumbers: ["3.4 – 5.1"],
  },
  {
    rowIndex: 6,
    mainCategory: "Phương pháp giảng dạy",
    aspect: "Bám sát giáo án mẫu",
    vnSigns: `- Thực hiện đầy đủ các bước dạy theo giáo án mẫu.
- Sử dụng bộ câu hỏi trong giáo án mẫu`,
    indicatorNumbers: ["3.1"],
  },
  {
    rowIndex: 7,
    mainCategory: "Phương pháp giảng dạy",
    aspect: "Ghi nhớ các học liệu",
    vnSigns:
      "- Nắm vững nội dung học liệu, có thể hát/ kể chuyện/ trình bày rõ ràng, chính xác",
    indicatorNumbers: ["3.5"],
  },
  {
    rowIndex: 8,
    mainCategory: "Phương pháp giảng dạy",
    aspect: "Phương pháp, kỹ thuật hỗ trợ học sinh hiểu bài",
    vnSigns: `- Sử dụng tranh minh họa để giải thích nội dung học liệu
- Sử dụng cử chỉ tay và ngôn ngữ cơ thể để làm rõ ý nghĩa
- Sử dụng giáo cụ trực quan để hỗ trợ học sinh dễ dàng tiếp thu kiến thức.`,
    // mapping sheet = 3.3 + 6.1 + 7.2, in your app it is one combined indicator:
    indicatorNumbers: ["3.3 – 6.1 – 7.2"],
  },
  {
    rowIndex: 9,
    mainCategory: "Phương pháp giảng dạy",
    aspect: "Hoạt động di chuyển giữa các góc học tập",
    vnSigns: `- Hướng dẫn học sinh di chuyển giữa các góc học tập một cách trật tự, an toàn và nhanh chóng.
- Đảm bảo hoạt động di chuyển có ý nghĩa và liên quan đến bài học`,
    indicatorNumbers: ["7.3"],
  },
  {
    rowIndex: 10,
    mainCategory: "Tương tác và khuyến khích học sinh",
    aspect: "Giáo viên nói mẫu",
    vnSigns: `- Phát âm chuẩn xác, rõ ràng
- Ngữ điệu tự nhiên, phù hợp với tình huống
- Sử dụng ngữ pháp chính xác`,
    indicatorNumbers: ["8.4"],
  },
  {
    rowIndex: 11,
    mainCategory: "Tương tác và khuyến khích học sinh",
    aspect: "Phong cách giảng dạy và cách thức giúp học sinh hào hứng, vui vẻ",
    vnSigns: `- Thái độ tích cực: Năng lượng vui vẻ, thể hiện sự nhiệt tình, khích lệ học sinh
- Truyền đạt bài học một cách hào hứng, say sưa
- Cử chỉ: Sử dụng cử chỉ giúp tạo sự gần gũi, khuyến khích dễ tiếp cận với học sinh (ví dụ: high fives đập tay)
- Biểu cảm khuôn mặt: Sử dụng đa dạng biểu cảm khuôn mặt giúp buổi học trở nên thú vị`,
    indicatorNumbers: ["7.4 – 8.1"],
  },
  {
    rowIndex: 12,
    mainCategory: "Tương tác và khuyến khích học sinh",
    aspect: "Sửa lỗi sai cho học sinh",
    vnSigns: `- Lắng nghe, quan sát và chú ý đến học sinh trong suốt buổi học
- Nhận diện và sửa lỗi sai một cách kịp thời, tích cực, hiệu quả, giúp học sinh hiểu bài và hạn chế mắc lỗi lần sau.`,
    // same English cluster 3.3 + 6.1 + 7.2 → same combined indicator
    indicatorNumbers: ["3.3 – 6.1 – 7.2"],
  },
  {
    rowIndex: 13,
    mainCategory: "Tương tác và khuyến khích học sinh",
    aspect: "Hỗ trợ học sinh trả lời câu hỏi",
    vnSigns: `- Đảm bảo học sinh có đủ thời gian để suy nghĩ và đưa ra câu trả lời
- Sử dụng tranh minh họa để gợi ý và hỗ trợ học sinh trả lời
- Đơn giản hóa câu hỏi để học sinh dễ hiểu và trả lời
- Nói từ đầu câu để học sinh dễ dàng nắm bắt và trả lời chính xác`,
    // combines 7.5 (wait time) + 8.2 (gestures & props)
    indicatorNumbers: ["7.5", "8.2"],
  },
  {
    rowIndex: 14,
    mainCategory: "Tương tác và khuyến khích học sinh",
    aspect: "Tạo cơ hội nói cho học sinh",
    vnSigns: `- Đưa vào thêm hoạt động giao tiếp giúp học sinh thực hành nói
- Bày tỏ thái độ khích lệ để học sinh cảm thấy hào hứng và tự tin khi tham gia vào các hoạt động nói.`,
    indicatorNumbers: ["7.6"],
  },
];

// -------------------------------
// NOTE TEXT (right header)
// -------------------------------

const ADMIN_NOTE_TEXT = `Lưu ý:
+ Nhận xét dưới đây của Trainer chỉ áp dụng cho từng sự kiện hỗ trợ giáo viên (Dự giờ lớp học hoặc Xem & phân tích video lớp học).
+ Những nhận xét này không phản ánh hoàn toàn bộ năng lực giảng dạy của giáo viên hay đánh giá tất cả các lớp GrapeSEED mà giáo viên đang phụ trách, do mỗi lớp có đặc thù riêng và nội dung giảng dạy có thể khác nhau theo từng Unit.
+ Đối với một số khía cạnh chưa được thể hiện rõ, Trainer sẽ đánh dấu là "Không áp dụng".`;

// -------------------------------
// BUILD ADMIN EXPORT MODEL
// -------------------------------

export function buildAdminExportModel(
  meta: ObservationMetaForExport,
  indicators: IndicatorStateForExport[]
): AdminExportModel {
  const TRAINER_NAME = "Brian";

  // Map: indicator number -> state
  const byNumber = new Map<string, IndicatorStateForExport>(
    indicators.map((i) => [i.number, i])
  );

  // 🆕 Build trainer summary from flagged indicators
  const summaryLines: string[] = [];
  for (const ind of indicators) {
    if (!ind.includeInTrainerSummary) continue;
    const comment = ind.commentText?.trim();
    if (!comment) continue;

    // Requirement: no indicator numbers in front, just pure comments.
    summaryLines.push(`- ${comment}`);
  }
  const trainerSummary = summaryLines.join("\n");

  // Build each admin table row
  const rows: AdminExportRow[] = ADMIN_LAYOUT.map((cfg) => {
    // collect all indicators linked to this row
    const sources = cfg.indicatorNumbers
      .map((num) => byNumber.get(num))
      .filter((i): i is IndicatorStateForExport => !!i);

    let goodCount = 0;
    let growthCount = 0;
    const notePieces: string[] = [];

    for (const s of sources) {
      if (s.good) goodCount++;
      if (s.growth) growthCount++;
      const txt = s.commentText?.trim();
      if (txt) notePieces.push(txt);
    }

    let trainerRating: AdminRating = "";
    if (goodCount > 0 && growthCount === 0) {
      trainerRating = "Tốt";
    } else if (growthCount > 0 && goodCount === 0) {
      trainerRating = "Cần cải thiện";
    } else if (goodCount > 0 && growthCount > 0) {
      trainerRating = "Rất tốt";
    }
    // if both are 0 → keep "" (later you can turn into "Không áp dụng" if you want)

    const trainerNotes = notePieces.join("\n\n");

    return {
      rowIndex: cfg.rowIndex,
      mainCategory: cfg.mainCategory,
      aspect: cfg.aspect,
      classroomSigns: cfg.vnSigns,
      trainerRating,
      trainerNotes,
    };
  });

  const sheetName = buildMonthYearSheetName(meta.date);
  const fileDate = buildFileDateLabel(meta.date);

  const headerLeftLines = [
    `GrapeSEED Trainer: ${TRAINER_NAME}`,
    `Đơn vị trường học/ trung tâm: ${meta.schoolName}`,
    `Hình thức hỗ trợ: ${meta.supportType}`,
    meta.date ? `Thời gian: ${meta.date}` : "",
    `Các GV nhận hỗ trợ: ${meta.teacherName}`,
  ].filter(Boolean);

  const headerLeft = headerLeftLines.join("\n");
  const headerRight = ADMIN_NOTE_TEXT;

  return {
    sheetName,
    headerLeft,
    headerRight,
    rows,
    fileDate,
    trainerName: TRAINER_NAME,
    schoolName: meta.schoolName,
    supportType: meta.supportType,
    teacherName: meta.teacherName,
    trainerSummary, // 🆕 for merged cell E5–E18
  };
}