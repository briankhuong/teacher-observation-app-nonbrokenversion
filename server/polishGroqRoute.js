import express from "express";
import Groq from "groq-sdk";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

const router = express.Router();

// Memory storage handles the audio buffer directly
const upload = multer({ storage: multer.memoryStorage() });

// 🔒 Secure Initialization (No dangerouslyAllowBrowser)
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, 
});

router.use(express.json());

// ---------------------------------------------------------
// 0. NEW: TRANSCRIPTION PROXY (ADDED)
// ---------------------------------------------------------
router.post("/api/transcribe", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });

    const formData = new FormData();
    // Force Vietnamese + English Prompt
    formData.append("language", "vi"); 
    formData.append("prompt", "GrapeSEED Teacher Observation. Checking indicators. Unit 5 Lesson 1. Học sinh phát âm tốt. OK so this is a test. Giáo viên làm mẫu.");
    formData.append("model", "whisper-large-v3");
    formData.append("response_format", "json");

    // Pass the file buffer to Groq
    const filename = req.file.originalname || "recording.webm";
    formData.append("file", req.file.buffer, filename);

    const response = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", formData, {
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        ...formData.getHeaders(),
      },
    });

    res.json({ text: response.data.text });
  } catch (error) {
    console.error("❌ Transcription Failed:", error.response?.data || error.message);
    res.status(500).json({ error: "Server transcription failed" });
  }
});

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
          content: `You are a specialized grammar correction engine for English Phonics Teacher notes.

          DOMAIN CONTEXT (CRITICAL):
          - Notes often contain specific phonetic sounds like /t/, /d/, (H), or 'schwa'.
          - **ABSOLUTE RULE:** NEVER autocorrect phonetic markers or short codes into real words.
            - Correct: "emphasizing the /t/ sound"
            - Wrong: "emphasizing the at sound"
            - Keep short codes like "ltl" (little) or "sts" (students) if uncertain, do not guess.

          OPERATIONAL GUIDE:
          1. FIX GRAMMAR & SHORTHAND:
             - Fix Tense, Grammar, and Punctuation.
             - Expand standard shorthand (e.g., "tchr" -> "teacher", "w/" -> "with").
             
          2. UPGRADE SPECIFIC PHRASING (CLARITY):
             - Interpret "broken" descriptions into standard classroom terms:
             - "taking turn ask and answer" -> "during the Q&A session"
             - "do not seem to focus" -> "appeared distracted" or "struggled to focus"
             - "read from memory" -> "recited from memory"

          3. BRACKET LOGIC [Action > Result]:
             - The user uses brackets to show: [Action to take > Intended result].
             - **You MUST fix grammar INSIDE the brackets**, but strictly preserve the ">" separator.
             - **Rule:** Ensure the 'Result' side (right of >) starts with "to" if it implies a purpose.
             - Input: "[ask them to repeat > stay engaged]"
             - Output: "[ask them to repeat > to maintain engagement]"

          4. PRESERVE STRUCTURE:
             - Keep "(GA)" tags, hyphens "-", and bullet points exactly as they are.
             - Do NOT use markdown bolding (**).

          OUTPUT RULES:
          - Return ONLY the refined text.`
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
// STEP 1: AGENTIC LOGIC COMPILER (Detective -> Writer Pipeline)
// ---------------------------------------------------------
router.post("/api/generate-next-steps", async (req, res) => {
  try {
    const { notes } = req.body; 
    if (!notes || notes.length === 0) return res.json({ result: "" });

    // =========================================================
    // 🕵️ SUB-STEP A: THE PEDAGOGICAL DETECTIVE (Logic Only)
    // Goal: Identify the "Real" Error and Output Safe JSON
    // =========================================================
    
    const detectiveSystemPrompt = `
    ROLE: Expert GrapeSEED Educational Analyst.
    TASK: Analyze teacher observation notes to identify the ROOT CAUSE and LOGICAL CATEGORY.
    
    OUTPUT FORMAT: Return a SINGLE JSON OBJECT strictly adhering to this schema:
    {
      "analysis": [
        {
          "original_note": "string",
          "category": "ROBOTIC_TEACHING" | "PREPARATION_ISSUE" | "MISUNDERSTANDING_GOAL" | "CLASSROOM_MANAGEMENT" | "INSTRUCTIONAL_DELIVERY",
          "root_cause_explanation": "One sentence explaining the deep logic error",
          "key_evidence_quoted": "STRING. (CRITICAL: If multiple quotes exist, join them with commas into ONE string. Do NOT create a list.)",
          "solution_strategy": "The strategic fix"
        }
      ]
    }

    LOGIC RULES (CRITICAL):
    1. **The 'Green Book' Paradox:** - If teacher misses an item but *skips* the question -> Category: PREPARATION_ISSUE.
       - If teacher misses an item but *still asks* "Where is it?" -> Category: ROBOTIC_TEACHING.
    
    2. **'Missing the gist':**
       - Category: MISUNDERSTANDING_GOAL.
       - Meaning: Teacher didn't grasp the core objective.

    3. **Proper Nouns & Quotes:**
       - Identify Capitalized phrases (e.g., "The Beehive") and Student Speech (e.g. said "duck").
    `;

    // Call Agent A (Detective)
    const detectiveResponse = await groq.chat.completions.create({
      messages: [
        { role: "system", content: detectiveSystemPrompt },
        { role: "user", content: JSON.stringify(notes) }
      ],
      model: "openai/gpt-oss-120b", 
      response_format: { type: "json_object" }, 
      temperature: 0.1, 
    });

    // 🛡️ Robust Parsing: Handle potential markdown wrappers
    let rawContent = detectiveResponse.choices[0]?.message?.content || "{}";
    rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();

    let analysisData;
    try {
        analysisData = JSON.parse(rawContent);
        if (Array.isArray(analysisData)) {
            analysisData = { analysis: analysisData };
        }
    } catch (e) {
        console.error("JSON Parse Error on Detective Output:", rawContent);
        analysisData = { analysis: [] };
    }

    // =========================================================
    // ✍️ SUB-STEP B: THE VIETNAMESE WRITER (Translation + Glossary)
    // Goal: Write professional feedback using the Analysis + Glossary
    // =========================================================

    const writerSystemPrompt = `
    ROLE: Senior Vietnamese Educational Administrator.
    TASK: Write constructive feedback based on the provided PEDAGOGICAL ANALYSIS JSON.

    INPUT DATA: You will receive a JSON object containing "root_cause_explanation", "category", and "solution_strategy".
    
    WRITING RULES (TONE & STRUCTURE):
    1. **Trust the Analysis:** - If Category is "ROBOTIC_TEACHING", use words like "máy móc", "thiếu tính thực tế".
       - If Category is "MISUNDERSTANDING_GOAL", use "chưa nắm vững mục tiêu cốt lõi".
    
    2. **Structure (CRITICAL - LIST FORMAT):**
       - **OUTPUT MUST BE A LIST:** You must output a bulleted list using hyphens (-).
       - **SPACING:** Put a blank line between each bullet point for readability.
       - **Item Format:** Inside each bullet point, write ONE smooth paragraph merging Problem + Solution.
       - **Example Output:**
         - Quan sát cho thấy [Vấn đề A]... Do đó, giáo viên cần [Giải pháp A].
         
         - Trong hoạt động [Tên], giáo viên đã [Vấn đề B]... Vì vậy, cần [Giải pháp B].

    3. **Sentence Variety:**
       - Do NOT start every point with "Việc giáo viên...".
       - Use: "Quan sát cho thấy...", "Trong hoạt động...", "Hiện tại...".

    4. **Direct Observation:** - No "as noted in..." (như ghi chú).
       - No "as observed" (như quan sát). Just state the fact.

    5. **Subject Rules:** - Teacher = "Giáo viên" (Active Voice).
       - Students = "Học sinh".

    --------------------------------------------------------
    📚 FULL GLOSSARY (MANDATORY REPLACEMENTS):
    
    *Core Terminology:*
    - "Unit" -> "học phần" (NEVER "đơn vị")
    - "Demonstrate" -> "làm mẫu" or "hướng dẫn"
    - "Text" -> "chữ"
    - "Decode" (verb) -> "đánh vần"
    - "Decode" (noun) -> "hoạt động đánh vần"
    - "Assemble" -> "ghép âm"
    - "Assembly" -> "hoạt động ghép âm"
    - "Sound" -> "âm" (NEVER "âm vị")
    - "Letter sound" -> "âm của chữ cái"
    - "Phonogram" -> "ngữ âm"
    - "Multi-letter phonogram" -> "thẻ đa ngữ âm"
    - "Air-writing" -> "hoạt động viết trên không"
    - "LVA" / "Lesson Video Analysis" -> "phân tích video lớp học"
    - "Classroom management" -> "kỹ năng quản lý lớp học"
    - "Input" -> "nạp kiến thức đầu vào (input)"
    - "Exposure" -> "tiếp xúc (exposure)"
    - "TSTS" -> "mô hình TSTS"
    - "Read" OR "Sing" -> "trình bày học liệu (đọc/hát)"
    - "Whole-class reading" -> "đọc đồng thanh"
    - "Read from memory" -> "đọc vẹt/đọc thuộc lòng"
    - "Cover text" -> "che phần chữ"

    *Materials & Components:*
    - "VPCs" -> "Thẻ từ vựng (VPCs)"
    - "PCs" -> "Thẻ ngữ âm (PCs)"
    - "Poem" -> "Bài thơ"
    - "Chants" -> "Bài vè"
    - "Song" -> "Bài hát"
    - "Big book" -> "Cuốn sách lớn"
    - "Reader" -> "Sách đọc"
    - "Let's start reading" -> "Bài đọc câu (Let's start reading)"
    - "Component" -> "học liệu"
    - "Teaching materials" -> "học liệu"

    --------------------------------------------------------
    ⛔ NEGATIVE CONSTRAINTS (BANNED):
    - NO "âm vị".
    - NO "trình diễn".
    - NO "như được ghi nhận".
    - NO invented headers (like "Giải pháp:").
    - NO symbols (**, [], ->).
    - **NO QUOTES around Vietnamese terms:**
       - *Bad:* “hoạt động viết trên không”, “âm của chữ cái”
       - *Good:* hoạt động viết trên không, âm của chữ cái

    --------------------------------------------------------
    🔠 PROPER NOUN & QUOTE HANDLING:
    - **Proper Nouns:** Prefix Capitalized Names with "học liệu" (e.g. học liệu 'The Beehive').
    - **Strict Quote Rule:** ONLY use quotes for:
      1. **English Student Speech** (e.g. học sinh nói "duck").
      2. **English Card Content** (e.g. từ "Cat").
      3. **Specific Component Names** (e.g. học liệu "Writers").
    `;

    // Call Agent B (Writer)
    const writerResponse = await groq.chat.completions.create({
      messages: [
        { role: "system", content: writerSystemPrompt },
        { role: "user", content: JSON.stringify(analysisData) }
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.2, 
    });

    const result = writerResponse.choices[0]?.message?.content?.trim() || "";
    res.json({ result });

  } catch (error) {
    console.error("Agentic Chain Error:", error);
    res.json({ result: "- Không thể tạo báo cáo do lỗi hệ thống. Vui lòng thử lại." });
  }
});
export default router;