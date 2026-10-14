function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
import { resolveTarget } from './src/services/router/targetResolver';
import { setSessionTtlMs } from './src/services/context/sessionContext';
import type { SemanticIntent, SessionContext } from './src/types/context';

const now = 1_000_000;
const baseContext = (): SessionContext => ({
  activeEntity: 'NOTE',
  activeCollectionType: 'NOTE',
  displayedItems: [
    { index: 1, id: 'n1', entity: 'NOTE', summary: 'pane' },
    { index: 2, id: 'n2', entity: 'NOTE', summary: 'latte' },
  ],
  selectedItem: { index: 2, id: 'n2', entity: 'NOTE', summary: 'latte' },
  recentReferences: [
    { id: 'n2', entity: 'NOTE', timestamp: now - 1000, verb: 'READ' },
    { id: 'n1', entity: 'NOTE', timestamp: now - 2000, verb: 'CREATE' },
  ],
  pendingAction: null,
  pendingClarification: null,
  currentTopic: 'notes',
  lastUserIntent: null,
  lastSuccessfulAction: null,
  lastActivityTimestamp: now,
  lastWebSearch: null,
});

const pronounIntent: SemanticIntent = {
  verb: 'UPDATE',
  entity: 'NOTE',
  target: { type: 'PRONOUN', rawReference: 'questa' },
  parameters: { newText: 'latte e pane' },
  confidence: 'HIGH',
  rawQuery: 'modifica questa',
  isLocalActionCandidate: true,
};

const result = resolveTarget(pronounIntent, baseContext(), {
  notes: [
    { id: 'n1', text: 'pane', createdAt: new Date(now - 3000).toISOString() },
    { id: 'n2', text: 'latte', createdAt: new Date(now - 2000).toISOString() },
  ],
  now,
});
assert(result.status === 'RESOLVED', 'selected pronoun should resolve');
assert(result.resolvedId === 'n2', 'selected pronoun should resolve to n2');
assert(result.source === 'SELECTED_ITEM', 'selected pronoun should use selected item source');

const staleContext = baseContext();
staleContext.selectedItem = { index: 2, id: 'deleted', entity: 'NOTE', summary: 'vecchia nota' };
const staleResult = resolveTarget(pronounIntent, staleContext, {
  notes: [
    { id: 'n1', text: 'pane', createdAt: new Date(now - 3000).toISOString() },
    { id: 'n2', text: 'latte', createdAt: new Date(now - 2000).toISOString() },
  ],
  now,
});
assert(staleResult.resolvedId !== 'deleted', 'stale selection must never resolve');

setSessionTtlMs(1000);
const ttlResult = resolveTarget(pronounIntent, { ...baseContext(), lastActivityTimestamp: now - 1001 }, {
  notes: [{ id: 'n2', text: 'latte', createdAt: new Date(now - 2000).toISOString() }],
  now,
});
assert(ttlResult.status === 'UNRESOLVED', 'custom session TTL must be respected');
setSessionTtlMs(5 * 60 * 1000);

console.log('Context continuity hardening tests passed.');
