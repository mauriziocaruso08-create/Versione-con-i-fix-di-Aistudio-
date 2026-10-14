import assert from 'node:assert/strict';
import { ProviderManager } from './src/services/ai/providerManager';
import type { AiGenerationRequest, AiGenerationResult, AiProvider } from './src/services/ai/aiProvider';

class FakeProvider implements AiProvider {
  constructor(
    public readonly id: string,
    public readonly displayName: string,
    private readonly configured: boolean,
  ) {}
  isConfigured(): boolean { return this.configured; }
  async generate(_request: AiGenerationRequest): Promise<AiGenerationResult> {
    return { text: this.id, providerId: this.id, modelId: `${this.id}-test` };
  }
}

const manager = new ProviderManager();
const unavailable = new FakeProvider('unavailable', 'Unavailable', false);
const secondary = new FakeProvider('secondary', 'Secondary', true);
const primary = new FakeProvider('primary', 'Primary', true);

manager.register(unavailable, 1);
manager.register(secondary, 20);
manager.register(primary, 10);

assert.deepEqual(manager.list().map((p) => p.id), ['unavailable', 'primary', 'secondary']);
assert.deepEqual(manager.configured().map((p) => p.id), ['primary', 'secondary']);
assert.equal(manager.selectAutomatic()?.id, 'primary');
assert.equal(manager.selectAutomatic(['secondary']).id, 'secondary');
assert.throws(() => manager.selectAutomatic(['unavailable']), /Nessun provider/);
assert.equal(manager.unregister('secondary'), true);
assert.equal(manager.get('secondary'), null);

console.log('Provider Manager tests: PASS');


import { AiBudgetManager } from './src/services/ai/aiBudgetManager';

const budget = new AiBudgetManager({
  globalDailyRequests: 2,
  providerDailyRequests: { primary: 1 },
});
assert.equal(budget.canConsume('primary'), true);
budget.consume('primary');
assert.equal(budget.canConsume('primary'), false);
assert.equal(budget.canConsume('secondary'), true);
budget.consume('secondary');
assert.equal(budget.canConsume('secondary'), false);
console.log('AI Budget Manager tests: PASS');
