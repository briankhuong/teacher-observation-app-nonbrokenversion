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
// STEP 1: STRICT LOGIC COMPILER (Foundation & Analysis)
// ---------------------------------------------------------
router.post("/api/generate-next-steps", async (req, res) => {
  try {
    const { notes } = req.body; 
    if (!notes || notes.length === 0) return res.json({ result: "" });

    const systemPrompt = `
    ROLE: Senior Educational Analyst & Translator (Vietnamese).
    OBJECTIVE: Analyze observation notes and map "Context" -> "Solution" using correct GrapeSEED terminology.

    0. **ANALYSIS PHASE (INTERNAL LOGIC - DO NOT SKIP):**
       - **Interpret "Missing the gist":** This does NOT mean the teacher forgot to say something. It means they **misunderstood the goal** of the component. 
         - *Translation:* "chưa nắm vững mục tiêu cốt lõi/trọng tâm".
       - **Analyze "Robotic Teaching":** If a teacher asks a question (e.g., "Where is it?") about a missing item, the consequence is NOT just "confusion". It is "teaching without meaning" or "illogical teaching".
         - *Output:* "...việc này là giảng dạy máy móc, thiếu tính thực tế..."
       - **Proper Noun Handling:** Treat "The Beehive", "Old MacDonald" as Proper Nouns. 
         - **RULE:** Always prefix with "học liệu" (component). 
         - *Correct:* "trong học liệu 'The Beehive'".
         - *Wrong:* "trong buổi The beehive".

    1. **STRICT GLOSSARY (REPLACE EXACTLY):**
       - "Unit" -> "học phần" (NEVER "đơn vị")
       - "Demonstrate/Demonstrated" -> "làm mẫu" or "hướng dẫn" (NEVER "trình diễn")
       - "Text" -> "chữ"
       - "Decode" -> "đánh vần"
       - "Assembly" -> "hoạt động ghép âm"
       - "Air-writing" -> "hoạt động viết trên không"
       - "Lesson Video Analysis (LVA)" -> "phân tích video lớp học"
       - "Multi-letter phonogram" -> "thẻ đa ngữ âm"
       
       *Materials:*
       - "VPCs" -> "Thẻ từ vựng (VPCs)"
       - "PCs" -> "Thẻ ngữ âm (PCs)"
       - "Poem/Chants/Song" -> "Bài thơ/Bài vè/Bài hát"
       - "Big book" -> "Cuốn sách lớn"
       - "Reader" -> "Sách đọc"

    2. **VOCABULARY RULES:**
       - If a word is **content** (e.g., horse card, said "duck"), keep it English in quotes: "thẻ 'horse'", "nói 'duck'".
       - **Subject:** Teacher = "Giáo viên", Students = "Học sinh".

    3. **NEGATIVE CONSTRAINTS (BANNED WORDS):**
       - NO "trình diễn" (use "làm mẫu").
       - NO "đơn vị" (use "học phần").
       - NO "buổi [Tên bài hát]" (use "học liệu [Tên bài hát]").
       - NO "gây nhầm lẫn" IF the action was totally illogical (use "thiếu tính logic/thực tế").

    4. **MAPPING STRATEGY:**
       - **Format:** [Context/Problem containing Specific Evidence]. [Connector] [Solution/Bracket].
       - **Examples:**
         - Input: "Your assembly session was missing the gist."
         - Output: "- Giáo viên chưa nắm vững mục tiêu cốt lõi của hoạt động ghép âm (Assembly)."
         
         - Input: "You didn't have the green book but still asked 'Where is it?'."
         - Output: "- Giáo viên thiếu 'green book' nhưng vẫn hỏi 'Where is it?'. Đây là cách dạy máy móc, thiếu thực tế. Do đó..."

    `;

    const userPrompt = `NOTES TO PROCESS:\n${JSON.stringify(notes)}`;

    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      // 💡 TEMPERATURE DROP: Lower temperature forces stricter adherence to the glossary
      model: "openai/gpt-oss-120b",
      temperature: 0.1, 
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
    1. **NO ASTERISKS / MARKDOWN:** - Do NOT use bold (**), italics (*), or markdown headers (#).

    2. **HEADER RULES (CRITICAL):**
       - **NO INVENTED HEADERS:** Do NOT create new titles like "Kế hoạch dự phòng:" or "Quản lý thời gian:".
       - **PRESERVE EXPLICIT HEADERS:** Only if the input text SPECIFICALLY starts with a category (e.g. "Assembly:", "VPCs:"), then keep it.
       - **DEFAULT:** Start the bullet point immediately with the content sentence.
       - **Format:** "- [Existing Header if any]: [Content...]" OR "- [Content...]"

    3. **Tone & Flow:**
       - **No Repetition:** DO NOT start every sentence with "Do đó", "Vì vậy", or "Giáo viên".
       - **Cohesion:** Combine the "Problem" (Observation) and "Solution" (Next Step) into one smooth paragraph.

    4. **Vocabulary & Rules:**
       - **Subject:** Use "Giáo viên" exclusively. NEVER use "Thầy/Cô".
       - **Educational Terms:** Use "đọc đồng thanh" (whole-class reading), "đọc thuộc lòng" (read from memory), "che phần chữ" (cover text).

    INPUT EXAMPLE:
    "- Giáo viên dành quá nhiều thời gian cho ví dụ. Do đó nên bỏ qua phần này."

    OUTPUT EXAMPLE (Note: No header invented):
    "- Việc dành quá nhiều thời gian cho ví dụ đã làm chậm tiến độ lớp học. Giáo viên nên cân nhắc lược bỏ phần này để duy trì nhịp độ giảng dạy ổn định."
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