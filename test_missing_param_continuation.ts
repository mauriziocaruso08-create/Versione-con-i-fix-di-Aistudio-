import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { resetContext, getContext } from './src/services/context/sessionContext';
import { loadNotes, saveNotes } from './src/utils/notesManager';
import { loadReminders, saveReminders } from './src/utils/reminderManager';

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
  console.log('=== RUNNING CONTEXTUAL UPDATE & MISSING_PARAM CONTINUATION TESTS (BUG #9) ===\n');

  const now = 1775000000000;

  // =========================================================================
  // TEST A: Inline UPDATE text extraction & direct execution
  // =========================================================================
  console.log('-- Test A: Inline UPDATE text extraction --');
  saveNotes([]);
  resetContext(now);

  const aCreate = await orchestrateUserInput('Crea una nota: TESTBUG9', now);
  assert(
    aCreate.type === 'HANDLED_LOCAL' && aCreate.affectedEntity === 'NOTE',
    'Test A (1/2): Created note TESTBUG9 successfully'
  );

  const aUpdate = await orchestrateUserInput('Modifica quella nota: TESTBUG9 modificata', now + 1000);
  assert(
    aUpdate.type === 'HANDLED_LOCAL' && aUpdate.dataAffected === true,
    'Test A (2/2): "Modifica quella nota: TESTBUG9 modificata" executes directly without clarification',
    JSON.stringify(aUpdate)
  );
  const notesA = loadNotes();
  assert(
    notesA.length === 1 && notesA[0].text === 'TESTBUG9 modificata',
    'Test A verified: note text updated to "TESTBUG9 modificata"',
    notesA[0]?.text
  );

  // =========================================================================
  // TEST B: "in:" variant
  // =========================================================================
  console.log('\n-- Test B: "in:" variant --');
  const bUpdate = await orchestrateUserInput('Cambia quella nota in: TESTBUG9 modificata ancora', now + 2000);
  assert(
    bUpdate.type === 'HANDLED_LOCAL' && bUpdate.dataAffected === true,
    'Test B: "Cambia quella nota in: TESTBUG9 modificata ancora" executes directly',
    JSON.stringify(bUpdate)
  );
  const notesB = loadNotes();
  assert(
    notesB.length === 1 && notesB[0].text === 'TESTBUG9 modificata ancora',
    'Test B verified: note text is "TESTBUG9 modificata ancora"',
    notesB[0]?.text
  );

  // =========================================================================
  // TEST C: "e scrivi" variant
  // =========================================================================
  console.log('\n-- Test C: "e scrivi" variant --');
  const cUpdate = await orchestrateUserInput('Modifica quella nota e scrivi: TESTBUG9 finale', now + 3000);
  assert(
    cUpdate.type === 'HANDLED_LOCAL' && cUpdate.dataAffected === true,
    'Test C: "Modifica quella nota e scrivi: TESTBUG9 finale" executes directly',
    JSON.stringify(cUpdate)
  );
  const notesC = loadNotes();
  assert(
    notesC.length === 1 && notesC[0].text === 'TESTBUG9 finale',
    'Test C verified: note text is "TESTBUG9 finale"',
    notesC[0]?.text
  );

  // =========================================================================
  // TEST D: Pending continuation (MISSING_PARAM)
  // =========================================================================
  console.log('\n-- Test D: Pending continuation (MISSING_PARAM) --');
  saveNotes([]);
  resetContext(now);

  await orchestrateUserInput('Crea una nota: initial text', now);
  // User issues update with no newText: "Modifica quella nota"
  const dStep1 = await orchestrateUserInput('Modifica quella nota', now + 1000);
  assert(
    dStep1.type === 'HANDLED_LOCAL' && Boolean(dStep1.feedbackText?.includes('Quale nuovo testo')),
    'Test D Step 1: MAIA asks for the new text',
    dStep1.feedbackText
  );
  const ctxD = getContext(now + 1000);
  assert(
    ctxD.pendingClarification?.type === 'MISSING_PARAM' &&
    ctxD.pendingClarification?.missingParameter === 'newText',
    'Test D Step 1: pendingClarification set with type MISSING_PARAM and missingParameter newText'
  );

  // User replies with the new text: "TESTBUG9 finale"
  const dStep2 = await orchestrateUserInput('TESTBUG9 finale', now + 2000);
  assert(
    dStep2.type === 'HANDLED_LOCAL' && dStep2.dataAffected === true,
    'Test D Step 2: "TESTBUG9 finale" completed pending UPDATE locally (NOT sent to Gemini)',
    JSON.stringify(dStep2)
  );
  const notesD = loadNotes();
  assert(
    notesD.length === 1 && notesD[0].text === 'TESTBUG9 finale',
    'Test D Step 2 verified: note text successfully updated in storage to "TESTBUG9 finale"',
    notesD[0]?.text
  );

  // =========================================================================
  // TEST E: Pending REMINDER continuation
  // =========================================================================
  console.log('\n-- Test E: Pending REMINDER continuation --');
  saveReminders([]);
  resetContext(now);

  await orchestrateUserInput('Crea un promemoria per chiamare Roberto domani alle 20', now);
  // Issue update without new text or time
  const eStep1 = await orchestrateUserInput('Modifica quel promemoria', now + 1000);
  assert(
    eStep1.type === 'HANDLED_LOCAL' && Boolean(eStep1.feedbackText?.includes('modificare del promemoria')),
    'Test E Step 1: MAIA asks what to modify in reminder',
    eStep1.feedbackText
  );

  // User supplies replacement text
  const eStep2 = await orchestrateUserInput('chiamare Marco', now + 2000);
  assert(
    eStep2.type === 'HANDLED_LOCAL' && eStep2.dataAffected === true,
    'Test E Step 2: reminder update completed with new text',
    JSON.stringify(eStep2)
  );
  const remsE = loadReminders();
  assert(
    remsE.length === 1 && remsE[0].text === 'chiamare Marco',
    'Test E Step 2 verified: reminder text updated to "chiamare Marco"',
    remsE[0]?.text
  );

  // =========================================================================
  // TEST F: Context switch (cognitive inquiry)
  // =========================================================================
  console.log('\n-- Test F: Context switch to cognitive query --');
  saveNotes([{ id: 'note-f', text: 'Nota preesistente', createdAt: new Date(now).toISOString() }]);
  resetContext(now);

  // Trigger pending update
  await orchestrateUserInput('Modifica quella nota', now);
  assert(
    getContext(now).pendingClarification?.type === 'MISSING_PARAM',
    'Test F Step 1: MISSING_PARAM active'
  );

  // User asks unrelated question
  const fRes = await orchestrateUserInput('Chi era Napoleone?', now + 1000);
  assert(
    fRes.type === 'FALLTHROUGH_GEMINI',
    'Test F Step 2: "Chi era Napoleone?" routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(fRes)
  );
  const notesF = loadNotes();
  assert(
    notesF[0].text === 'Nota preesistente',
    'Test F Step 2 verified: note was NOT modified with "Chi era Napoleone?"'
  );
  assert(
    getContext(now + 1000).pendingClarification === null,
    'Test F Step 2 verified: pendingClarification was cleared on cognitive switch'
  );

  // =========================================================================
  // TEST G: Context switch to another local action
  // =========================================================================
  console.log('\n-- Test G: Context switch to another local action --');
  saveNotes([{ id: 'note-g', text: 'Nota preesistente G', createdAt: new Date(now).toISOString() }]);
  saveReminders([{ id: 'rem-g', text: 'Promemoria G', dueAt: new Date(now + 3600000).toISOString(), completed: false, createdAt: new Date(now).toISOString() }]);
  resetContext(now);

  await orchestrateUserInput('Modifica quella nota', now);
  assert(
    getContext(now).pendingClarification?.type === 'MISSING_PARAM',
    'Test G Step 1: MISSING_PARAM active'
  );

  // User issues read reminders command
  const gRes = await orchestrateUserInput('Mostra i miei promemoria', now + 1000);
  assert(
    gRes.type === 'HANDLED_LOCAL' && gRes.affectedEntity === 'REMINDER',
    'Test G Step 2: "Mostra i miei promemoria" executes READ REMINDER (not consumed as newText)',
    JSON.stringify(gRes)
  );
  const notesG = loadNotes();
  assert(
    notesG[0].text === 'Nota preesistente G',
    'Test G Step 2 verified: note was NOT modified with "Mostra i miei promemoria"'
  );

  // =========================================================================
  // TEST H: Cancellation
  // =========================================================================
  console.log('\n-- Test H: Cancellation --');
  saveNotes([{ id: 'note-h', text: 'Nota preesistente H', createdAt: new Date(now).toISOString() }]);
  resetContext(now);

  await orchestrateUserInput('Modifica quella nota', now);
  assert(
    getContext(now).pendingClarification?.type === 'MISSING_PARAM',
    'Test H Step 1: MISSING_PARAM active'
  );

  const hRes = await orchestrateUserInput('annulla', now + 1000);
  assert(
    hRes.type === 'HANDLED_LOCAL' && Boolean(hRes.feedbackText?.includes('annullata')),
    'Test H Step 2: "annulla" returns cancellation feedback',
    hRes.feedbackText
  );
  assert(
    getContext(now + 1000).pendingClarification === null,
    'Test H Step 2 verified: pendingClarification cleared after cancellation'
  );

  // =========================================================================
  // TEST I: Ambiguous contextual target
  // =========================================================================
  console.log('\n-- Test I: Ambiguous contextual target --');
  saveNotes([]);
  resetContext(now);

  // Create two distinct notes in session
  await orchestrateUserInput('Crea una nota: Prima nota per test I', now);
  await orchestrateUserInput('Crea una nota: Seconda nota per test I', now + 1000);

  // "Modifica quella nota: testo test" -> both notes are recent in session, genuinely ambiguous
  const iRes = await orchestrateUserInput('Modifica quella nota: testo test', now + 2000);
  assert(
    iRes.type === 'HANDLED_LOCAL' &&
    Boolean(iRes.feedbackText?.includes('più note') || iRes.feedbackText?.includes('Quale')),
    'Test I: Multiple recent notes produce clarification asking which note (does NOT pick arbitrarily)',
    iRes.feedbackText
  );

  // =========================================================================
  // TEST J: Recent unique contextual target
  // =========================================================================
  console.log('\n-- Test J: Recent unique contextual target --');
  saveNotes([]);
  resetContext(now);

  // Exactly one note created
  await orchestrateUserInput('Crea una nota: Unica nota recente', now);

  const jRes = await orchestrateUserInput('Modifica quella nota: nuovo testo J', now + 1000);
  assert(
    jRes.type === 'HANDLED_LOCAL' && jRes.dataAffected === true,
    'Test J: Exactly one recent note executes direct UPDATE with NO clarification',
    JSON.stringify(jRes)
  );
  const notesJ = loadNotes();
  assert(
    notesJ.length === 1 && notesJ[0].text === 'nuovo testo J',
    'Test J verified: unique note text updated to "nuovo testo J"',
    notesJ[0]?.text
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL MISSING_PARAM CONTINUATION & CONTEXTUAL UPDATE TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
