import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------

const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;
const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

// Increase limit to 10mb
router.use(express.json({ limit: "10mb" }));

// ---------------------------------------------------------
// 2. ROUTE HANDLERS
// ---------------------------------------------------------

// Warm-up route
router.head("/api/ocr-gemini", (req, res) => {
  res.status(200).end();
});

router.post("/api/ocr-gemini", async (req, res) => {
  try {
    // --- A. Define Glossary INSIDE the route to prevent scope errors ---
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
      "MPC": "Multi-letter phonogram"
    };

    const GLOSSARY_STRING = Object.entries(ABBREVIATION_MAP)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");

    // --- B. Helper Function INSIDE the route ---
    const expandAbbreviations = (text) => {
      if (!text) return "";
      const pattern = new RegExp(`\\b(${Object.keys(ABBREVIATION_MAP).join('|')})\\b`, 'g');
      return text.replace(pattern, (matched) => ABBREVIATION_MAP[matched]);
    };

    // --- C. Safety Checks ---
    if (!GEN_AI_KEY) {
      console.error("❌ GOOGLE_GENERATIVE_AI_KEY is missing.");
      return res.status(500).json({ error: "Server missing Google API Key" });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // --- D. Prepare Model ---
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Updated to 2.0 Flash for speed

    // --- E. The Prompt ---
    const prompt = `
      You are an expert handwriting transcriber and strict grammar editor.

      REFERENCE GLOSSARY (Use these exact definitions):
      ${GLOSSARY_STRING}

      TASK:
      1. Transcribe the handwriting accurately from the image.
      2. Fix grammar and spelling.
      3. EXPAND ABBREVIATIONS: If you see an acronym from the Glossary above, replace it with the full term (e.g., change "PCs" to "Phonogram cards"). Do NOT guess other meanings like "Prior Concepts".
      4. Keep the tone SIMPLE.

      CRITICAL FORMATTING RULES:
      - PRESERVE MARKERS: Never remove hyphens "-" or "(GA)" at the start of lines.
      - PRESERVE LINE BREAKS: Return text exactly as visually arranged. Do not combine lines.

      OUTPUT:
      - Return ONLY the final text.
    `;

    // --- F. Send to Gemini ---
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

    // --- G. Formatting Logic ---
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

    // --- H. Failsafe Expansion ---
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