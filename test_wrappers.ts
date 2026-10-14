import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { resetContext } from './src/services/context/sessionContext';
import { saveNotes, loadNotes } from './src/utils/notesManager';
import { saveReminders, loadReminders } from './src/utils/reminderManager';
import { loadUserMemory, saveUserMemory } from './src/services/router/actionExecutor';

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
  console.log('=== RUNNING CONVERSATIONAL WRAPPER BUG-FIX TESTS ===\n');

  const now = 1775000000000; // Fixed timestamp: Wednesday April 1 2026, ~15:33 UTC
  resetContext(now);
  storage['maia_notes_v1'] = JSON.stringify([]);
  storage['maia_reminders_v1'] = JSON.stringify([]);
  saveUserMemory({
    userName: '',
    userCity: '',
    preferences: [],
    interests: [],
    projects: [],
    notes: [],
  });

  // =========================================================================
  // 1. CLASSIFICATION & INTENT CHECKS
  // =========================================================================
  console.log('-- Section 1: Intent Classification of Wrapped Local Commands --');

  // 1a. "Senti, crea una nota: comprare il latte"
  const c1 = classifyIntent('Senti, crea una nota: comprare il latte');
  assert(
    c1.verb === 'CREATE' && c1.entity === 'NOTE' && c1.isLocalActionCandidate === true && c1.parameters.text === 'comprare il latte',
    'Classify: "Senti, crea una nota: comprare il latte" -> CREATE NOTE with text "comprare il latte"',
    JSON.stringify(c1)
  );

  // 1b. "Ok, allora, crea una nota: comprare il pane"
  const c2 = classifyIntent('Ok, allora, crea una nota: comprare il pane');
  assert(
    c2.verb === 'CREATE' && c2.entity === 'NOTE' && c2.isLocalActionCandidate === true && c2.parameters.text === 'comprare il pane',
    'Classify: "Ok, allora, crea una nota: comprare il pane" -> CREATE NOTE with text "comprare il pane"',
    JSON.stringify(c2)
  );

  // 1c. "No, aspetta, crea una nota: comprare il pane"
  const c3 = classifyIntent('No, aspetta, crea una nota: comprare il pane');
  assert(
    c3.verb === 'CREATE' && c3.entity === 'NOTE' && c3.isLocalActionCandidate === true && c3.parameters.text === 'comprare il pane',
    'Classify: "No, aspetta, crea una nota: comprare il pane" -> CREATE NOTE with text "comprare il pane"',
    JSON.stringify(c3)
  );

  // 1d. "Senti, crea un promemoria per chiamare Roberto domani alle 20"
  const c4 = classifyIntent('Senti, crea un promemoria per chiamare Roberto domani alle 20');
  assert(
    c4.verb === 'CREATE' && c4.entity === 'REMINDER' && c4.isLocalActionCandidate === true && c4.parameters.text === 'chiamare Roberto' && !!c4.parameters.dueAt,
    'Classify: "Senti, crea un promemoria per chiamare Roberto domani alle 20" -> CREATE REMINDER with text "chiamare Roberto" and dueAt',
    JSON.stringify(c4)
  );

  // 1e. "Senti, ricordati che mi piace il caffè senza zucchero"
  const c5 = classifyIntent('Senti, ricordati che mi piace il caffè senza zucchero');
  assert(
    c5.verb === 'CREATE' && c5.entity === 'MEMORY' && c5.isLocalActionCandidate === true && c5.parameters.text === 'mi piace il caffè senza zucchero',
    'Classify: "Senti, ricordati che mi piace il caffè senza zucchero" -> CREATE MEMORY with text "mi piace il caffè senza zucchero"',
    JSON.stringify(c5)
  );

  // =========================================================================
  // 2. END-TO-END ORCHESTRATION OF WRAPPED COMMANDS (MAIA Actions, NOT Gemini!)
  // =========================================================================
  console.log('\n-- Section 2: End-to-End Orchestration of Wrapped Commands --');

  // Test 1: "Senti, crea una nota: comprare il latte"
  const res1 = await orchestrateUserInput('Senti, crea una nota: comprare il latte', now);
  assert(
    res1.type === 'HANDLED_LOCAL' && res1.dataAffected === true,
    'Orchestrate: "Senti, crea una nota: comprare il latte" -> HANDLED_LOCAL (NOT Gemini)',
    JSON.stringify(res1)
  );
  const notes1 = loadNotes();
  const note1 = notes1[notes1.length - 1];
  assert(
    note1?.text === 'comprare il latte',
    'Payload verify: note payload is exactly "comprare il latte" (no colon, no "Senti")',
    note1?.text
  );

  // Test 2: "Ok, allora, crea una nota: comprare il pane"
  const res2 = await orchestrateUserInput('Ok, allora, crea una nota: comprare il pane', now);
  assert(
    res2.type === 'HANDLED_LOCAL' && res2.dataAffected === true,
    'Orchestrate: "Ok, allora, crea una nota: comprare il pane" -> HANDLED_LOCAL',
    JSON.stringify(res2)
  );
  const notes2 = loadNotes();
  const note2 = notes2[notes2.length - 1];
  assert(
    note2?.text === 'comprare il pane',
    'Payload verify: note payload is exactly "comprare il pane"',
    note2?.text
  );

  // Test 3: "Senti, crea un promemoria per chiamare Roberto domani alle 20"
  const res3 = await orchestrateUserInput('Senti, crea un promemoria per chiamare Roberto domani alle 20', now);
  assert(
    res3.type === 'HANDLED_LOCAL' && res3.dataAffected === true,
    'Orchestrate: "Senti, crea un promemoria per chiamare Roberto domani alle 20" -> HANDLED_LOCAL',
    JSON.stringify(res3)
  );
  const rems3 = loadReminders();
  const rem3 = rems3[rems3.length - 1];
  assert(
    rem3?.text === 'chiamare Roberto' && new Date(rem3?.dueAt || '').getHours() === 20,
    'Payload verify: reminder text is "chiamare Roberto" and due time is 20:00',
    `text: "${rem3?.text}", dueAt: "${rem3?.dueAt}"`
  );

  // Test 4: "Senti, ricordati che mi piace il caffè senza zucchero"
  const res4 = await orchestrateUserInput('Senti, ricordati che mi piace il caffè senza zucchero', now);
  assert(
    res4.type === 'HANDLED_LOCAL' && res4.dataAffected === true,
    'Orchestrate: "Senti, ricordati che mi piace il caffè senza zucchero" -> HANDLED_LOCAL',
    JSON.stringify(res4)
  );
  const mem = loadUserMemory();
  assert(
    (mem.preferences.concat(mem.interests)).some((p) => p.includes('caffè senza zucchero')),
    'Payload verify: memory contains "caffè senza zucchero"',
    JSON.stringify({ preferences: mem.preferences, interests: mem.interests })
  );

  // =========================================================================
  // 3. CONVERSATIONAL MESSAGES THAT MUST STILL GO TO GEMINI
  // =========================================================================
  console.log('\n-- Section 3: Genuine Conversational Messages Routed to Gemini --');

  const g1 = await orchestrateUserInput('Senti, chi era Napoleone?', now);
  assert(
    g1.type === 'FALLTHROUGH_GEMINI',
    'Conversational: "Senti, chi era Napoleone?" -> FALLTHROUGH_GEMINI',
    JSON.stringify(g1)
  );

  const g2 = await orchestrateUserInput('Ok, allora raccontami una storia', now);
  assert(
    g2.type === 'FALLTHROUGH_GEMINI',
    'Conversational: "Ok, allora raccontami una storia" -> FALLTHROUGH_GEMINI',
    JSON.stringify(g2)
  );

  const g3 = await orchestrateUserInput('Senti, come stai oggi?', now);
  assert(
    g3.type === 'FALLTHROUGH_GEMINI',
    'Conversational: "Senti, come stai oggi?" -> FALLTHROUGH_GEMINI',
    JSON.stringify(g3)
  );

  const g4 = await orchestrateUserInput('No, aspetta, quanto fa 25 per 4?', now);
  assert(
    g4.type === 'FALLTHROUGH_GEMINI',
    'Calculation: "No, aspetta, quanto fa 25 per 4?" -> FALLTHROUGH_GEMINI',
    JSON.stringify(g4)
  );

  // =========================================================================
  // 4. REGRESSION ON STANDARD (UNWRAPPED) COMMANDS
  // =========================================================================
  console.log('\n-- Section 4: Regression on Standard Unwrapped Commands --');

  // "Crea una nota: test"
  const resStdNote = await orchestrateUserInput('Crea una nota: test', now);
  assert(
    resStdNote.type === 'HANDLED_LOCAL' && resStdNote.dataAffected === true,
    'Standard: "Crea una nota: test" -> HANDLED_LOCAL',
    JSON.stringify(resStdNote)
  );
  const notesStd = loadNotes();
  assert(
    notesStd[notesStd.length - 1]?.text === 'test',
    'Standard note text is "test"',
    notesStd[notesStd.length - 1]?.text
  );

  // "Crea un promemoria per test domani alle 20"
  const resStdRem = await orchestrateUserInput('Crea un promemoria per test domani alle 20', now);
  assert(
    resStdRem.type === 'HANDLED_LOCAL' && resStdRem.dataAffected === true,
    'Standard: "Crea un promemoria per test domani alle 20" -> HANDLED_LOCAL',
    JSON.stringify(resStdRem)
  );
  const remsStd = loadReminders();
  assert(
    remsStd[remsStd.length - 1]?.text === 'test' && new Date(remsStd[remsStd.length - 1]?.dueAt).getHours() === 20,
    'Standard reminder text is "test" and hour is 20:00',
    remsStd[remsStd.length - 1]?.text
  );

  // "Ricordati che mi piace il caffè"
  saveUserMemory({
    userName: '',
    userCity: '',
    preferences: [],
    interests: [],
    projects: [],
    notes: [],
  });
  const resStdMem = await orchestrateUserInput('Ricordati che mi piace il caffè', now);
  assert(
    resStdMem.type === 'HANDLED_LOCAL' && resStdMem.dataAffected === true,
    'Standard: "Ricordati che mi piace il caffè" -> HANDLED_LOCAL',
    JSON.stringify(resStdMem)
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
