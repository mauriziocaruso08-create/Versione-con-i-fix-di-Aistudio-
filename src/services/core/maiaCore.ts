import { orchestrateUserInput, OrchestrationResult } from '../router/maiaOrchestrator';
import { Message, UserMemory, ToneSetting } from '../../types';

export interface MaiaConversationRequest {
  messages: Message[];
  tone: ToneSetting;
  memory: UserMemory;
}

export interface MaiaConversationResult {
  reply: string;
  providerId: string;
  modelId: string;
  modelRouter?: unknown;
}

/**
 * MAIA Core — single entry point for input processing.
 *
 * The Core decides whether an input is handled locally by MAIA's capability
 * pipeline or needs cognitive generation through the server-side Model Router.
 * UI components must not decide which AI provider to call.
 */
export class MaiaCore {
  async processInput(query: string): Promise<OrchestrationResult> {
    return orchestrateUserInput(query.trim());
  }

  async generateConversation(request: MaiaConversationRequest): Promise<MaiaConversationResult> {
    const maxRetries = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Linear backoff before retry (600ms, 1200ms)
          await new Promise((resolve) => setTimeout(resolve, attempt * 600));
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 25000) : null;

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
            tone: request.tone,
            memory: request.memory,
          }),
          signal: controller?.signal,
        });

        if (timeoutId) clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        const rawBody = await response.text();
        let data: any;
        if (contentType.includes('application/json')) {
          try {
            data = JSON.parse(rawBody);
          } catch {
            throw new Error('Il server ha restituito JSON non valido.');
          }
        } else {
          throw new Error(`Il server MAIA non ha restituito JSON (HTTP ${response.status}).`);
        }
        if (!response.ok || !data.success || data.error) {
          const error = new Error(data.error || 'Errore nella generazione della risposta AI.');
          Object.assign(error, { isQuota: Boolean(data.isQuota), modelRouter: data.modelRouter });
          throw error;
        }

        return {
          reply: data.reply,
          providerId: data.source || 'unknown',
          modelId: data.model || 'unknown',
          modelRouter: data.modelRouter,
        };
      } catch (err: any) {
        lastError = err;
        const isNetworkOrAbort =
          err?.name === 'TypeError' ||
          err?.name === 'AbortError' ||
          /failed to fetch|network|load failed|aborted/i.test(err?.message || '');

        // Do not retry on explicit business errors (like quota or invalid prompt)
        if (!isNetworkOrAbort || attempt === maxRetries) {
          break;
        }
      }
    }

    if (lastError?.name === 'AbortError') {
      throw new Error('La richiesta al server ha richiesto troppo tempo (timeout). Riprova tra poco.');
    }
    if (lastError?.name === 'TypeError' && /failed to fetch/i.test(lastError?.message || '')) {
      throw new Error('Impossibile comunicare con il server MAIA. Verifica la connessione di rete e riprova.');
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Errore nella generazione della risposta AI.'));
  }
}

export const maiaCore = new MaiaCore();
