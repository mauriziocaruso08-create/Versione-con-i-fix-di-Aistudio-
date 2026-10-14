import assert from 'node:assert/strict';
import { classifyIntent } from './src/services/router/semanticClassifier';
import type { SessionContext } from './src/types/context';

const reminderContext = {
  activeEntity: 'REMINDER',
  activeCollectionType: 'REMINDER',
  lastSuccessfulAction: { entity: 'REMINDER', verb: 'READ' },
} as SessionContext;

const followUpMemory = classifyIntent('E qual è il mio animale preferito?', undefined);
assert.equal(followUpMemory.entity, 'MEMORY');
assert.equal(followUpMemory.verb, 'READ');
assert.equal(followUpMemory.parameters.personalFactQuery, 'animale preferito');

const reminderQuestion = classifyIntent('A che ora devo pagare la bolletta?', reminderContext);
assert.equal(reminderQuestion.entity, 'REMINDER');
assert.equal(reminderQuestion.verb, 'READ');
assert.equal(reminderQuestion.parameters.reminderField, 'dueAt');
assert.equal(reminderQuestion.parameters.reminderQuery, 'pagare la bolletta');

const namedNote = classifyIntent(
  'Crea una nota chiamata Spesa con scritto comprare il latte.'
);
assert.equal(namedNote.entity, 'NOTE');
assert.equal(namedNote.verb, 'CREATE');
assert.equal(namedNote.parameters.title, 'Spesa');
assert.equal(namedNote.parameters.text, 'comprare il latte');

console.log('Context/Intent hardening tests passed.');
