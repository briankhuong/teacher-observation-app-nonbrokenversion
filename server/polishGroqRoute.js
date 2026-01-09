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
// STEP 1: STRICT LOGIC COMPILER (Foundation)
// ---------------------------------------------------------
router.post("/api/generate-next-steps", async (req, res) => {
  try {
    const { notes } = req.body; 
    if (!notes || notes.length === 0) return res.json({ result: "" });

    const systemPrompt = `
    ROLE: Strict Logic Translator.
    OBJECTIVE: Map "Context" -> "Solution" using direct, factual sentences.

    1. **SUBJECT RULES (STRICT):**
       - **Student Context:** Start with "Học sinh...". (NEVER use "Giáo viên nhận thấy...").
       - **Teacher Context:** Start with "Giáo viên...".

    2. **MAPPING STRATEGY:**
       - **Format:** [Context/Problem]. [Connector] [Solution/Bracket].
       - **Connector:** Use "Do đó," or "Vì vậy," or "Tuy nhiên," (if contrasting).
       - **NO "VÌ" START:** Do NOT start bullet points with "Vì..." (Because).

    3. **GLOSSARY:**
       - "Teacher/You" -> "Giáo viên"
       - "Students/Ss" -> "học sinh"
       - "Sound" -> "âm"
       - "Phonogram" -> "ngữ âm"
       - "Component" -> "học liệu"
       - "TSTS" -> "thứ tự Giáo viên - Học sinh - Giáo viên - Học sinh (TSTS)"
       - "Input" -> "nạp kiến thức đầu vào (input)"
       - "Exposure" -> "tiếp xúc (exposure)"
       - "Read" OR "Sing" -> "trình bày học liệu (đọc/hát)"
       
       *Materials:*
       - "VPCs" -> "Thẻ từ vựng (VPCs)"
       - "PCs" -> "Thẻ ngữ âm (PCs)"
       - "Poem" -> "Bài thơ (Poem)"
       - "Chants" -> "Bài vè (Chants)"
       - "Big book" -> "Cuốn sách lớn (Big book)"
       - "Reader" -> "Sách đọc (Reader)"
       - "Song" -> "Bài hát (Song)"
       - "Let's start reading" -> "Bài đọc câu (Let's start reading)"

    4. **LOGIC EXECUTION:**
       - "[A > B]" -> "...cần [A] để [B]."
       - "Problem A AND Problem B" -> "Problem A. Đồng thời, Problem B..."

    Example:
    Input: "Students struggled to read. [cover text > read with understanding]"
    Output: "- Học sinh gặp khó khăn khi đọc. Do đó, giáo viên cần che phần chữ để các em đọc hiểu thay vì đọc thuộc lòng."
    `;

    const userPrompt = `NOTES TO PROCESS:\n${JSON.stringify(notes)}`;

    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.1, // 🔒 LOCKED FOR CONSISTENCY
    });

    const result = response.choices[0]?.message?.content?.trim() || "";
    res.json({ result });

  } catch (error) {
    console.error("Groq Step 1 Error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ---------------------------------------------------------
// STEP 2: NATURALIZE FLOW (The Stabilizer)
// ---------------------------------------------------------
router.post("/api/naturalize-text", async (req, res) => {
  try {
    const { text } = req.body; 

    const systemPrompt = `
    ROLE: Senior Vietnamese Educational Consultant.
    TASK: Polish raw teacher observation notes into natural, professional, and constructive feedback.

    STRICT GUIDELINES:
    1. **NO ASTERISKS / MARKDOWN:** - Do NOT use the "*" character anywhere. 
       - Do NOT bold text (e.g., no **text**). 
       - Use simple hyphens (-) for bullet points.

    2. **Structure & Headers:**
       - **Overview:** Polish the "Đánh giá tổng quan" sentence naturally.
       - **Bullet Points:** For the improvement points, infer a short Topic Header (2-4 words) followed by a colon (:). 
       - **Format:** "- Header: Content..."

    3. **Tone & Flow:**
       - **No Repetition:** DO NOT start every sentence with "Do đó", "Vì vậy", or "Giáo viên".
       - **Cohesion:** Combine the "Problem" (Observation) and "Solution" (Next Step) into one smooth paragraph.
       - **No Redundancy:** Do NOT add a summary/overview bullet point inside the list of improvements.

    4. **Vocabulary & Rules:**
       - **Subject:** Use "Giáo viên" exclusively. NEVER use "Thầy/Cô".
       - **Educational Terms:** Use "đọc đồng thanh" (whole-class reading), "đọc thuộc lòng" (read from memory), "che phần chữ" (cover text).

    INPUT EXAMPLE:
    "- Giáo viên dành quá nhiều thời gian cho ví dụ. Do đó nên bỏ qua phần này."

    OUTPUT EXAMPLE:
    "- Quản lý thời gian: Việc dành quá nhiều thời gian cho ví dụ đã làm chậm tiến độ. Giáo viên nên lược bỏ phần này để duy trì nhịp độ ổn định."
    `;

    const userPrompt = `TEXT TO NATURALIZE:\n${text}`;

    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "openai/gpt-oss-120b", 
      temperature: 0.1, 
    });

    const result = response.choices[0]?.message?.content?.trim() || text;
    res.json({ result });

  } catch (error) {
    console.error("Groq Step 2 Error:", error);
    res.status(500).json({ error: "Failed to naturalize text" });
  }
});

export default router;