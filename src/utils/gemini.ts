/**
 * Utility to interact with Google Gemini API (Flash-Lite model)
 * Used for polishing observation notes.
 */

// 🟢 SINGLE ITEM POLISH
export async function polishTextWithGemini(
  text: string,
  indicatorTitle?: string,
  indicatorDescription?: string
): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY in environment variables.");
  }

  // 🟢 STRICT PROMPT LOGIC
  const systemInstruction = `
You are a professional editor for teacher observation notes.
Your goal is to improve grammar, clarity, and tone (making it professional and constructive), BUT you must remain faithful to the original meaning.

CONTEXT:
- Indicator: "${indicatorTitle || "General"}"
- Definition: "${indicatorDescription || ""}"

INPUT TEXT:
"${text}"

STRICT RULES:
1. **Maintain Original Sentiment:** If the input is negative (e.g., "teacher is bad", "failed to do X"), the output MUST remain critical/constructive. Do NOT turn it into praise.
2. **No Hallucinations:** Do not invent specific actions (like "using the Pointer" or "resolving tech issues") unless the INPUT TEXT explicitly mentions them.
3. **Professional Tone:** If the input is vague/harsh (e.g., "bad"), rewrite it as professional feedback (e.g., "The teacher struggled with this aspect" or "Performance in this area requires improvement").
4. **Length:** Keep the output length relatively similar to the input length. Do not write a long paragraph for a 3-word input.

Example 1 (Negative Input):
Input: "teacher is bad" (Context: Tech Issues)
Output: "The teacher struggled to manage technical issues effectively." (CORRECT)
Bad Output: "The teacher proactively resolved all technical issues." (INCORRECT - changes meaning)

Example 2 (Positive Input):
Input: "good job with kids"
Output: "The teacher demonstrated strong rapport with the students."
`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemInstruction }],
      },
    ],
    generationConfig: {
      temperature: 0.3, // 🟢 Lower temperature = Less creativity/hallucination
      maxOutputTokens: 200,
    },
  };

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini API Error: ${response.status} ${errData?.error?.message || ""}`
    );
  }

  const data = await response.json();
  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

  return result ? result.trim() : text;
}


// ------------------------------------------------------------------

interface BatchItem {
  id: string;
  title: string; // Context
  text: string;  // The user's rough notes
}

// 🟢 BATCH POLISH (Multiple items in one call)
export async function polishBatchWithGemini(
  items: BatchItem[]
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY");
  }

  // 🟢 STRICT BATCH PROMPT
  const systemPrompt = `
You are a professional editor for GrapeSEED teacher observations. 
I will provide a JSON array of notes. Your task is to polish the "text" field of each item.

RULES:
1. Return ONLY a valid JSON object where keys are the IDs and values are the polished text.
2. **Maintain Sentiment:** Do NOT turn negative notes into positive praise. If a note says "bad", keep it critical (e.g., "needs improvement").
3. **No Hallucinations:** Do not add specific details (like specific props or actions) unless they are in the input.
4. **Tone:** Professional, objective, and constructive.

Input Format:
[
  { "id": "1", "text": "teacher is bad", "context": "Tech Issues" },
  { "id": "2", "text": "good energy", "context": "Engagement" }
]

Output Format (Strict JSON):
{
  "1": "The teacher struggled to handle technical issues effectively.",
  "2": "The teacher displayed high energy and engagement."
}
`;

  // We send ID, Text, AND Title (Context) to help the AI understand what "bad" applies to
  const cleanInput = items.map((i) => ({
    id: i.id,
    text: i.text,
    context: i.title,
  }));

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              systemPrompt + "\n\nInput Data:\n" + JSON.stringify(cleanInput),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2, // 🟢 Very low temperature for consistent JSON
      responseMimeType: "application/json",
    },
  };

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Batch Polish Failed: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) throw new Error("Empty response from AI");

  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.error("Failed to parse AI JSON", rawText);
    throw new Error("AI returned invalid JSON format.");
  }
}