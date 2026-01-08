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
// 3. ADMIN SUMMARY (🟢 UPDATED LOGIC)
// ---------------------------------------------------------
router.post("/api/generate-summary", async (req, res) => {
  try {
    // Expects structured objects now: { text, isGood, title }
    const { notes, context } = req.body; 
    
    const systemPrompt = `
    You are an Educational Quality Manager writing a formal report for a School Administrator.
    
    AUDIENCE:
    - The School Admin cares about: Program Quality, Student Retention, and Professional Standards.
    - They do NOT want "teaching tips." They want "Management Actions."

    INPUT DATA:
    - Notes format: "Context/Evidence [Action Command]"
    - Status: Good (True) or Growth (False).

    YOUR TASK:
    Synthesize the notes into 3 strictly defined sections in Vietnamese.

    --------------------------------------------------
    **SECTION 1: GHI NHẬN ĐIỂM SÁNG (Strengths Narrative)**
    - Look at the "Context" (text outside brackets) of ALL notes (especially Good ones).
    - Write ONE smooth paragraph explaining the positive aspects found in the class.
    - Focus on: Student engagement, teacher attitude, and flow.
    - *Goal:* Validate that the teacher has potential.

    **SECTION 2: CÁC VẤN ĐỀ CẦN KHẮC PHỤC (Critical Issues)**
    - **Source:** Notes where **isGood = FALSE** (Growth).
    - **Tone:** Strict, Warning, Risk-Focused.
    - **Format:** Bullet points.
    - **Formula:** "• **[Category]:** [Evidence from Context]. Yêu cầu giáo viên [Action from Bracket] để đảm bảo chất lượng."
    - *Example:* "• **Về Quy trình:** Việc tự ý bỏ bước (Context) làm hổng kiến thức. Cần tuân thủ tuyệt đối giáo án (Bracket)."

    **SECTION 3: CÁC LƯU Ý ĐỂ TỐI ƯU HÓA (Operational Adjustments)**
    - **Source:** Notes where **isGood = TRUE** (Good) but contain brackets [...].
    - **Tone:** Constructive, Professional.
    - **Meaning:** "The area is generally safe, but there is a specific flaw to remove."
    - **Formula:** "• **[Category]:** Mặc dù [Context], giáo viên cần [Action from Bracket] để chuyên nghiệp hơn."
    - *Example:* "• **Về Quản lý:** Lớp học rất vui (Context), tuy nhiên cần kiểm soát tiếng ồn (Bracket) để giữ nề nếp."

    --------------------------------------------------
    RULES:
    - If a section has no data, DO NOT write that header.
    - Language: Vietnamese (Management Style).
    - Do not use exclamation marks (!).
    `;

    // We stringify the objects so LLM sees the isGood status clearly
    const userPrompt = `
    CLASS RATING CONTEXT: ${context}
    OBSERVATION NOTES: ${JSON.stringify(notes)}
    `;

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