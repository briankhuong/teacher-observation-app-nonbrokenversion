import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------

const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;
const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

router.use(express.json({ limit: "10mb" }));

// ---------------------------------------------------------
// 2. ROUTE HANDLERS
// ---------------------------------------------------------

router.head("/api/ocr-gemini", (req, res) => {
  res.status(200).end();
});

router.post("/api/ocr-gemini", async (req, res) => {
  try {
    // ---------------------------------------------------------
    // 🟢 GLOSSARY & EXPANSION (Client-side Logic)
    // ---------------------------------------------------------
    const ABBREVIATION_MAP = {
      "PCs": "Phonogram cards",
      "PWCs": "Phonogram word cards",
      "VPCs": "Vocabulary picture cards",
      "TM": "Teaching materials",
      "CM": "Classroom management",
      "AW": "Air-writing",
      "GS": "GrapeSEED",
      "LVA": "Lesson video analysis",
      "TSTS": "Teacher - student - teacher - student",
      "STS": "Student - Teacher - Student",
      "LO": "Learning objective",
      "LP": "Lesson plan",
      "AA": "Action activities",
      "MPC": "Multi-letter phonogram",
      "Ss": "Students",
      "PC": "Progress check"
    };

    const expandAbbreviations = (text) => {
      if (!text) return "";
      const pattern = new RegExp(`\\b(${Object.keys(ABBREVIATION_MAP).join('|')})\\b`, 'g');
      return text.replace(pattern, (matched) => ABBREVIATION_MAP[matched]);
    };

    // --- Safety Checks ---
    if (!GEN_AI_KEY) {
      console.error("❌ GOOGLE_GENERATIVE_AI_KEY is missing.");
      return res.status(500).json({ error: "Server missing Google API Key" });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // --- 🟢 CONFIGURATION FOR LOWEST COST ---
    // 1. Use "2.5-flash-lite" (Requested Model).
    // 2. Force JSON response to stop "thinking".
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite", 
      generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.1 // Low temp for stricter adherence
      }
    });

    // --- 🟢 ZERO-THOUGHT PROMPT ---
    const prompt = `EXTRACT TEXT.
      
      Output a JSON object with the literal handwriting transcription.
      
      JSON Schema:
      { "text": "string" }
      
      STRICT RULES:
      1. VERBATIM ONLY: Write exactly what you see.
      2. NO EXPANSION: Do NOT expand "LP" to "Lesson Plan". 
      3. NO PRONOUNS IN BRACKETS: Do NOT add "I" or "We" inside [ ].
        - BAD: "[I follow LP]"
        - GOOD: "[follow LP]"
      4. KEEP BRACKETS RAW: Content inside [ ] must be copied exactly.
      5. NO GRAMMAR FIXING.
      `;

    // --- Send to Gemini ---
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg",
        },
      },
    ]);

    const response = await result.response;
    const responseText = response.text();
    
    // --- 🟢 PARSE JSON ---
    let rawText = "";
    try {
      const json = JSON.parse(responseText);
      rawText = json.text || "";
    } catch (e) {
      console.warn("Gemini JSON parse failed, falling back to raw text:", e);
      rawText = responseText; // Fallback if JSON fails (rare)
    }

    // ---------------------------------------------------------
    // 🟢 FAIL-SAFE CLEANUP (JavaScript Regex)
    // ---------------------------------------------------------
    // Since Lite models sometimes ignore instructions, we force-clean the text here.
    
    // 1. Remove "I/We" from brackets (e.g., "[I follow" -> "[follow")
    rawText = rawText.replace(/\[\s*(?:I|We)\s+/gi, "[");
    
    // 2. Revert common unwanted expansions if the AI did them
    rawText = rawText
      .replace(/Phonogram\s+word\s+cards/gi, "PWCs")
      .replace(/Phonogram\s+cards/gi, "PCs")
      .replace(/Lesson\s+plan/gi, "LP");

    // --- Sticky Block Logic ---
    // Ensure bullets and markers stay attached to their lines
    const rawLines = rawText.split(/\r?\n/);

    let formattedText = rawLines.reduce((acc, line) => {
      const cleanLine = line.trim();
      if (!cleanLine) return acc;

      // Check for markers like "-" or "(GA)"
      const isMarker = cleanLine.startsWith("-") || 
                       cleanLine.toUpperCase().startsWith("(GA)");

      if (acc.length === 0) return cleanLine;

      if (isMarker) {
        return `${acc}\n\n${cleanLine}`;
      } else {
        return `${acc} ${cleanLine}`;
      }
    }, "");

    // --- 🟢 JS EXPANSION (Free) ---
    // Now we expand them controllably using your Glossary map
    formattedText = expandAbbreviations(formattedText);

    return res.json({ 
      text: formattedText, 
      confidence: 0.95 
    });

  } catch (err) {
    console.error("Gemini OCR Error:", err);
    let errorMessage = "Failed to process image.";
    // Handle safety blocks
    if (err.message && (err.message.includes("SAFETY") || err.message.includes("blocked"))) {
      errorMessage = "Gemini blocked this image due to safety filters.";
    }
    return res.status(500).json({ error: errorMessage, details: err.message });
  }
});

export default router;