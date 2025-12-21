// src/utils/gemini.ts
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true 
});

/**
 * Polish a single note using Groq (Stricter Version)
 * Focused on cleaning text while preserving specific markers.
 */
export async function polishTextWithGroq(text: string): Promise<string> {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a professional text processing engine. 
          TASK: Rewrite the provided teacher observation note for grammar and professional tone.
          
          STRICT RULES:
          1. Return ONLY the rewritten text. Do not include intros like "Here is the version" or suggestions.
          2. PRESERVE ALL MARKERS: Do not remove or change hyphens "-" or "(GA)" tags.
          3. DO NOT paraphrase the context of the indicator; focus ONLY on the teacher's input.
          4. Maintain professional educational terminology.`
        },
        {
          role: "user",
          content: text
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, // Low temperature ensures more literal/stable output
    });

    return chatCompletion.choices[0]?.message?.content?.trim() || text;
  } catch (error) {
    console.error("Groq Polish Error:", error);
    throw error;
  }
}

/**
 * 🟢 Batch Polish with Groq (True JSON Mode)
 * Processes multiple indicators in one single request.
 */
export async function polishBatchWithGroq(items: { id: string; text: string }[]) {
  const systemPrompt = `You are a professional text processing engine. 
  TASK: Rewrite teacher observation notes for professional tone and grammar.
  
  STRICT MACHINE RULES:
  1. Return ONLY a valid JSON object. 
  2. NO Conversational filler (e.g., "Here is your polish...").
  3. PRESERVE HYPHENS: Do not remove or trim leading or trailing hyphens "-".
  4. PRESERVE TAGS: Do not remove "(GA)" tags.
  5. If a note is too short to polish, return it as is but maintain markers.
  
  JSON OUTPUT FORMAT: { "indicator_id": "polished text string" }`;

  const userPrompt = `Data to process: ${JSON.stringify(items)}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }, 
      temperature: 0.1, 
    });

    const content = response.choices[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : {};
    
    // Safety check: ensure we didn't get a nested "results" object
    return parsed;
  } catch (error) {
    console.error("Groq Batch Error:", error);
    throw error;
  }
}