/**
 * src/utils/gemini.ts
 * Utility to interact with Google Gemini API.
 * Uses gemini-1.5-flash-001 (Stable) for high rate limits on the free tier.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// 🟢 STABLE MODEL: High limits (1,500/day), fast, and cheap.
// We use the specific version "-001" to avoid "Model not found" errors.
const MODEL_NAME = "gemini-1.5-flash-001"; 

if (!API_KEY) {
  console.error("Missing VITE_GEMINI_API_KEY in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.3, // Keep it slightly creative but grounded
  }
});

// ==========================================
// 1. SINGLE ITEM POLISH
// ==========================================
export async function polishTextWithGemini(
  text: string,
  // We keep these arguments to avoid breaking your component code,
  // BUT we will NOT use them in the prompt to prevent confusion.
  _unusedTitle?: string,
  _unusedDescription?: string
): Promise<string> {
  if (!text || text.trim().length === 0) return "";

  // 🛡️ SIMPLIFIED PROMPT: Focus ONLY on the user's text.
  // We do not send the indicator description, so the AI cannot accidentally paraphrase it.
  const systemInstruction = `
You are a professional copy editor for teacher observation reports.
Your task is to polish the draft text below to be professional, grammatically correct, and constructive (US English).

INPUT TEXT:
"${text}"

RULES:
1. Fix grammar, spelling, and professional tone.
2. Maintain the original sentiment (do not change "bad" to "good", just make it professional).
3. Do not add any conversational filler like "Here is the rewritten text".
4. Return ONLY the polished string.
`;

  try {
    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const polished = response.text();

    if (!polished) return text;
    
    // Clean up common AI prefixes just in case
    let finalClean = polished.trim();
    finalClean = finalClean.replace(/^Here is.*?:\s*/i, "").replace(/^Revised.*?:\s*/i, "");
    // Remove quotes if the AI added them around the whole string
    finalClean = finalClean.replace(/^"(.*)"$/, "$1");

    return finalClean;

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    throw new Error("AI Service Busy. Please try again."); 
  }
}


// ==========================================
// 2. BATCH POLISH (1 Request for ALL items)
// ==========================================

interface BatchItem {
  id: string;
  title: string;
  text: string;
}

export async function polishBatchWithGemini(
  items: BatchItem[]
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  // 1. Prepare data 
  // We ONLY send the ID and the TEXT. We strip the title/context completely.
  const cleanInput = items.map((i) => ({
    id: i.id,
    draft_text: i.text, 
  }));

  // 2. Strict JSON Prompt
  const systemPrompt = `
You are a professional editor. I will provide a JSON array of raw draft notes.
Your task is to polish the "draft_text" field for professional tone (US English).

INPUT DATA:
${JSON.stringify(cleanInput, null, 2)}

INSTRUCTIONS:
1. Return ONLY valid JSON.
2. The output keys must match the "id" from the input.
3. The output values must be the polished version of "draft_text".
4. Do not paraphrase. Just fix grammar and tone.

EXAMPLE:
Input: [{"id":"1", "draft_text":"kids noisy"}]
Output: {"1": "The students were noisy and required redirection."}
`;

  try {
    // Force JSON mode for reliability
    const jsonModel = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json" } 
    });

    const result = await jsonModel.generateContent(systemPrompt);
    const response = await result.response;
    const rawText = response.text();

    if (!rawText) throw new Error("Empty response from AI");

    const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedJson);

  } catch (e) {
    console.error("Batch Polish Error:", e);
    throw new Error("Batch processing failed. Try individual items.");
  }
}