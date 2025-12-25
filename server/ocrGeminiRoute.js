import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// ---------------------------------------------------------
// 1. CONFIGURATION & ABBREVIATIONS
// ---------------------------------------------------------

// Initialize Gemini
const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;
const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

// Increase payload limit to handle Base64 images
router.use(express.json({ limit: "10mb" }));

// Define the abbreviations map based on your requirements
// "GA" is intentionally excluded as requested.
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

/**
 * Helper function to find and replace abbreviations with full terms.
 * Uses word boundaries (\b) to ensure partial words aren't replaced.
 */
function expandAbbreviations(text) {
  if (!text) return "";
  
  // Create regex pattern from keys: /\b(PCs|PWCs|...)\b/g
  const pattern = new RegExp(`\\b(${Object.keys(ABBREVIATION_MAP).join('|')})\\b`, 'g');

  return text.replace(pattern, (matched) => {
    return ABBREVIATION_MAP[matched];
  });
}

// ---------------------------------------------------------
// 2. ROUTE HANDLER
// ---------------------------------------------------------

router.post("/api/ocr-gemini", async (req, res) => {
  try {
    // --- Safety Checks ---
    if (!GEN_AI_KEY) {
      console.error("❌ GOOGLE_GENERATIVE_AI_KEY is missing in server environment.");
      return res.status(500).json({ error: "Server missing Google API Key" });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // --- Prepare the Model ---
    // 🟢 KEEPING MODEL AS 2.5 FLASH AS REQUESTED
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // --- The Prompt ---
    const prompt = `
      You are an expert handwriting transcriber and strict grammar editor.
      
      TASK:
      1. Transcribe the handwriting accurately from the image.
      2. Fix grammar, spelling, and tense (e.g., "She speak" -> "She spoke").
      3. Expand shorthand (e.g., "tchr" -> "teacher").
      4. Keep the tone SIMPLE. Do not upgrade vocabulary.

      CRITICAL DATA INTEGRITY RULES:
      - PRESERVE MARKERS: You must NEVER remove or alter hyphens "-" at the start of lines or tags like "(GA)". 
      - PRESERVE VISUAL LINE BREAKS: Do not combine lines yourself. Return the text exactly as visually arranged on the page.
      
      OUTPUT:
      - Return ONLY the final text.
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

    // ---------------------------------------------------------
    // 3. "STICKY BLOCK" LOGIC (Formatting)
    // ---------------------------------------------------------
    const rawLines = rawText.split(/\r?\n/);

    let formattedText = rawLines.reduce((acc, line) => {
      const cleanLine = line.trim();
      if (!cleanLine) return acc;

      // Define Block Starters
      const isMarker = cleanLine.startsWith("-") || 
                       cleanLine.toUpperCase().startsWith("(GA)");

      if (acc.length === 0) {
        return cleanLine;
      }

      if (isMarker) {
        // FOUND A NEW MARKER: Force a new paragraph (Double Newline)
        return `${acc}\n\n${cleanLine}`;
      } else {
        // NO MARKER: Glue it to the previous block with a SPACE.
        return `${acc} ${cleanLine}`;
      }
    }, "");

    // ---------------------------------------------------------
    // 4. ABBREVIATION EXPANSION (Final Polish)
    // ---------------------------------------------------------
    // This runs AFTER the text structures are fixed, expanding keys like "PCs" to "Phonogram cards"
    formattedText = expandAbbreviations(formattedText);

    // --- Return JSON ---
    return res.json({ 
      text: formattedText, 
      confidence: 0.95 
    });

  } catch (err) {
    console.error("Gemini OCR Error:", err);
    
    let errorMessage = "Failed to process image with Gemini.";
    if (err.message && err.message.includes("SAFETY")) {
      errorMessage = "Gemini blocked this image due to safety filters.";
    }

    return res.status(500).json({ 
      error: errorMessage, 
      details: err.message 
    });
  }
});

export default router;