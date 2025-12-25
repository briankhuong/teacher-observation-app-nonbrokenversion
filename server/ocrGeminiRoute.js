import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// Initialize Gemini
const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;
const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

// Increase payload limit to handle Base64 images
router.use(express.json({ limit: "10mb" }));

router.post("/api/ocr-gemini", async (req, res) => {
  try {
    // 1. Safety Checks
    if (!GEN_AI_KEY) {
      console.error("❌ GOOGLE_GENERATIVE_AI_KEY is missing in server environment.");
      return res.status(500).json({ error: "Server missing Google API Key" });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // 2. Prepare the Model
    // 🟢 KEEPING MODEL AS 2.5 FLASH AS REQUESTED
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. The Prompt
    // We strictly instruct Gemini to PRESERVE the raw line breaks from the image.
    // We also include the "Minimalist Fixer" rules to correct grammar without changing style.
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

    // 4. Send to Gemini
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
    // 5. "STICKY BLOCK" LOGIC
    // ---------------------------------------------------------
    // We split by newline to get the raw visual lines from Gemini.
    const rawLines = rawText.split(/\r?\n/);

    const formattedText = rawLines.reduce((acc, line) => {
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
        // This ensures sentences like "For example..." stay inside the current block.
        return `${acc} ${cleanLine}`;
      }
    }, "");

    // 6. Return JSON
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