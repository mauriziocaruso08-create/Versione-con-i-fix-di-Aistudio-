import { analyzeIntent } from './src/services/router/intentEngine';
import { resolveTarget } from './src/services/router/targetResolver';
import { createInitialContext } from './src/services/context/sessionContext';
import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { saveNotes, loadNotes } from './src/utils/notesManager';
import { saveReminders, loadReminders } from './src/utils/reminderManager';

const storage: Record<string, string> = {};
const mockStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const k in storage) delete storage[k]; },
};
(global as any).localStorage = mockStorage;
(global as any).window = { localStorage: mockStorage };

let passed = 0;
let total = 0;
function assert(ok: boolean, name: string, detail = '') {
  total++;
  if (ok) { passed++; console.log(`✓ ${name}`); }
  else console.error(`✗ ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function run() {
  const now = 1775000000000;
  mockStorage.clear();

  // Pure semantic classification: natural READ follow-up.
  let ctx = createInitialContext(now);
  ctx.activeEntity = 'NOTE';
  ctx.activeCollectionType = 'NOTE';
  ctx.selectedItem = { index: 1, id: 'n1', entity: 'NOTE', summary: 'spesa' };
  let intent = analyzeIntent('Fammi vedere quella', ctx);
  assert(intent.verb === 'READ' && intent.entity === 'NOTE' && intent.target.type === 'PRONOUN', 'READ pronoun follow-up classified locally');

  // End-to-end: list notes, then ask for the second one without repeating \"nota\".
  mockStorage.clear();
  saveNotes([
    { id: 'n1', text: 'pane', createdAt: new Date(now).toISOString() },
    { id: 'n2', text: 'latte', createdAt: new Date(now).toISOString() },
  ]);
  const list = await orchestrateUserInput('Mostrami le note', now);
  const second = await orchestrateUserInput('Fammi vedere la seconda', now + 1000);
  assert(list.type === 'HANDLED_LOCAL', 'Initial note list handled locally');
  assert(second.type === 'HANDLED_LOCAL' && second.dataAffected === false, 'Ordinal READ follow-up handled locally');
  assert(second.feedbackText?.includes('latte') === true, 'Ordinal READ follow-up resolves the requested item');

  // End-to-end pronoun update: no entity repetition.
  mockStorage.clear();
  saveNotes([{ id: 'n3', text: 'vecchia nota', createdAt: new Date(now).toISOString() }]);
  await orchestrateUserInput('Mostrami le note', now + 2000);
  const update = await orchestrateUserInput('Modifica questa e scrivi nuova nota', now + 3000);
  const notes = loadNotes();
  assert(update.type === 'HANDLED_LOCAL' && update.dataAffected === true, 'Pronoun UPDATE follow-up handled locally');
  assert(notes[0]?.text === 'nuova nota', 'Pronoun UPDATE changes the selected note only');

  // End-to-end reminder pronoun update.
  mockStorage.clear();
  saveReminders([{ id: 'r1', text: 'chiamare Luca', dueAt: new Date(now + 3600000).toISOString(), createdAt: new Date(now).toISOString(), completed: false, notified: false }]);
  await orchestrateUserInput('Mostrami i promemoria', now + 4000);
  const move = await orchestrateUserInput('Sposta quello a domani alle 10', now + 5000);
  const rems = loadReminders();
  assert(move.type === 'HANDLED_LOCAL' && move.dataAffected === true, 'Pronoun REMINDER UPDATE handled locally');
  assert(Boolean(rems[0]?.dueAt), 'Reminder keeps a valid dueAt after contextual update');

  console.log(`\nContextual follow-up regression: ${passed}/${total} passed`);
  if (passed !== total) process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
