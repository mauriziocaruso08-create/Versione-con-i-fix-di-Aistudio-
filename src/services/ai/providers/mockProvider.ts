import { AiGenerationRequest, AiGenerationResult, AiProvider } from '../aiProvider';

/** Test-only provider. Never enabled by default in production. */
export class MockProvider implements AiProvider {
  readonly id = 'mock';
  readonly displayName = 'MAIA Mock Provider';

  isConfigured(): boolean {
    return true;
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
    return {
      text: `[MOCK] Ricevuto: ${lastUser?.content ?? 'nessun messaggio'}`,
      providerId: this.id,
      modelId: 'mock-v1',
    };
  }
}
