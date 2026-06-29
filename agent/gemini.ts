import { GoogleGenAI } from "@google/genai";

export type GeminiInteractionInput =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mime_type: string }
    >;

export interface GeminiTextRequest {
  apiKey: string;
  model: string;
  input: GeminiInteractionInput;
  systemInstruction?: string;
  temperature?: number;
  fallbackContents?: any;
}

function extractInteractionText(interaction: any): string {
  if (typeof interaction?.output_text === "string") return interaction.output_text;
  if (typeof interaction?.text === "string") return interaction.text;

  const outputs = interaction?.outputs || interaction?.steps || [];
  for (let i = outputs.length - 1; i >= 0; i--) {
    const output = outputs[i];
    if (typeof output?.text === "string") return output.text;
    if (typeof output?.content === "string") return output.content;
    if (Array.isArray(output?.parts)) {
      const text = output.parts
        .map((part: any) => part?.text || "")
        .filter(Boolean)
        .join("");
      if (text) return text;
    }
  }

  return "";
}

export async function generateGeminiText(request: GeminiTextRequest): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: request.apiKey });

  if ((ai as any).interactions?.create) {
    try {
      const interaction = await (ai as any).interactions.create({
        model: request.model,
        input: request.input,
        system_instruction: request.systemInstruction,
        generation_config: {
          temperature: request.temperature ?? 0.1,
        },
        store: false,
      });

      const text = extractInteractionText(interaction);
      if (text) return text;
    } catch (err: any) {
      console.warn("[Gemini] Interactions API failed, falling back to generateContent:", err.message);
    }
  }

  const response = await ai.models.generateContent({
    model: request.model,
    contents: request.fallbackContents ?? request.input,
    config: {
      systemInstruction: request.systemInstruction,
      temperature: request.temperature ?? 0.1,
    },
  });

  return response.text || "";
}
