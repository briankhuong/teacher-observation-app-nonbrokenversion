// 🟢 PART 1: DETERMINISTIC LOGIC
export interface IndicatorSimple {
  number: string;
  title: string;
  good: boolean;
  growth: boolean;
  commentText: string;
  includeInTrainerSummary?: boolean;
}

// 🔴 CRITICAL GROUPS: Fail one, you fail the group.
const CRITICAL_GROUPS = [
  ["2.1"], // Instructions
  ["3.1"], // Fidelity Base
  ["3.4", "5.1"], // Design Fidelity
  ["3.3", "6.1", "7.2"], // Student Support
  ["7.1"], // Questions
  ["7.4", "8.1"] // Energy/Flow
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

  // 1. Calculate Critical Failures (The "Veto" Count)
  let criticalFailures = 0;
  CRITICAL_GROUPS.forEach(group => {
    // Check if ANY indicator in this group has a 'growth' flag
    const hasFailure = indicators.some(i => 
      group.some(id => i.number.includes(id)) && i.growth
    );
    if (hasFailure) criticalFailures++;
  });

  // 2. Calculate Score Percentage (Avoid divide by zero)
  const scorePct = totalChecked === 0 ? 0 : (goodCount / totalChecked) * 100;

  // 3. Determine Level (The "Ceiling Rule")
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
    // Falls through to "Cần cải thiện"
    level = "Cần cải thiện (Dưới chuẩn)";
    sentiment = "negative";
  }

  const opening = `Đánh giá tổng quan: Lớp học đạt mức độ ${level}.`;
  return { levelText: level, openingText: opening, sentiment };
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
    return await res.json(); 
  } catch (error) {
    console.error("Batch Error:", error);
    return {};
  }
}

export async function generateAdminSummary(
  indicators: IndicatorSimple[]
): Promise<string> {
  
  // 1. Math & Verdict
  const assessment = assessClassPerformance(indicators);

  // 2. Filter Notes: Only Summary Checked + Has Brackets
  const actionableNotes = indicators
    .filter(i => 
      i.includeInTrainerSummary && 
      i.commentText && 
      /\[.*?\]/.test(i.commentText) // Must have brackets [ ]
    )
    .map(i => ({
      text: i.commentText.replace(/\[OCR\]/gi, "").trim(),
      isGood: i.good, 
      title: i.title 
    }));

  // Fallback if no specific actionable notes are found
  if (actionableNotes.length === 0) {
    return assessment.openingText;
  }

  // 3. Call Server
  try {
    const res = await fetch(`${API_BASE}/api/generate-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        notes: actionableNotes, 
        context: assessment.levelText 
      }),
    });
    
    const data = await res.json();
    const reportBody = data.summary || "";

    // 4. Combine: Opening (Verdict) + AI Body (Details)
    return `${assessment.openingText}\n\n${reportBody}`;

  } catch (error) {
    console.error("Admin Summary Error:", error);
    return assessment.openingText;
  }
}