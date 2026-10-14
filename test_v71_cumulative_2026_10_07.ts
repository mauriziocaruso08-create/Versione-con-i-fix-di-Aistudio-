function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }
import { classifyIntent } from './src/services/router/semanticClassifier';
const note = classifyIntent('Segnati una cosa: devo comprare il vino.');
assert(note.entity === 'NOTE' && note.verb === 'CREATE' && note.isLocalActionCandidate === true, 'natural note failed');
const reminder = classifyIntent('Mi devo ricordare di chiamare Luca domani alle 10.');
assert(reminder.entity === 'REMINDER' && reminder.verb === 'CREATE' && reminder.isLocalActionCandidate === true, 'natural reminder failed');
const memory = classifyIntent('Remember that I like cats.');
assert(memory.entity === 'MEMORY' && memory.verb === 'CREATE' && memory.isLocalActionCandidate === true, 'english memory failed');
const englishNote = classifyIntent('Create a note called Shopping with buy milk.');
assert(englishNote.entity === 'NOTE' && englishNote.verb === 'CREATE', 'english note failed');
const negative = classifyIntent('Non cancellare il promemoria di Luca.');
assert(negative.parameters.negated === true && negative.verb === 'DELETE' && negative.entity === 'REMINDER', 'negative failed');
console.log('PASS');
