// src/utils/gemini.ts
import Groq from "groq-sdk";


const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true 
});

/**
 * Polish a single note using Groq (Stricter Version)
 * Focused on cleaning text while preserving specific markers.
 */
export async function polishTextWithGroq(text: string): Promise<string> {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a strict grammar correction engine. Your goal is to make text grammatical, not "fancy."

          OPERATIONAL GUIDE:
          1. FIX THE BROKEN ENGLISH:
             - Expand shorthand (e.g., "tchr" -> "teacher", "stdnts" -> "students").
             - Fix Tense & Grammar (e.g., "She speak loud" -> "She spoke loudly").
             - Add "Glue" Words (e.g., "Students happy" -> "The students were happy").
             - Fix Punctuation (Capitalize starts, end with periods).

          2. DO NOT CHANGE THE STYLE (CRITICAL):
             - Do NOT upgrade vocabulary. If the user wrote "good job", keep it "Good job." Do NOT change it to "Exemplary performance."
             - Do NOT add facts or details not present in the input.
             - Keep it simple and direct.

          3. PRESERVE STRUCTURE:
             - You MUST preserve all existing formatting markers including hyphens "-", bullet points, and tags like "(GA)".

          OUTPUT RULES:
          - Return ONLY the corrected text.
          - Do not add conversational filler like "Here is the fixed text."`
        },
        {
          role: "user",
          content: text
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, // Low temp is perfect here to prevent "creative" vocabulary changes
    });

    return chatCompletion.choices[0]?.message?.content?.trim() || text;
  } catch (error) {
    console.error("Groq Polish Error:", error);
    throw error;
  }
}

/**
 * 🟢 Batch Polish with Groq (True JSON Mode)
 * Processes multiple indicators in one single request.
 */
export async function polishBatchWithGroq(items: { id: string; text: string }[]) {
  const systemPrompt = `You are a professional text processing engine. 
  TASK: Rewrite teacher observation notes for professional tone and grammar.
  
  STRICT MACHINE RULES:
  1. Return ONLY a valid JSON object. 
  2. NO Conversational filler (e.g., "Here is your polish...").
  3. PRESERVE HYPHENS: Do not remove or trim leading or trailing hyphens "-".
  4. PRESERVE TAGS: Do not remove "(GA)" tags.
  5. If a note is too short to polish, return it as is but maintain markers.
  
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
    
    // Safety check: ensure we didn't get a nested "results" object
    return parsed;
  } catch (error) {
    console.error("Groq Batch Error:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 🟢 NEW: GENERATE ADMIN SUMMARY (Vietnamese Translation with Anchors)
// ---------------------------------------------------------------------------

/**
 * Takes RAW English notes (with anchors like [AD], [Hint]) and
 * generates a professional Vietnamese Action Plan.
 * * Used by: "Preview Admin Report" button.
 */
export async function generateAdminSummary(rawNotes: string[]): Promise<string> {
  if (!rawNotes.length) return "";

  const systemPrompt = `
    You are a Senior Teacher Trainer for GrapeSEED.
    
    TASK:
    Convert the following raw observation notes (English) into a professional "Next Steps" Action Plan in Vietnamese for the School Administrator.

    STRICT TRANSLATION RULES (The "Anchor" System):
    1. "[AD]" Tag: If a line ends with [AD], it is already a solution. Translate it DIRECTLY to professional Vietnamese.
       - Ex: "Separate the boys [AD]" -> "Cần tách vị trí ngồi của các học sinh nam mất trật tự."
    
    2. "[Keyword]" Hint: If you see a keyword in brackets like [Props] or [CCQs], ignore the specific question and write a standard recommendation for that skill.
       - Ex: "Why no checking? [CCQs]" -> "Sử dụng câu hỏi kiểm tra bài (CCQs) thường xuyên để đảm bảo học sinh hiểu bài."
    
    3. No Tag? If a note has no brackets, synthesize the core meaning into a constructive/positive action item in Vietnamese.
       - Ex: "Teacher spoke too fast" -> "Cần điều chỉnh tốc độ nói chậm lại để học sinh dễ tiếp thu."

    OUTPUT FORMAT:
    - Return a clean bulleted list in Vietnamese.
    - Professional, constructive, and clear.
    - Do NOT include the original English.
    - Do NOT include conversational filler.
  `;

  const userPrompt = `INPUT DATA:\n${rawNotes.map(n => `- ${n}`).join("\n")}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3, // Slightly higher creativity allowed for translation flow
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("Groq Admin Summary Error:", error);
    throw error;
  }
}