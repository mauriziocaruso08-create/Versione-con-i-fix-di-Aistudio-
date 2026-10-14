import { AiProvider } from './aiProvider';

export interface ProviderRegistration {
  provider: AiProvider;
  /** Lower numbers are preferred in automatic mode. */
  priority: number;
}

export interface ProviderManagerStatus {
  registered: string[];
  configured: string[];
  automaticOrder: string[];
}

/**
 * MAIA Provider Manager.
 *
 * Keeps provider registration, availability and automatic priority outside the
 * MAIA Core. This is the first concrete layer toward a multi-provider router:
 * adding OpenAI/Claude/Mistral/local providers does not require Core changes.
 */
export class ProviderManager {
  private readonly registrations = new Map<string, ProviderRegistration>();

  register(provider: AiProvider, priority = 100): void {
    this.registrations.set(provider.id, { provider, priority });
  }

  unregister(providerId: string): boolean {
    return this.registrations.delete(providerId);
  }

  get(providerId: string): AiProvider | null {
    return this.registrations.get(providerId)?.provider ?? null;
  }

  list(): AiProvider[] {
    return [...this.registrations.values()]
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.provider);
  }

  configured(): AiProvider[] {
    return this.list().filter((provider) => provider.isConfigured());
  }

  selectAutomatic(allowedIds?: string[]): AiProvider {
    const allowed = allowedIds?.length ? new Set(allowedIds) : null;
    const candidate = this.list().find(
      (provider) => (!allowed || allowed.has(provider.id)) && provider.isConfigured()
    );

    if (!candidate) {
      throw new Error('Nessun provider AI reale configurato o consentito.');
    }

    return candidate;
  }

  getStatus(): ProviderManagerStatus {
    return {
      registered: this.list().map((provider) => provider.id),
      configured: this.configured().map((provider) => provider.id),
      automaticOrder: this.list().map((provider) => provider.id),
    };
  }
}
