import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true 
});

export async function polishTextWithGroq(text: string): Promise<string> {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a strict grammar correction engine for an English Phonics Teacher.
          
          DOMAIN CONTEXT (CRITICAL):
          - These are observation notes for an ESL/Phonics class.
          - The teacher often refers to specific SOUNDS using slashes (e.g., /t/, /s/, /d/) or short letters.
          - Example: "emphasizing the /t/ in the song" is correct.
          - Example: "teaching the (H) sound" is correct.

          OPERATIONAL GUIDE:
          1. FIX BROKEN ENGLISH (Conservative Mode):
             - Fix Tense, Grammar, and Punctuation.
             - Expand standard shorthand ("tchr" -> "teacher").
             - DO NOT guess at "typos" if they look like phonetic sounds. (e.g., keep "ltl", "/t/", or "sts" if unsure).
             - NEVER change a short string like "ltl" or "/t/" to a completely different word like "lyrics".

          2. DO NOT CHANGE THE STYLE:
             - Keep it simple and direct. Do not upgrade vocabulary.

          3. PRESERVE STRUCTURE & TAGS:
             - You MUST preserve hyphens "-", bullet points, and "(GA)" tags.
             
          4. PROTECT ANCHORS [...]:
             - Content inside square brackets (e.g., [follow LP], [AD]) is SYSTEM CODE.
             - Copy them EXACTLY. Do not fix grammar inside them.

          OUTPUT RULES:
          - Return ONLY the corrected text.`
        },
        {
          role: "user",
          content: text
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, 
    });

    return chatCompletion.choices[0]?.message?.content?.trim() || text;
  } catch (error) {
    console.error("Groq Polish Error:", error);
    throw error;
  }
}

/**
 * 🟢 Batch Polish with Groq
 */
export async function polishBatchWithGroq(items: { id: string; text: string }[]) {
  const systemPrompt = `You are a professional text processing engine for an English Phonics Teacher.
  
  DOMAIN RULES:
  1. Expect phonetic sounds (e.g., /t/, /s/, (H)). Do NOT autocorrect these to words like "lyrics" or "time".
  2. If a word looks like a sound code, keep it as is.
  
  STRICT MACHINE RULES:
  1. Return ONLY a valid JSON object. 
  2. PRESERVE TAGS: Do not remove "(GA)" tags.
  3. PROTECT ANCHORS: Do NOT edit, expand, or fix text inside square brackets "[...]".
  4. PRESERVE HYPHENS.
  
  JSON OUTPUT FORMAT: { "indicator_id": "polished text string" }`;

  const userPrompt = `Data to process: ${JSON.stringify(items)}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }, 
      temperature: 0.1, 
    });

    const content = response.choices[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : {};
    return parsed;
  } catch (error) {
    console.error("Groq Batch Error:", error);
    throw error;
  }
}
// ===========================================================================
// 🟢 PART 1: DETERMINISTIC LOGIC (UNTOUCHED)
// ===========================================================================

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

// ===========================================================================
// 🟢 PART 2: THE AI FUNCTION (STRICTEST VERSION)
// ===========================================================================

export async function generateAdminSummary(
  indicators: IndicatorSimple[]
): Promise<string> {
  
  // 1. GENERATE PART 1 (Code Logic - Untouched)
  const part1_GeneralComment = calculateClassLevelAndSentence(indicators);

  // 2. PREPARE DATA FOR PART 2
  const summaryCandidates = indicators.filter(
    (i) => i.includeInTrainerSummary && i.commentText?.trim().length > 0
  );

  const cleanNotes = summaryCandidates
    .map(i => i.commentText.replace(/\[OCR\]/gi, "").trim())
    // Strict Filter: Only lines with anchors
    .filter(t => t.length > 0 && /\[.*?\]/.test(t)); 

  // 3. Return Part 1 if no anchors
  if (cleanNotes.length === 0) {
    return part1_GeneralComment;
  }

  // 4. GENERATE PART 2 WITH AI
  // 🟢 UPDATED PROMPT: Added Vocabulary & Context Rules
  const systemPrompt = `
    You are a Senior Teacher Trainer for GrapeSEED.
    
    TASK:
    Convert the provided Anchored Notes into a Vietnamese Action List.

    STRICT RULES:
    1. Output 100% Vietnamese. No Chinese characters.
    2. Tone: Imperative, Constructive.
    3. PRONOUN RULE: Start every bullet point with a **Verb** or **"Cần"**. 
       - NEVER use "Thầy/Cô/Giáo viên" at the start.
    4. **ONE ANCHOR = ONE BULLET**: Do not split one note into multiple bullets.

    🟢 SYNTHESIS LOGIC (CRITICAL):
    - The content inside [...] is the **COMMAND**.
    - The text outside [...] is the **CONTEXT**.
    - **combine them**: Use the Command to tell the teacher *what* to do, and the Context to explain *why* or *how* specific it should be.
    - **Avoid Vagueness**: Do not just say "Review PCs". Say "Review PCs to help students practice speaking" (if the note mentions speaking).

    🟢 VOCABULARY & TRANSLATION GUIDE:
    - "Spoon-feeding" -> "làm thay học sinh", "gợi ý quá mức", "không để học sinh tự tư duy". (Do NOT use the English word).
    - "Pacing" -> "nhịp độ lớp học".
    - "Monitor" -> "quan sát và hỗ trợ".

    EXAMPLES:
    - Input: "Students struggle with counting. Teacher counted for them. [avoid spoon-feeding]"
      -> Output: "- Cần để học sinh tự thực hiện việc đếm, tránh làm thay hoặc gợi ý quá mức cho học sinh."
    
    - Input: "No speaking activities seen. [prepare speaking activities]"
      -> Output: "- Cần chuẩn bị và tổ chức thêm các hoạt động nói để học sinh có cơ hội thực hành giao tiếp nhiều hơn."
  `;

  const userPrompt = `OBSERVATION NOTES:\n${cleanNotes.map(n => `- ${n}`).join("\n")}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "openai/gpt-oss-120b", 
      temperature: 0.1, 
    });

    const aiBulletPoints = response.choices[0]?.message?.content?.trim() || "";

    if (!aiBulletPoints) return part1_GeneralComment;

    return `${part1_GeneralComment}\n\nDưới đây là một số điểm giáo viên cần cân nhắc cải thiện:\n${aiBulletPoints}`;

  } catch (error) {
    console.error("Groq Admin Summary Error:", error);
    return part1_GeneralComment;
  }
}