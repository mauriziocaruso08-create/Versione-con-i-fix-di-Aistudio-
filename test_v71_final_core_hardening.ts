/**
 * V7.1 Final Core Hardening regression intent cases.
 * These are classification-level checks; storage/capability verification remains
 * part of the runtime AI Studio regression cycle.
 */
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

import { classifyIntent } from './src/services/router/semanticClassifier';
import { SessionContext } from './src/types/context';

const emptyContext = {} as SessionContext;

const factDelete = classifyIntent('Dimentica il mio colore preferito.', emptyContext);
assert(factDelete.entity === 'MEMORY' && factDelete.verb === 'DELETE', 'personal fact delete classification failed');
assert(factDelete.isLocalActionCandidate === true, 'personal fact delete must stay local');

const composedConfirmation = 'Sì, elimina.';
assert(/s[ìi]/i.test(composedConfirmation), 'confirmation fixture invalid');

const contextualNote = classifyIntent('Aggiungi anche il pane.', {
  ...emptyContext,
  activeEntity: 'NOTE',
  activeCollectionType: 'NOTE',
} as SessionContext);
assert(contextualNote.entity === 'NOTE' && contextualNote.verb === 'UPDATE', 'contextual note append classification failed');
assert(contextualNote.parameters.updateMode === 'APPEND', 'contextual note append mode failed');

const explicitNote = classifyIntent('Aggiungi comprare il pane alla nota Spesa2.', emptyContext);
assert(explicitNote.entity === 'NOTE' && explicitNote.verb === 'UPDATE', 'explicit note append classification failed');
assert(explicitNote.target.rawReference === 'Spesa2', 'explicit note title target failed');

const negative = classifyIntent('Non cancellare il promemoria di Luca.', emptyContext);
assert(negative.parameters.negated === true, 'negative intent flag failed');
assert(negative.entity === 'REMINDER' && negative.verb === 'DELETE', 'negative destructive intent classification failed');

const englishMemory = classifyIntent('Remember that I like cats.', emptyContext);
assert(englishMemory.entity === 'MEMORY' && englishMemory.verb === 'CREATE', 'English memory normalization failed');

console.log('PASS: V7.1 final core-hardening classification cases');
