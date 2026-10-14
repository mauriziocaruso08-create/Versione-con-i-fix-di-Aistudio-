import assert from 'node:assert/strict';
import { analyzeIntent, getIntentDiagnostics } from './src/services/router/intentEngine';

const cases = [
  ['memorizza che devo comprare il pane', 'CREATE', 'NOTE'],
  ['metti un promemoria per domani', 'CREATE', 'REMINDER'],
  ['avvisami domani alle 9 di chiamare Marco', 'CREATE', 'REMINDER'],
  ['elimina la seconda nota', 'DELETE', 'NOTE'],
  ['spiegami perché il cielo è blu', 'EXPLAIN', 'UNKNOWN'],
  ['mostrami le mie note', 'READ', 'NOTE'],
] as const;

for (const [query, expectedVerb, expectedEntity] of cases) {
  const intent = analyzeIntent(query);
  assert.equal(intent.verb, expectedVerb, query);
  assert.equal(intent.entity, expectedEntity, query);
}

const diagnostics = getIntentDiagnostics('memorizza che devo comprare il pane');
assert.equal(diagnostics.verbCandidates[0]?.verb, 'CREATE');
assert.equal(diagnostics.entityCandidates[0]?.entity, 'NOTE');

console.log('Intent Engine tests passed.');
