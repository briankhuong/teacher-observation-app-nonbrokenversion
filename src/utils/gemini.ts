import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true 
});

/**
 * Polish a single note using Groq (Stricter Version)
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
// 🟢 NEW: GENERATE ADMIN SUMMARY (Natural Vietnamese)
// ---------------------------------------------------------------------------

export async function generateAdminSummary(rawNotes: string[]): Promise<string> {
  if (!rawNotes.length) return "";

  // 🟢 STEP 1: STRICT PRE-PROCESSING
  const allLines = rawNotes.join("\n").split("\n");

  const cleanNotes = allLines
    .map(line => line.replace(/\[OCR\]/gi, "").trim())
    // 🔒 STRICT FILTER: Drop lines without brackets [...]
    .filter(line => /\[.*?\]/.test(line));

  if (cleanNotes.length === 0) return "";

  const systemPrompt = `
    You are a Senior Teacher Trainer for GrapeSEED.
    
    TASK:
    Translate the provided English observations into a professional Vietnamese Action Plan for the School Administrator.

    STRICT PRONOUN & TONE RULES:
    1. "He"/"Him" -> "Thầy" (Teacher, male).
    2. "She"/"Her" -> "Cô" (Teacher, female).
    3. NEVER use "Ông ấy", "Bà ấy", "Tôi" (I).
    4. TONE: Professional, constructive, "Educational Management" style.

    ANCHOR LOGIC ([...] Tags):
    1. TREAT BRACKETS AS INSTRUCTIONS:
       - Text inside [...] is a directive for the teacher, NOT a personal statement.
       - Ignore "I" or "We" inside brackets.
       - Ex: "[I follow Lesson plan]" -> "Cần tuân thủ đúng giáo án." (NOT "Tôi sẽ...")
       - Ex: "[adjust PWC steps]" -> "Cần điều chỉnh các bước dạy thẻ từ (PWC)."
       
    2. "[AD]" Tag:
       - The text preceding [AD] is the observation. Convert it to a polite suggestion or requirement.
       - Ex: "Students talk too much [AD]" -> "Thầy cần quản lý lớp tốt hơn, tránh để học sinh nói chuyện riêng."

    OUTPUT FORMAT:
    - Return a clean bulleted list in Vietnamese.
  `;

  const userPrompt = `INPUT DATA:\n${cleanNotes.map(n => `- ${n}`).join("\n")}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, 
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("Groq Admin Summary Error:", error);
    throw error;
  }
}