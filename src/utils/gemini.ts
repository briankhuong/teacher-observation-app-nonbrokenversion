import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true 
});

/**
 * Polish a single note using Groq (Stricter Version)
 * Keeps specific domain terms (phonetics) and system anchors intact.
 */
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
 * Optimized for speed using JSON mode.
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

// ---------------------------------------------------------------------------
// 🟢 NEW: GENERATE ADMIN SUMMARY (Synthesized & Natural)
// ---------------------------------------------------------------------------

export async function generateAdminSummary(rawNotes: string[]): Promise<string> {
  if (!rawNotes.length) return "";

  // 🟢 STEP 1: STRICT PRE-PROCESSING
  // Filter out any lines that don't contain anchors before sending to AI
  const allLines = rawNotes.join("\n").split("\n");

  const cleanNotes = allLines
    .map(line => line.replace(/\[OCR\]/gi, "").trim())
    // 🔒 STRICT FILTER: Drop lines without brackets [...]
    .filter(line => /\[.*?\]/.test(line));

  if (cleanNotes.length === 0) return "";

  const systemPrompt = `
    You are a Senior Teacher Trainer for GrapeSEED.
    
    TASK:
    Read the observation notes and generate a professional Vietnamese Action Plan using a strict 3-part structure.

    STRICT LANGUAGE GUARDRAILS:
    1. OUTPUT MUST BE 100% VIETNAMESE (Quốc ngữ).
    2. 🚫 NO CHINESE CHARACTERS (Kanji/Hanzi).
       - BAD: "tham gia思考"
       - GOOD: "tham gia suy nghĩ" or "tư duy".
    3. Natural, Native Vietnamese Only.

    PRONOUN & TONE RULES:
    1. "He"/"Him" -> "Thầy" (Male).
    2. "She"/"Her" -> "Cô" (Female).
    3. NEVER use "Ông ấy", "Bà ấy", "Tôi" (I).
    4. TONE: Professional, Constructive, "Educational Management" (Tiếng Việt quản lý).

    -----------------------------------
    REQUIRED OUTPUT STRUCTURE (3 PARTS):
    -----------------------------------
    
    PART 1: EXECUTIVE SUMMARY (Thematic Overview)
    - Write ONE natural paragraph (4-6 sentences) summarizing the *general quality* and *main themes*.
    - CRITICAL: Do NOT list specific errors here (don't mention "/t/" or "PWC steps" here). Save details for the list.
    - Focus on categories: "Hầu hết các vấn đề liên quan đến kỹ thuật giảng dạy...", "Cần chú ý hơn về việc quản lý không gian..."
    - Start with a positive acknowledgment of energy/preparation.

    PART 2: TRANSITION LINE (Verbatim)
    "Dưới đây là một số điểm giáo viên cần cân nhắc cải thiện:"

    PART 3: ACTION ITEMS (Merged & Synthesized)
    - Do NOT split the sentence (e.g., "Teacher did X; need to do Y").
    - SYNTHESIZE the "Observation" and the "Anchor Solution" into ONE fluid imperative sentence.
    - FORMULA: [Action Command from Anchor] + [Context from Note].
    
    Examples of Synthesis:
    - Input: "Skipped emphasizing /t/ [follow LP]"
    - Output: "Cần tuân thủ đúng giáo án, đặc biệt là việc nhấn mạnh âm /t/ trong bài hát." (Merged).
    
    - Input: "Wrong steps in PWC [adjust PWC steps]"
    - Output: "Cần điều chỉnh các bước dạy thẻ từ (Phonogram word cards) để đảm bảo đúng quy trình."
    
    - Input: "Students talk too much [AD]"
    - Output: "Giáo viên cần quản lý lớp chặt chẽ hơn để hạn chế việc học sinh nói chuyện riêng."

    -----------------------------------
    FINAL OUTPUT FORMAT:
    [Executive Summary Paragraph]
    
    Dưới đây là một số điểm giáo viên cần cân nhắc cải thiện:
    * [Synthesized Action Item 1]
    * [Synthesized Action Item 2]
    ...
  `;

  const userPrompt = `INPUT DATA:\n${cleanNotes.map(n => `- ${n}`).join("\n")}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      // 🟢 UPDATED: Using OpenAI GPT-OSS-120B for better reasoning & Vietnamese nuance
      model: "openai/gpt-oss-120b", 
      temperature: 0.1, 
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("Groq Admin Summary Error:", error);
    throw error;
  }
}