// 🟢 gemini.ts

// 🟢 PART 1: DETERMINISTIC LOGIC & MAPS

const VN_FLOWY_PHRASES: Record<string, string> = {
  // Environment
  "1.1": "sắp xếp khu vực giảng dạy gọn gàng",
  "1.2": "đảm bảo không gian lớp học an toàn",
  "1.3": "trang trí lớp học phù hợp với chủ đề",
  // Classroom Management
  "2.1": "thiết lập quy tắc và quản lý lớp học hiệu quả",
  "2.2": "thiết lập quy tắc và quản lý lớp học hiệu quả",
  "2.3": "chủ động xử lý các sự cố kỹ thuật",
  // Teaching Methods
  "3.1": "thực hiện đầy đủ các bước dạy theo giáo án mẫu",
  "3.4": "sử dụng học liệu đúng kỹ thuật và mục đích",
  "5.1": "sử dụng học liệu đúng kỹ thuật và mục đích",
  "3.4-5.1": "sử dụng học liệu đúng kỹ thuật và mục đích", 
  "3.5": "ghi nhớ và trình bày nội dung học liệu trôi chảy",
  // Monitoring
  "3.3": "quan sát và hỗ trợ học sinh kịp thời",
  "6.1": "quan sát và hỗ trợ học sinh kịp thời",
  "7.2": "quan sát và hỗ trợ học sinh kịp thời",
  "3.3-6.1-7.2": "quan sát và hỗ trợ học sinh kịp thời",
  // Interaction
  "7.1": "đặt câu hỏi bám sát mục tiêu bài học",
  "7.3": "tổ chức di chuyển giữa các góc học tập trật tự và an toàn",
  "7.4": "duy trì năng lượng và sự hào hứng cho lớp học",
  "8.1": "duy trì năng lượng và sự hào hứng cho lớp học",
  "7.4-8.1": "duy trì năng lượng và sự hào hứng cho lớp học",
  "7.5": "dành đủ thời gian chờ cho học sinh trả lời",
  "7.6": "tạo cơ hội cho học sinh thực hành nói",
  // Modeling
  "8.2": "sử dụng cử chỉ và giáo cụ hỗ trợ hiệu quả",
  "8.3": "nhấn mạnh mục tiêu bài học và từ vựng",
  "8.4": "làm mẫu với phát âm và ngữ điệu chuẩn xác",
  "8.5": "thực hiện hành động làm mẫu chính xác"
};

export interface IndicatorSimple {
  number: string;
  title: string;
  good: boolean;
  growth: boolean;
  commentText: string;
  includeInTrainerSummary?: boolean;
}

const CRITICAL_GROUPS = [
  ["2.1"], ["3.1"], ["3.4", "5.1"], ["3.3", "6.1", "7.2"], ["7.1"], ["7.4", "8.1"]
];

interface ClassAssessment {
  levelText: string;
  openingText: string;
  sentiment: "positive" | "neutral" | "negative";
}

function assessClassPerformance(indicators: IndicatorSimple[]): ClassAssessment {
  const goodCount = indicators.filter(i => i.good).length;
  const growthCount = indicators.filter(i => i.growth).length;
  const totalChecked = goodCount + growthCount;

  let criticalFailures = 0;
  CRITICAL_GROUPS.forEach(group => {
    const hasFailure = indicators.some(i => 
      group.some(id => i.number.includes(id)) && i.growth
    );
    if (hasFailure) criticalFailures++;
  });

  const scorePct = totalChecked === 0 ? 0 : (goodCount / totalChecked) * 100;
  let level = "Cần cải thiện";
  let sentiment: "positive" | "neutral" | "negative" = "negative";

  if (scorePct >= 85 && criticalFailures === 0) {
    level = "Xuất sắc";
    sentiment = "positive";
  } else if (scorePct >= 70 && criticalFailures <= 1) {
    level = "Tốt";
    sentiment = "positive";
  } else if (scorePct >= 50 && criticalFailures <= 2) {
    level = "Khá";
    sentiment = "neutral";
  } else {
    level = "Cần cải thiện (Dưới chuẩn)";
    sentiment = "negative";
  }

  // 1. Get ALL Good Indicators
  const goodIndicators = indicators.filter(i => i.good);
  
  // 2. Map them to phrases, keeping track of length
  const validPhrases = goodIndicators
    .map(i => {
      const cleanId = i.number.replace(/\s/g, ''); 
      return {
        phrase: VN_FLOWY_PHRASES[i.number] || VN_FLOWY_PHRASES[cleanId],
        length: i.commentText?.length || 0
      };
    })
    .filter(item => item.phrase) // Remove unknowns
    .sort((a, b) => b.length - a.length); // Longest notes first

  // 3. Take Top 3
  const top3 = validPhrases.slice(0, 3).map(p => p.phrase);
  const uniquePhrases = [...new Set(top3)];

  let opening = `Đánh giá tổng quan: Lớp học diễn ra ${level}.`;
  if (uniquePhrases.length > 0) {
    opening += ` Ví dụ, giáo viên đã ${uniquePhrases.join(", ")}.`;
  }

  return { levelText: level, openingText: opening, sentiment };
}

// 🟢 PART 2: API CLIENT FUNCTIONS

const API_BASE = import.meta.env.VITE_MERGE_SERVER_BASE; 

export async function polishTextWithGroq(text: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/polish-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    return data.polished || text;
  } catch (error) {
    console.error("Polish Error:", error);
    return text;
  }
}

export async function polishBatchWithGroq(items: { id: string; text: string }[]) {
  try {
    const res = await fetch(`${API_BASE}/api/polish-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return await res.json(); 
  } catch (error) {
    console.error("Batch Error:", error);
    return {};
  }
}

// 🟢 HELPER: Naturalize Text
async function naturalizeTextWithGroq(text: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/naturalize-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    return data.result || text;
  } catch (error) {
    console.error("Naturalize Error:", error);
    return text;
  }
}

// 🟢 MAIN FUNCTION (CHAINED)
export async function generateAdminSummary(
  indicators: IndicatorSimple[]
): Promise<string> {
  
  // 1. Generate General Comment Locally
  const assessment = assessClassPerformance(indicators);

  // 2. Filter Notes (STRICT FILTER FIX)
  const notesPayload = indicators
    .filter(i => {
      // Must be checked for summary
      if (!i.includeInTrainerSummary) return false;
      // Must have text
      if (!i.commentText) return false;
      // CRITICAL: Must contain actual logic brackets '[' AND ']'
      // We check this BEFORE removing [OCR] to ensure we don't process empty bracketed tags if that was a thing,
      // but primarily to ensure valid logic exists.
      return i.commentText.includes('[') && i.commentText.includes(']');
    })
    .map(i => i.commentText.replace(/\[OCR\]/gi, "").trim());

  // 3. If no notes, return just the opening
  if (notesPayload.length === 0) {
    return assessment.openingText;
  }

  // 4. THE 2-STEP CHAIN
  try {
    // STEP A: Get Strict Logic
    const logicRes = await fetch(`${API_BASE}/api/generate-next-steps`, { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesPayload }),
    });
    
    const logicData = await logicRes.json();
    const draftText = logicData.result || "";

    // STEP B: Naturalize Flow (With strict Subject rules)
    const finalText = await naturalizeTextWithGroq(draftText);

    // 5. Combine
    return `${assessment.openingText}\n\nDưới đây là một số điểm giáo viên cần cân nhắc cải thiện:\n\n${finalText}`;

  } catch (error) {
    console.error("Admin Summary Chain Error:", error);
    return assessment.openingText;
  }
}