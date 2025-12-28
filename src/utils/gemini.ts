// 🟢 PART 1: DETERMINISTIC LOGIC (Keep exactly as is)
export interface IndicatorSimple {
  number: string;
  title: string;
  good: boolean;
  growth: boolean;
  commentText: string;
  includeInTrainerSummary?: boolean;
}

const VN_PHRASE_MAP: Record<string, string> = {
  "2.1": "biết đưa ra các mệnh lệnh ngắn gọn, dễ hiểu",
  "3.1": "bám sát giáo án mẫu",
  "3.4": "dạy học liệu theo đúng thiết kế chương trình", 
  "5.1": "dạy học liệu theo đúng thiết kế chương trình",
  "3.3": "quan sát và giúp đỡ học sinh gặp khó khăn khi trả lời câu hỏi/ phát âm từ",
  "6.1": "quan sát và giúp đỡ học sinh gặp khó khăn khi trả lời câu hỏi/ phát âm từ",
  "7.2": "quan sát và giúp đỡ học sinh gặp khó khăn khi trả lời câu hỏi/ phát âm từ",
  "7.1": "hỏi câu hỏi trong giáo án mẫu",
  "7.4": "có năng lượng tốt và biết cách tổ chức các hoạt động một cách vui nhộn, hiệu quả",
  "8.1": "có năng lượng tốt và biết cách tổ chức các hoạt động một cách vui nhộn, hiệu quả",
  "7.6": "tổ chức hoạt động nói để học sinh có nhiều cơ hội nói hơn"
};

function calculateClassLevelAndSentence(indicators: IndicatorSimple[]): string {
  const goodCount = indicators.filter(i => i.good).length;
  const growthCount = indicators.filter(i => i.growth).length;
  const isKeyFailure = (numFragment: string) => indicators.some(i => i.number.includes(numFragment) && i.growth);

  let keyFailures = 0;
  if (isKeyFailure("2.1")) keyFailures++; 
  if (isKeyFailure("3.1")) keyFailures++; 
  if (isKeyFailure("3.4") || isKeyFailure("5.1")) keyFailures++; 
  if (isKeyFailure("3.3") || isKeyFailure("6.1") || isKeyFailure("7.2")) keyFailures++; 
  if (isKeyFailure("7.1")) keyFailures++; 
  if (isKeyFailure("7.4") || isKeyFailure("8.1")) keyFailures++; 

  let level = "cần cải thiện"; 
  let sentiment = "negative"; 

  if (goodCount >= 12 && goodCount > growthCount && keyFailures === 0) {
    level = "rất hiệu quả";
    sentiment = "positive";
  } else if (goodCount > growthCount && keyFailures <= 1) {
    level = "hiệu quả";
    sentiment = "positive";
  } else if (goodCount > growthCount) {
    level = "khá hiệu quả";
    sentiment = "positive";
  } else {
    level = "còn cần khá nhiều điểm cần cải thiện để giúp học sinh học hiệu quả";
    sentiment = "negative";
  }

  const summaryItems = indicators.filter(i => i.includeInTrainerSummary);
  
  if (summaryItems.length === 0) return `Lớp học ${level}.`; 

  const examples = summaryItems.map(i => {
    for (const key in VN_PHRASE_MAP) {
      if (i.number.includes(key)) return VN_PHRASE_MAP[key];
    }
    return i.title; 
  });
  const uniqueExamples = Array.from(new Set(examples)).join(", ");

  if (sentiment === "positive") {
    return `Lớp học ${level}, ví dụ: thầy/cô làm tốt các điểm như ${uniqueExamples}.`;
  } else {
    return `Lớp học ${level}, ví dụ: thầy/cô cần cố gắng nhiều hơn ở các điểm như ${uniqueExamples}.`;
  }
}

// 🟢 PART 2: API CLIENT FUNCTIONS (Secure)

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
    return await res.json(); // Returns { "id": "polished text" }
  } catch (error) {
    console.error("Batch Error:", error);
    return {};
  }
}

export async function generateAdminSummary(
  indicators: IndicatorSimple[]
): Promise<string> {
  
  // 1. Calculate General Comment (Local Logic)
  const part1_GeneralComment = calculateClassLevelAndSentence(indicators);

  // 2. Prepare Notes
  const summaryCandidates = indicators.filter(
    (i) => i.includeInTrainerSummary && i.commentText?.trim().length > 0
  );

  const cleanNotes = summaryCandidates
    .map(i => i.commentText.replace(/\[OCR\]/gi, "").trim())
    // Keep only lines with anchors [...]
    .filter(t => t.length > 0 && /\[.*?\]/.test(t)); 

  const notesList = cleanNotes.map(n => `- ${n}`);

  if (notesList.length === 0) {
    return part1_GeneralComment;
  }

  // 3. Call Backend for AI Generation (Part 2)
  try {
    const res = await fetch(`${API_BASE}/api/generate-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesList }),
    });
    
    const data = await res.json();
    const aiBulletPoints = data.summary || "";

    if (!aiBulletPoints) return part1_GeneralComment;

    return `${part1_GeneralComment}\n\nDưới đây là một số điểm giáo viên cần cân nhắc cải thiện:\n${aiBulletPoints}`;

  } catch (error) {
    console.error("Admin Summary Error:", error);
    return part1_GeneralComment;
  }
}