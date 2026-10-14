/**
 * MAIA AI Provider contract.
 * Providers are replaceable components; MAIA identity/core must not depend on one vendor.
 */
export interface AiMessage {
  role: 'user' | 'model';
  content: string;
}

export interface AiGenerationRequest {
  messages: AiMessage[];
  systemInstruction?: string;
  temperature?: number;
}

export interface AiGenerationResult {
  text: string;
  providerId: string;
  modelId: string;
}

export interface AiProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
}
