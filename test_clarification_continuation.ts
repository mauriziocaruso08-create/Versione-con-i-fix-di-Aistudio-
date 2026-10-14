import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { getContext, resetContext } from './src/services/context/sessionContext';
import { saveNotes, loadNotes } from './src/utils/notesManager';
import { saveReminders, loadReminders } from './src/utils/reminderManager';

// Mock localStorage for node environment
const storage: Record<string, string> = {};
const mockStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const k in storage) delete storage[k]; },
};
(global as any).localStorage = mockStorage;
(global as any).window = {
  localStorage: mockStorage,
};

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✓ [PASS] ${testName}`);
  } else {
    console.error(`✗ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function runTests() {
  console.log('=== RUNNING PENDING CLARIFICATION CONTINUATION TESTS ===\n');

  const now = 1775000000000;

  // =========================================================================
  // TEST 1: UPDATE + multiple candidates + "2"
  // =========================================================================
  console.log('-- Test 1: UPDATE + multiple candidates + "2" --');
  resetContext(now);
  saveNotes([
    { id: 'note-1', text: 'pane integrale', createdAt: new Date(now).toISOString() },
    { id: 'note-2', text: 'pane carasau', createdAt: new Date(now).toISOString() },
  ]);

  const u1_step1 = await orchestrateUserInput('Modifica la nota del pane e scrivi test selezione', now);
  assert(
    u1_step1.type === 'HANDLED_LOCAL' &&
    u1_step1.feedbackText?.includes('più note') === true,
    'UPDATE Step 1: Multiple candidates triggers clarification',
    JSON.stringify(u1_step1)
  );

  const ctx1 = getContext(now);
  assert(
    ctx1.pendingClarification !== null &&
    ctx1.pendingClarification.candidates?.length === 2,
    'UPDATE Step 1: pendingClarification active with 2 candidates',
    JSON.stringify(ctx1.pendingClarification)
  );

  // User replies "2"
  const u1_step2 = await orchestrateUserInput('2', now + 1000);
  assert(
    u1_step2.type === 'HANDLED_LOCAL' && u1_step2.dataAffected === true,
    'UPDATE Step 2: "2" handled locally (NOT routed to Gemini)',
    JSON.stringify(u1_step2)
  );

  const notes1 = loadNotes();
  const updatedNote1 = notes1.find((n) => n.id === 'note-2');
  const untouchedNote1 = notes1.find((n) => n.id === 'note-1');
  assert(
    updatedNote1?.text === 'test selezione' && untouchedNote1?.text === 'pane integrale',
    'UPDATE Step 2: note-2 text successfully updated to "test selezione"',
    `note-2: "${updatedNote1?.text}", note-1: "${untouchedNote1?.text}"`
  );

  const ctx1_after = getContext(now + 1000);
  assert(
    ctx1_after.pendingClarification === null,
    'UPDATE Step 2: pendingClarification cleared after successful update',
    JSON.stringify(ctx1_after.pendingClarification)
  );

  // =========================================================================
  // TEST 2: UPDATE + multiple candidates + "La seconda"
  // =========================================================================
  console.log('\n-- Test 2: UPDATE + multiple candidates + "La seconda" --');
  resetContext(now);
  saveNotes([
    { id: 'note-1', text: 'pane integrale', createdAt: new Date(now).toISOString() },
    { id: 'note-2', text: 'pane carasau', createdAt: new Date(now).toISOString() },
  ]);

  const u2_step1 = await orchestrateUserInput('Modifica la nota del pane e scrivi test ordinale', now);
  assert(
    u2_step1.type === 'HANDLED_LOCAL',
    'UPDATE Ordinal Step 1: Clarification prompt returned',
    JSON.stringify(u2_step1)
  );

  // User replies "La seconda"
  const u2_step2 = await orchestrateUserInput('La seconda', now + 1000);
  assert(
    u2_step2.type === 'HANDLED_LOCAL' && u2_step2.dataAffected === true,
    'UPDATE Ordinal Step 2: "La seconda" handled locally (NOT routed to Gemini)',
    JSON.stringify(u2_step2)
  );

  const notes2 = loadNotes();
  const updatedNote2 = notes2.find((n) => n.id === 'note-2');
  assert(
    updatedNote2?.text === 'test ordinale',
    'UPDATE Ordinal Step 2: note-2 text successfully updated to "test ordinale"',
    updatedNote2?.text
  );

  // =========================================================================
  // TEST 3: DELETE + multiple candidates + "2"
  // =========================================================================
  console.log('\n-- Test 3: DELETE + multiple candidates + "2" --');
  resetContext(now);
  saveNotes([
    { id: 'note-1', text: 'pane integrale', createdAt: new Date(now).toISOString() },
    { id: 'note-2', text: 'pane carasau', createdAt: new Date(now).toISOString() },
  ]);

  const d1_step1 = await orchestrateUserInput('Cancella quella del pane', now);
  assert(
    d1_step1.type === 'HANDLED_LOCAL' &&
    d1_step1.feedbackText?.includes('più note') === true,
    'DELETE Step 1: Clarification prompt returned for ambiguous delete target',
    JSON.stringify(d1_step1)
  );

  // User replies "2"
  const d1_step2 = await orchestrateUserInput('2', now + 1000);
  assert(
    d1_step2.type === 'HANDLED_LOCAL' && d1_step2.dataAffected === true,
    'DELETE Step 2: "2" handled locally and completed (NOT routed to Gemini)',
    JSON.stringify(d1_step2)
  );

  const notes3 = loadNotes();
  assert(
    notes3.length === 1 && notes3[0].id === 'note-1',
    'DELETE Step 2: note-2 was deleted, note-1 remains in storage',
    JSON.stringify(notes3)
  );

  const ctx3_after = getContext(now + 1000);
  assert(
    ctx3_after.pendingClarification === null,
    'DELETE Step 2: pendingClarification cleared after successful delete',
    JSON.stringify(ctx3_after.pendingClarification)
  );

  // =========================================================================
  // TEST 4: DELETE + multiple candidates + "La seconda"
  // =========================================================================
  console.log('\n-- Test 4: DELETE + multiple candidates + "La seconda" --');
  resetContext(now);
  saveNotes([
    { id: 'note-1', text: 'pane integrale', createdAt: new Date(now).toISOString() },
    { id: 'note-2', text: 'pane carasau', createdAt: new Date(now).toISOString() },
  ]);

  const d2_step1 = await orchestrateUserInput('Cancella quella del pane', now);
  assert(
    d2_step1.type === 'HANDLED_LOCAL',
    'DELETE Ordinal Step 1: Clarification prompt returned',
    JSON.stringify(d2_step1)
  );

  // User replies "La seconda"
  const d2_step2 = await orchestrateUserInput('La seconda', now + 1000);
  assert(
    d2_step2.type === 'HANDLED_LOCAL' && d2_step2.dataAffected === true,
    'DELETE Ordinal Step 2: "La seconda" handled locally and completed',
    JSON.stringify(d2_step2)
  );

  const notes4 = loadNotes();
  assert(
    notes4.length === 1 && notes4[0].id === 'note-1',
    'DELETE Ordinal Step 2: note-2 was deleted, note-1 remains',
    JSON.stringify(notes4)
  );

  // =========================================================================
  // TEST 5: Invalid selection keeps clarification active
  // =========================================================================
  console.log('\n-- Test 5: Invalid selection keeps clarification active --');
  resetContext(now);
  saveNotes([
    { id: 'note-1', text: 'pane integrale', createdAt: new Date(now).toISOString() },
    { id: 'note-2', text: 'pane carasau', createdAt: new Date(now).toISOString() },
  ]);

  await orchestrateUserInput('Modifica la nota del pane e scrivi recuperato', now);

  // Out of range number: "5"
  const inv1 = await orchestrateUserInput('5', now + 1000);
  assert(
    inv1.type === 'HANDLED_LOCAL' &&
    inv1.dataAffected === false &&
    inv1.feedbackText?.includes('non valida') === true,
    'Invalid selection "5": rejected locally with feedback (NOT Gemini)',
    JSON.stringify(inv1)
  );

  const ctx_inv1 = getContext(now + 1000);
  assert(
    ctx_inv1.pendingClarification !== null,
    'Invalid selection "5": clarification remains ACTIVE in SessionContext',
    JSON.stringify(ctx_inv1.pendingClarification)
  );

  // Unrecognized text: "boh"
  const inv2 = await orchestrateUserInput('boh', now + 2000);
  assert(
    inv2.type === 'HANDLED_LOCAL' &&
    inv2.dataAffected === false &&
    inv2.feedbackText?.includes('Non ho compreso') === true,
    'Invalid selection "boh": kept in local clarification pipeline',
    JSON.stringify(inv2)
  );

  const ctx_inv2 = getContext(now + 2000);
  assert(
    ctx_inv2.pendingClarification !== null,
    'Invalid selection "boh": clarification remains ACTIVE in SessionContext',
    JSON.stringify(ctx_inv2.pendingClarification)
  );

  // Now provide valid selection "1"
  const valid_after_inv = await orchestrateUserInput('1', now + 3000);
  assert(
    valid_after_inv.type === 'HANDLED_LOCAL' && valid_after_inv.dataAffected === true,
    'Valid selection "1" after invalid attempts succeeds',
    JSON.stringify(valid_after_inv)
  );

  const notes5 = loadNotes();
  const updatedNote5 = notes5.find((n) => n.id === 'note-1');
  assert(
    updatedNote5?.text === 'recuperato',
    'Note-1 was updated after recovering from invalid selections',
    updatedNote5?.text
  );

  // =========================================================================
  // TEST 6: Unrelated new command correctly switches context
  // =========================================================================
  console.log('\n-- Test 6: Unrelated new command correctly switches context --');
  resetContext(now);
  saveNotes([
    { id: 'note-1', text: 'pane integrale', createdAt: new Date(now).toISOString() },
    { id: 'note-2', text: 'pane carasau', createdAt: new Date(now).toISOString() },
  ]);

  await orchestrateUserInput('Modifica la nota del pane e scrivi pane speciale', now);
  assert(
    getContext(now).pendingClarification !== null,
    'Clarification set up before context switch',
    ''
  );

  // User issues completely unrelated local command: "Crea una nota: comprare il latte"
  const switch1 = await orchestrateUserInput('Crea una nota: comprare il latte', now + 1000);
  assert(
    switch1.type === 'HANDLED_LOCAL' && switch1.dataAffected === true,
    'Context switch: "Crea una nota..." executes successfully as new command',
    JSON.stringify(switch1)
  );

  const ctx_switched = getContext(now + 1000);
  assert(
    ctx_switched.pendingClarification === null,
    'Context switch: pendingClarification was cleared by the new command',
    JSON.stringify(ctx_switched.pendingClarification)
  );

  const allNotes = loadNotes();
  assert(
    allNotes.some((n) => n.text === 'comprare il latte'),
    'New note "comprare il latte" was created in storage',
    JSON.stringify(allNotes)
  );

  // Cognitive command switch: "Chi era Napoleone?"
  await orchestrateUserInput('Modifica la nota del pane e scrivi pane speciale', now + 2000);
  const switchCog = await orchestrateUserInput('Chi era Napoleone?', now + 3000);
  assert(
    switchCog.type === 'FALLTHROUGH_GEMINI',
    'Context switch: "Chi era Napoleone?" routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(switchCog)
  );

  const ctx_cog = getContext(now + 3000);
  assert(
    ctx_cog.pendingClarification === null,
    'Context switch: pendingClarification cleared on cognitive switch',
    JSON.stringify(ctx_cog.pendingClarification)
  );

  // =========================================================================
  // TEST 7: Normal standalone "2" when no pending clarification -> Gemini
  // =========================================================================
  console.log('\n-- Test 7: Standalone "2" without clarification routes to Gemini --');
  resetContext(now);
  const standaloneRes = await orchestrateUserInput('2', now);
  assert(
    standaloneRes.type === 'FALLTHROUGH_GEMINI' && standaloneRes.rawQuery === '2',
    'Standalone "2" without pending clarification routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(standaloneRes)
  );

  // =========================================================================
  // TEST 8: REMINDER UPDATE + multiple candidates + "1"
  // =========================================================================
  console.log('\n-- Test 8: REMINDER UPDATE + multiple candidates + "1" --');
  resetContext(now);
  saveReminders([
    { id: 'rem-1', text: 'chiamare Roberto dentista', dueAt: new Date(now + 3600000).toISOString(), completed: false, createdAt: new Date(now).toISOString() },
    { id: 'rem-2', text: 'chiamare Roberto commercialista', dueAt: new Date(now + 7200000).toISOString(), completed: false, createdAt: new Date(now).toISOString() },
  ]);

  const r_step1 = await orchestrateUserInput('Modifica il promemoria di chiamare Roberto e scrivi chiamare Roberto medico', now);
  assert(
    r_step1.type === 'HANDLED_LOCAL' && r_step1.feedbackText?.includes('promemoria') === true,
    'REMINDER UPDATE Step 1: Clarification prompt for ambiguous reminders',
    JSON.stringify(r_step1)
  );

  const r_step2 = await orchestrateUserInput('1', now + 1000);
  assert(
    r_step2.type === 'HANDLED_LOCAL' && r_step2.dataAffected === true,
    'REMINDER UPDATE Step 2: "1" updates reminder-1 (NOT Gemini)',
    JSON.stringify(r_step2)
  );

  const rems = loadReminders();
  const updatedRem = rems.find((r) => r.id === 'rem-1');
  assert(
    updatedRem?.text === 'chiamare Roberto medico',
    'REMINDER UPDATE Step 2: rem-1 text was updated in storage',
    updatedRem?.text
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL CLARIFICATION CONTINUATION TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
