export interface AiBudgetPolicy {
  /** 0 means unlimited. */
  globalDailyRequests?: number;
  /** Per-provider daily limits. Missing/0 means unlimited. */
  providerDailyRequests?: Record<string, number>;
}

export interface AiBudgetStatus {
  dayKey: string;
  totalRequests: number;
  globalDailyLimit: number;
  providerRequests: Record<string, number>;
  providerDailyLimits: Record<string, number>;
}

/**
 * Deterministic, provider-agnostic request budget guard.
 * It intentionally tracks request counts rather than token/currency estimates:
 * providers expose different accounting models and this layer must not invent
 * costs. Real token/cost accounting can be added later per provider.
 */
export class AiBudgetManager {
  private readonly globalDailyLimit: number;
  private readonly providerDailyLimits: Record<string, number>;
  private dayKey: string;
  private totalRequests = 0;
  private providerRequests = new Map<string, number>();

  constructor(policy: AiBudgetPolicy = {}, now: () => Date = () => new Date()) {
    this.globalDailyLimit = Math.max(0, Math.floor(policy.globalDailyRequests ?? 0));
    this.providerDailyLimits = Object.fromEntries(
      Object.entries(policy.providerDailyRequests ?? {}).map(([id, limit]) => [
        id,
        Math.max(0, Math.floor(limit)),
      ])
    );
    this.dayKey = this.getDayKey(now());
    this.now = now;
  }

  private readonly now: () => Date;

  private getDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private resetIfNewDay(): void {
    const currentDay = this.getDayKey(this.now());
    if (currentDay !== this.dayKey) {
      this.dayKey = currentDay;
      this.totalRequests = 0;
      this.providerRequests.clear();
    }
  }

  getProviderLimit(providerId: string): number {
    return this.providerDailyLimits[providerId] ?? 0;
  }

  canConsume(providerId: string): boolean {
    this.resetIfNewDay();
    const providerLimit = this.getProviderLimit(providerId);
    const providerCount = this.providerRequests.get(providerId) ?? 0;

    if (this.globalDailyLimit > 0 && this.totalRequests >= this.globalDailyLimit) return false;
    if (providerLimit > 0 && providerCount >= providerLimit) return false;
    return true;
  }

  consume(providerId: string): void {
    this.resetIfNewDay();
    if (!this.canConsume(providerId)) {
      throw new Error(`Limite AI giornaliera raggiunta per ${providerId}.`);
    }
    this.totalRequests += 1;
    this.providerRequests.set(providerId, (this.providerRequests.get(providerId) ?? 0) + 1);
  }

  getStatus(): AiBudgetStatus {
    this.resetIfNewDay();
    return {
      dayKey: this.dayKey,
      totalRequests: this.totalRequests,
      globalDailyLimit: this.globalDailyLimit,
      providerRequests: Object.fromEntries(this.providerRequests),
      providerDailyLimits: { ...this.providerDailyLimits },
    };
  }
}
