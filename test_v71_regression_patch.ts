import assert from 'node:assert/strict';
import { analyzeIntent } from './src/services/router/intentEngine';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { createInitialContext } from './src/services/context/sessionContext';

const ctx = createInitialContext();

const english = analyzeIntent('Which reminders do I have?', ctx);
assert.equal(english.verb, 'READ');
assert.equal(english.entity, 'REMINDER');

const naturalMove = classifyIntent('Spostami quello di comprare il pane a venerdì alle 20', ctx);
assert.equal(naturalMove.verb, 'UPDATE');
assert.equal(naturalMove.entity, 'REMINDER');
assert.equal(naturalMove.target.type, 'TEXT_MATCH');

const append = classifyIntent('Aggiungi alla nota anche comprare il pane', ctx);
assert.equal(append.verb, 'UPDATE');
assert.equal(append.entity, 'NOTE');
assert.equal(append.parameters.updateMode, 'APPEND');
assert.equal(append.parameters.newText, 'comprare il pane');

const explicit = classifyIntent('Modifica la nota Spesa e aggiungi "comprare il pane"', ctx);
assert.equal(explicit.verb, 'UPDATE');
assert.equal(explicit.entity, 'NOTE');
assert.equal(explicit.parameters.updateMode, 'APPEND');
assert.equal(explicit.target.type, 'TEXT_MATCH');
assert.equal(explicit.target.matchedText, 'Spesa');

console.log('V7.1 regression patch tests: PASS');
