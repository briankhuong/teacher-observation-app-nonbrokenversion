/**
 * src/utils/gemini.ts
 * Utility to interact with Google Gemini API.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// 🟢 CRITICAL FIX: Use 1.5-Flash. 
// 2.5-Flash-Lite is limited to 20/day. 1.5-Flash is 1,500/day.
const MODEL_NAME = "gemini-1.5-flash"; 

if (!API_KEY) {
  console.error("Missing VITE_GEMINI_API_KEY in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.2, // Low temp = strict adherence to rules
  }
});

// ==========================================
// 1. SINGLE ITEM POLISH
// ==========================================
export async function polishTextWithGemini(
  text: string,
  indicatorTitle?: string,
  indicatorDescription?: string
): Promise<string> {
  if (!text || text.trim().length === 0) return "";

  const systemInstruction = `
You are a professional pedagogical editor. 
Your ONLY task is to rewrite the user's raw notes to be professional, constructive, and grammatically correct (US English).

<reference_context>
  Indicator: ${indicatorTitle || "General"}
  Definition: ${indicatorDescription || ""}
  (INSTRUCTION: Ignore this text for output. Do NOT paraphrase this.)
</reference_context>

<user_raw_input>
  ${text}
</user_raw_input>

RULES:
1. Rewrite ONLY the content inside <user_raw_input>.
2. Do NOT use the <reference_context> to generate your answer. Only use it to understand what the user is talking about.
3. If <user_raw_input> is negative (e.g. "bad", "boring"), keep it critical but make the tone professional.
4. Output specific feedback based ONLY on the user's input.
`;

  try {
    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const polished = response.text();

    if (!polished) return text;
    
    // Clean up common AI prefixes
    let finalClean = polished.trim();
    finalClean = finalClean.replace(/^Here is.*?:\s*/i, "").replace(/^Revised.*?:\s*/i, "");

    return finalClean;

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    throw new Error("AI Service Busy. Please try again."); 
  }
}

// ==========================================
// 2. BATCH POLISH (1 Request = 18 Items)
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

  const cleanInput = items.map((i) => ({
    id: i.id,
    topic_reference: i.title, // Context only
    user_input_to_rewrite: i.text,   // The actual text to change
  }));

  const systemPrompt = `
You are a professional editor for teacher observations.
I will provide a JSON array. You must polish the "user_input_to_rewrite" field.

INPUT DATA:
${JSON.stringify(cleanInput, null, 2)}

INSTRUCTIONS:
1. Return ONLY valid JSON.
2. Keys = "id". Values = Polished version of "user_input_to_rewrite".
3. 🛑 CRITICAL: Do NOT use "topic_reference" in your output. That is just context.
4. Rewrite the user's text to be professional and constructive.

EXAMPLE:
Input: { "id": "1", "topic_reference": "Classroom Management", "user_input_to_rewrite": "kids running around" }
Output: { "1": "The teacher needs to establish better control over student movement in the classroom." }
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

    if (!rawText) throw new Error("Empty response");

    const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedJson);

  } catch (e) {
    console.error("Batch Polish Error:", e);
    throw new Error("Batch processing failed. Try individual items.");
  }
}