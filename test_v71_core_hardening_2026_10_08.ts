/**
 * MAIA V7.1 Core Hardening 2026-10-08
 * Classification-level regression cases for bugs found during AI Studio torture testing.
 * Runtime/storage/UX verification remains part of the AI Studio manual cycle.
 */
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

import { classifyIntent } from './src/services/router/semanticClassifier';
import { SessionContext } from './src/types/context';

const emptyContext = {} as SessionContext;

const indirectMemory = classifyIntent('Cosa sai del mio colore preferito?', emptyContext);
assert(indirectMemory.entity === 'MEMORY' && indirectMemory.verb === 'READ', 'indirect personal-memory query must stay local');

const storedName = classifyIntent('Che nome hai memorizzato per me?', emptyContext);
assert(storedName.entity === 'MEMORY' && storedName.parameters.profileField === 'userName', 'stored-name query must resolve locally');

const englishName = classifyIntent('What is my name?', emptyContext);
assert(englishName.entity === 'MEMORY' && englishName.verb === 'READ', 'English profile read must stay local');

const englishReminder = classifyIntent('Remind me to call Luca tomorrow at 10', emptyContext);
assert(englishReminder.entity === 'REMINDER' && englishReminder.verb === 'CREATE', 'English reminder must stay local');
assert(Boolean(englishReminder.parameters.dueAt), 'English reminder date/time must be extracted');

const englishNote = classifyIntent('Create a note: buy milk', emptyContext);
assert(englishNote.entity === 'NOTE' && englishNote.verb === 'CREATE', 'English note creation must stay local');

const codeSwitchMemory = classifyIntent('Remember that my favorite color is red', emptyContext);
assert(codeSwitchMemory.entity === 'MEMORY' && codeSwitchMemory.parameters.subcategory === 'personal_facts', 'English code-switched personal fact must use personalFacts');

const spanishMemory = classifyIntent('Recuerda que mi color favorito es el verde', emptyContext);
assert(spanishMemory.entity === 'MEMORY' && spanishMemory.parameters.subcategory === 'personal_facts', 'Spanish code-switched personal fact must use personalFacts');

const negativeDelete = classifyIntent('Non cancellare il promemoria di Luca.', emptyContext);
assert(negativeDelete.parameters.negated === true, 'negative destructive intent must be flagged');
assert(negativeDelete.entity === 'REMINDER' && negativeDelete.verb === 'DELETE', 'negative destructive intent must remain local');

const negativeUpdate = classifyIntent('Non aggiungere il burro alla nota comprare il pane.', emptyContext);
assert(negativeUpdate.parameters.negated === true, 'negative update intent must be flagged');
assert(negativeUpdate.entity === 'NOTE' && negativeUpdate.verb === 'UPDATE', 'negative note update must remain local');

const missingNoteText = classifyIntent('Crea una nota', emptyContext);
assert(missingNoteText.entity === 'NOTE' && missingNoteText.verb === 'CREATE', 'missing note payload must still be recognized as note creation');
assert(!missingNoteText.parameters.text, 'missing note payload must not be fabricated');

const titledNote = classifyIntent('Crea una nota Spesa: comprare il latte', emptyContext);
assert(titledNote.entity === 'NOTE' && titledNote.verb === 'CREATE', 'titled note syntax must be recognized');
assert(titledNote.parameters.title === 'Spesa' && titledNote.parameters.text === 'comprare il latte', 'titled note title/content split failed');

const titledNoteInside = classifyIntent('Crea la nota Spesa e scrivi dentro comprare il latte', emptyContext);
assert(titledNoteInside.parameters.title === 'Spesa' && titledNoteInside.parameters.text === 'comprare il latte', 'note "scrivi dentro" parsing failed');

const appendByTitle = classifyIntent('Aggiungi alla nota Spesa il pane', emptyContext);
assert(appendByTitle.entity === 'NOTE' && appendByTitle.verb === 'UPDATE', 'note append-by-title must be recognized');
assert(appendByTitle.target.rawReference === 'Spesa' && appendByTitle.parameters.newText === 'il pane', 'note append target/payload split failed');
assert(appendByTitle.parameters.updateMode === 'APPEND', 'note append mode failed');

const invalidDate = classifyIntent('Ricordami di chiamare Marco il 31 febbraio 2027 alle 10', emptyContext);
assert(invalidDate.entity === 'REMINDER' && invalidDate.verb === 'CREATE', 'invalid-date reminder must remain a local reminder intent');
assert(invalidDate.parameters.invalidDate === true, 'invalid calendar date must be flagged');

const profileDelete = classifyIntent('Dimentica la mia città', emptyContext);
assert(profileDelete.entity === 'MEMORY' && profileDelete.verb === 'DELETE', 'profile-field deletion must stay local');
assert(profileDelete.parameters.profileField === 'userCity', 'city deletion must target userCity, not personalFacts');

const clearMemory = classifyIntent('Cancella tutta la mia memoria', emptyContext);
assert(clearMemory.entity === 'MEMORY' && clearMemory.verb === 'DELETE', 'clear-all-memory must target MEMORY');
assert(clearMemory.target.type === 'ALL', 'clear-all-memory must use ALL scope');

const selfCorrection = classifyIntent('Crea una nota, no aspetta, chi era Napoleone?', emptyContext);
assert(selfCorrection.verb === 'EXPLAIN' && selfCorrection.entity === 'UNKNOWN', 'self-correction must discard the superseded local action');

console.log('PASS: MAIA V7.1 Core Hardening 2026-10-08 classification cases');
