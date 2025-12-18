/**
 * src/utils/gemini.ts
 * Utility to interact with Google Gemini API.
 * Includes "Single Polish" for individual edits and "Batch Polish" for the "Polish All" button.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ⚡ Switch to 1.5-Flash (Stable) for better limits than 2.0-Preview
const MODEL_NAME = "gemini-1.5-flash"; 

if (!API_KEY) {
  console.error("Missing VITE_GEMINI_API_KEY in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.3, // Low temp = more consistent, less creative
  }
});

// ==========================================
// 1. SINGLE ITEM POLISH
// Used when clicking the "✨ AI Polish" button on a specific indicator
// ==========================================
export async function polishTextWithGemini(
  text: string,
  indicatorTitle?: string,
  indicatorDescription?: string
): Promise<string> {
  if (!text) return "";

  // 🛡️ STRICT PROMPT: Uses XML tags to prevent context bleeding
  const systemInstruction = `
You are a professional pedagogical editor. 
Your task is to rewrite the text inside <user_input> to be professional, constructive, and grammatically correct (US English).

<context>
  Indicator: ${indicatorTitle || "General"}
  Definition: ${indicatorDescription || ""}
  (INSTRUCTION: Use this context ONLY to understand the topic. DO NOT paraphrase this definition.)
</context>

<user_input>
  ${text}
</user_input>

RULES:
1. Rewrite ONLY the content inside <user_input>.
2. If <user_input> is empty or meaningless, return it as is.
3. Maintain the original sentiment (if negative, make it constructive but keep the critique).
4. Do NOT start with "Here is the polished version". Just give the text.
`;

  try {
    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const polished = response.text();

    // Safety cleanup
    if (!polished) return text;
    
    // Strip common AI conversational prefixes
    let finalClean = polished.trim();
    finalClean = finalClean.replace(/^Here is (the )?polished.*?:\s*/i, "");
    finalClean = finalClean.replace(/^Option 1:?\s*/i, "");
    finalClean = finalClean.replace(/^Revised:?\s*/i, "");

    return finalClean;

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    // Graceful fallback: return original text if API fails
    throw new Error("AI busy. Please wait a moment."); 
  }
}


// ==========================================
// 2. BATCH POLISH (1 Request for ALL items)
// Used when clicking "✨ Polish All"
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

  // 1. Prepare data (Strip unnecessary fields to save tokens)
  const cleanInput = items.map((i) => ({
    id: i.id,
    context: i.title,
    note: i.text,
  }));

  // 2. Strict JSON Prompt
  const systemPrompt = `
You are a professional editor for teacher observation reports.
I will provide a JSON array of raw notes. 
Your task is to polish the "note" field for grammar and professional tone (US English).

INPUT DATA:
${JSON.stringify(cleanInput, null, 2)}

INSTRUCTIONS:
1. Return ONLY a valid JSON object.
2. Keys must match the "id" from input.
3. Values must be the polished version of the "note".
4. <IMPORTANT>: Do NOT use the "context" field as the output. Rewrite the "note" field only.
5. Maintain original sentiment (do not turn negatives into praise).

EXAMPLE OUTPUT:
{
  "ind-1": "The teacher managed the classroom effectively.",
  "ind-2": "The pacing of the lesson needs adjustment."
}
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

    // 3. Parse JSON
    // Sometimes AI adds Markdown code blocks even in JSON mode, so we strip them
    const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(cleanedJson);

  } catch (e) {
    console.error("Batch Polish Error:", e);
    // Handle the 429 specifically for user clarity
    if (String(e).includes("429")) {
      throw new Error("Quota exceeded. Please wait 60 seconds.");
    }
    throw new Error("Failed to process batch. Try polishing individual items.");
  }
}