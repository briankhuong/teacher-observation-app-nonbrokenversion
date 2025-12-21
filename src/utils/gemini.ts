import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true // @cite: 3.2
});

/**
 * Polish a single note using Groq
 */
// src/utils/gemini.ts

export async function polishTextWithGroq(text: string, title?: string, description?: string): Promise<string> {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a professional educational consultant. Polish the teacher's observation note. 
          Context: This note is for the indicator "${title || 'General'}". 
          Indicator Goal: ${description || 'N/A'}. 
          Keep the polish concise, professional, and do not change the core meaning.`
        },
        {
          role: "user",
          content: text
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
    });

    return chatCompletion.choices[0]?.message?.content || text;
  } catch (error) {
    console.error("Groq Polish Error:", error);
    throw error;
  }
}

/**
 * 🟢 Batch Polish with Groq (Llama 3.3 70B)
 * Processes all indicators in one request using JSON Mode
 */
export async function polishBatchWithGroq(items: { id: string; title: string; text: string }[]) {
  // @cite: 2.1, 2.2
  const systemPrompt = `You are a professional educational consultant. 
  Polish the following teacher observation notes for grammar and professional tone.
  Return ONLY a valid JSON object where keys are the IDs and values are the polished text.
  JSON format: { "id": "polished text" }`;

  const userPrompt = `Notes to polish: ${JSON.stringify(items)}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama-3.3-70b-versatile", // @cite: 2.2
      response_format: { type: "json_object" }, // @cite: 1.2, 4.3
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    return content ? JSON.parse(content) : {};
  } catch (error) {
    console.error("Groq Batch Error:", error);
    throw error;
  }
}