import { GoogleGenAI } from '@google/genai';
import { AiGenerationRequest, AiGenerationResult, AiProvider } from '../aiProvider';

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  readonly displayName = 'Google Gemini';

  private readonly apiKey: string | undefined;
  private readonly models: string[];

  constructor(options?: { apiKey?: string; models?: string[] }) {
    const configured = options?.apiKey ?? process.env.GEMINI_API_KEY;
    this.apiKey = configured && configured !== 'MY_GEMINI_API_KEY' ? configured : undefined;
    this.models = options?.models?.length
      ? options.models
      : ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY non configurata.');
    }

    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const lastError: { value?: unknown } = {};

    for (const modelId of this.models) {
      try {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: request.messages.map((message) => ({
            role: message.role,
            parts: [{ text: message.content }],
          })),
          config: {
            systemInstruction: request.systemInstruction,
            temperature: request.temperature ?? 0.7,
          },
        });

        const text = response.text?.trim();
        if (text) {
          return { text, providerId: this.id, modelId };
        }
      } catch (error) {
        lastError.value = error;
        console.warn(`Gemini model ${modelId} non riuscito:`, error);
      }
    }

    const message = lastError.value instanceof Error
      ? lastError.value.message
      : String(lastError.value ?? 'errore sconosciuto');
    throw new Error(`Gemini: ${message}`);
  }
}
