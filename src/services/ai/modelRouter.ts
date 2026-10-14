import { AiGenerationRequest, AiGenerationResult, AiProvider } from './aiProvider';
import { ProviderManager } from './providerManager';
import { GeminiProvider } from './providers/geminiProvider';
import { MockProvider } from './providers/mockProvider';
import { AiBudgetManager } from './aiBudgetManager';

export type AiRoutingMode = 'automatic' | 'gemini' | 'mock';

export interface ModelRouterStatus {
  mode: AiRoutingMode;
  selectedProvider: string;
  providerDisplayName: string;
  configured: boolean;
  providerManager: ReturnType<ProviderManager['getStatus']>;
  budget: ReturnType<AiBudgetManager['getStatus']>;
}

/**
 * MAIA Model Router.
 * Provider selection is delegated to ProviderManager so vendor-specific logic
 * stays outside MAIA Core and the UI.
 */
export class ModelRouter {
  private readonly providerManager: ProviderManager;
  private readonly mode: AiRoutingMode;
  private readonly allowedProviders: string[];
  private readonly budget: AiBudgetManager;

  constructor(options?: {
    mode?: AiRoutingMode;
    providers?: AiProvider[];
    priorities?: Record<string, number>;
    allowedProviders?: string[];
    budget?: AiBudgetManager;
  }) {
    this.mode = options?.mode ?? 'automatic';
    this.providerManager = new ProviderManager();
    const providers = options?.providers ?? [new GeminiProvider(), new MockProvider()];
    const priorities = options?.priorities ?? { gemini: 10, mock: 1000 };

    providers.forEach((provider) => {
      this.providerManager.register(provider, priorities[provider.id] ?? 100);
    });

    this.allowedProviders = options?.allowedProviders ?? [];
    this.budget = options?.budget ?? new AiBudgetManager();
  }

  private selectProvider(): AiProvider {
    return this.selectProviderCandidates()[0];
  }

  private selectProviderCandidates(): AiProvider[] {
    if (this.mode === 'gemini') {
      const provider = this.providerManager.get('gemini');
      if (!provider) throw new Error('Provider Gemini non registrato.');
      return [provider];
    }
    if (this.mode === 'mock') {
      const provider = this.providerManager.get('mock');
      if (!provider) throw new Error('Mock provider non registrato.');
      return [provider];
    }
    const allowed = this.allowedProviders.filter((id) => id !== 'mock');
    const providers = this.providerManager.list().filter((provider) =>
      (!allowed.length || allowed.includes(provider.id)) && provider.isConfigured()
    );
    if (!providers.length) throw new Error('Nessun provider AI reale configurato o consentito.');
    return providers;
  }

  getStatus(): ModelRouterStatus {
    const managerStatus = this.providerManager.getStatus();
    try {
      const provider = this.selectProvider();
      return {
        mode: this.mode,
        selectedProvider: provider.id,
        providerDisplayName: provider.displayName,
        configured: provider.isConfigured(),
        providerManager: managerStatus,
        budget: this.budget.getStatus(),
      };
    } catch {
      return {
        mode: this.mode,
        selectedProvider: 'none',
        providerDisplayName: 'Nessun provider disponibile',
        configured: false,
        providerManager: managerStatus,
        budget: this.budget.getStatus(),
      };
    }
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const candidates = this.selectProviderCandidates();
    let lastError: unknown = null;
    for (const provider of candidates) {
      if (!this.budget.canConsume(provider.id)) {
        lastError = Object.assign(new Error(`Limite AI giornaliera raggiunta per ${provider.id}.`), { isQuota: true, providerId: provider.id });
        continue;
      }
      try {
        const result = await provider.generate(request);
        this.budget.consume(provider.id);
        return result;
      } catch (error) {
        lastError = error;
        if (this.mode !== 'automatic') throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Nessun provider AI disponibile per completare la richiesta.');
  }
}

const globalDailyRequests = Number(process.env.MAIA_AI_MAX_REQUESTS_PER_DAY ?? 0);
const providerDailyRequests: Record<string, number> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('MAIA_AI_MAX_REQUESTS_') || !key.endsWith('_PER_DAY') || key === 'MAIA_AI_MAX_REQUESTS_PER_DAY') continue;
  const providerId = key.slice('MAIA_AI_MAX_REQUESTS_'.length, -'_PER_DAY'.length).toLowerCase();
  const limit = Number(value);
  if (Number.isFinite(limit) && limit >= 0) providerDailyRequests[providerId] = limit;
}

const allowedProviders = (process.env.MAIA_AI_ALLOWED_PROVIDERS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export const modelRouter = new ModelRouter({
  mode:
    process.env.MAIA_AI_MODE === 'mock'
      ? 'mock'
      : process.env.MAIA_AI_MODE === 'gemini'
        ? 'gemini'
        : 'automatic',
  allowedProviders,
  budget: new AiBudgetManager({ globalDailyRequests, providerDailyRequests }),
});
