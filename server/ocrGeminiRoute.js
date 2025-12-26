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
    // 🟢 OPTIMIZATION: Glossary is defined here for JS, NOT sent to AI
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

    // 🟢 REMOVED: const GLOSSARY_STRING ... (We don't send this to AI anymore)

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

    // --- Prepare Model ---
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // --- 🟢 OPTIMIZED PROMPT (Minimal Tokens) ---
    // We removed the glossary and just ask for raw transcription.
    const prompt = `
      You are an expert handwriting transcriber.

      TASK:
      1. Transcribe the handwriting accurately.
      2. Fix grammar and spelling errors.
      3. DO NOT expand abbreviations (e.g., keep "PCs" as "PCs").
      4. DO NOT add conversational filler.

      CRITICAL FORMATTING:
      - Preserve "-" or "(GA)" markers at start of lines.
      - Return text exactly as visually arranged.
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
    const rawText = response.text().trim();

    // --- Sticky Block Logic ---
    const rawLines = rawText.split(/\r?\n/);

    let formattedText = rawLines.reduce((acc, line) => {
      const cleanLine = line.trim();
      if (!cleanLine) return acc;

      const isMarker = cleanLine.startsWith("-") || 
                       cleanLine.toUpperCase().startsWith("(GA)");

      if (acc.length === 0) return cleanLine;

      if (isMarker) {
        return `${acc}\n\n${cleanLine}`;
      } else {
        return `${acc} ${cleanLine}`;
      }
    }, "");

    // --- 🟢 JS DOES THE WORK (Free) ---
    // Since AI didn't expand them, we do it here instantly.
    formattedText = expandAbbreviations(formattedText);

    return res.json({ 
      text: formattedText, 
      confidence: 0.95 
    });

  } catch (err) {
    console.error("Gemini OCR Error:", err);
    let errorMessage = "Failed to process image.";
    if (err.message && err.message.includes("SAFETY")) {
      errorMessage = "Gemini blocked this image due to safety filters.";
    }
    return res.status(500).json({ error: errorMessage, details: err.message });
  }
});

export default router;