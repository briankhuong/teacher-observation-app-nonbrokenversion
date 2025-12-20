/**
 * src/utils/gemini.ts
 * Utility to interact with Google Gemini (Gemini Developer API) via the GA Google GenAI SDK.
 */

import { GoogleGenAI } from "@google/genai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

if (!API_KEY) {
  console.error("Missing VITE_GEMINI_API_KEY in environment variables.");
}

// Pick a CURRENT stable model.
// - gemini-2.5-flash: great quality/speed for text polishing
// - gemini-2.5-flash-lite: fastest/cheapest for high throughput
const MODEL_NAME = "gemini-2.5-flash"; // or "gemini-2.5-flash-lite"

const ai = new GoogleGenAI({ apiKey: API_KEY ?? "" });

// ==========================================
// 1. SINGLE ITEM POLISH
// ==========================================
export async function polishTextWithGemini(
  text: string,
  _unusedTitle?: string,
  _unusedDescription?: string
): Promise<string> {
  const draft = (text ?? "").trim();
  if (!draft) return "";

  const systemInstruction = `
 You are a professional copy editor for teacher observation reports.
 Polish the user's draft to be professional, grammatically correct, and constructive (US English).
 
 Rules:
 1) Fix grammar, spelling, clarity, and professional tone.
 2) Preserve the original meaning and sentiment (do not change negative to positive).
 3) Crucially, **DO NOT remove or alter any special markers like hyphens (-) or "(GA)" at the beginning of a line.** These are important identifiers.
 4) Do not add filler like "Here is the rewritten text".
 5) Return ONLY the polished text (no quotes, no markdown).
 `.trim();

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: draft, // user content stays here
      config: {
        systemInstruction, // system behavior goes here
        temperature: 0.3,
      },
    });

    const polished = (response.text ?? "").trim();
    if (!polished) return draft;

    // (Optional) extra cleanup in case the model still adds a label
    return polished
      .replace(/^Here is.*?:\s*/i, "")
      .replace(/^Revised.*?:\s*/i, "")
      .replace(/^"(.*)"$/, "$1")
      .trim();

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    // keep your UX-friendly error
    throw new Error("AI Service Busy. Please try again.");
  }
}

// ==========================================
// 2. BATCH POLISH
// ==========================================

interface BatchItem {
  id: string;
  title: string;
  text: string;
}

export async function polishBatchWithGemini(
  items: BatchItem[]
): Promise<Record<string, string>> {
  if (!items || items.length === 0) return {};

  const cleanInput = items.map((i) => ({
    id: i.id,
    draft_text: (i.text ?? "").trim(),
  }));

  const systemInstruction = `
 You are a professional editor. You will receive a JSON array of objects.
 Polish each object's "draft_text" for professional tone (US English) while preserving meaning.
 
 Crucially, **DO NOT remove or alter any special markers like hyphens (-) or "(GA)" at the beginning of a line.** These are important identifiers.
 
 Return ONLY valid JSON:
 - keys: must match each input "id"
 - values: polished "draft_text"
 No markdown fences.
 `.trim();

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: JSON.stringify(cleanInput),
      config: {
        systemInstruction,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    const raw = (response.text ?? "").trim();
    if (!raw) throw new Error("Empty response from AI");

    // Defensive cleanup (some gateways/models may still wrap output)
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();

    return JSON.parse(cleaned) as Record<string, string>;

  } catch (e) {
    console.error("Batch Polish Error:", e);
    throw new Error("Batch processing failed. Try individual items.");
  }
}
