import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// ---------------------------------------------------------
// 1. CONFIGURATION & ABBREVIATIONS
// ---------------------------------------------------------

const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;
const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

// Increase payload limit to handle Base64 images
router.use(express.json({ limit: "10mb" }));

router.post("/api/ocr-gemini", async (req, res) => {
  try {
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

    // --- The Prompt ---
    // We inject GLOSSARY_STRING here so the AI knows exactly what "PCs" means.
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

      const isMarker = cleanLine.startsWith("-") || 
                       cleanLine.toUpperCase().startsWith("(GA)");

      if (acc.length === 0) return cleanLine;

      if (isMarker) {
        return `${acc}\n\n${cleanLine}`;
      } else {
        return `${acc} ${cleanLine}`;
      }
    }, "");

    // ---------------------------------------------------------
    // 4. FAILSAFE EXPANSION
    // ---------------------------------------------------------
    // If the AI missed any (or if it outputted "PCs" specifically), 
    // this JS will catch it.
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