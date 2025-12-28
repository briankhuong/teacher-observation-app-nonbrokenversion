import express from "express";
import Groq from "groq-sdk";

const router = express.Router();

// 🔒 Secure Initialization (No dangerouslyAllowBrowser)
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, 
});

router.use(express.json());

// ---------------------------------------------------------
// 1. SINGLE TEXT POLISH
// ---------------------------------------------------------
router.post("/api/polish-text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

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
        { role: "user", content: text }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, 
    });

    const polished = chatCompletion.choices[0]?.message?.content?.trim() || text;
    res.json({ polished });

  } catch (error) {
    console.error("Groq Polish Error:", error);
    res.status(500).json({ error: "Failed to polish text" });
  }
});

// ---------------------------------------------------------
// 2. BATCH POLISH
// ---------------------------------------------------------
router.post("/api/polish-batch", async (req, res) => {
  try {
    const { items } = req.body; // Expects array of { id, text }
    
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
    
    res.json(parsed);

  } catch (error) {
    console.error("Groq Batch Error:", error);
    res.status(500).json({ error: "Failed to process batch" });
  }
});

// ---------------------------------------------------------
// 3. ADMIN SUMMARY
// ---------------------------------------------------------
router.post("/api/generate-summary", async (req, res) => {
  try {
    const { notes } = req.body; // Expects string[] of clean notes
    
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

    const userPrompt = `OBSERVATION NOTES:\n${notes.join("\n")}`;

    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "openai/gpt-oss-120b", 
      temperature: 0.1, 
    });

    const summary = response.choices[0]?.message?.content?.trim() || "";
    res.json({ summary });

  } catch (error) {
    console.error("Groq Summary Error:", error);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});

export default router;