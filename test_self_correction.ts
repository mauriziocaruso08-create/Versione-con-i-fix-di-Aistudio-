import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { resetContext } from './src/services/context/sessionContext';
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
  console.log('=== RUNNING SELF-CORRECTION & FINAL INTENT OVERRIDE TESTS (BUG #7) ===\n');

  const now = 1775000000000;
  resetContext(now);
  saveNotes([]);
  saveReminders([]);

  // =========================================================================
  // SECTION 1: CLASSIFICATION OF OVERRIDE / CORRECTION STATEMENTS
  // =========================================================================
  console.log('-- Section 1: Intent Classification of Override Statements --');

  // Test A
  const cA = classifyIntent('Crea una nota: test cambio, no aspetta, crea un promemoria per chiamare Roberto domani alle 20');
  assert(
    cA.verb === 'CREATE' &&
    cA.entity === 'REMINDER' &&
    cA.parameters.text === 'chiamare Roberto' &&
    cA.parameters.dueAt !== undefined &&
    new Date(cA.parameters.dueAt).getHours() === 20,
    'Classify Test A: "Crea una nota: ..., no aspetta, crea un promemoria..." -> CREATE REMINDER',
    JSON.stringify(cA)
  );

  // Test B
  const cB = classifyIntent('Crea un promemoria per chiamare Roberto domani alle 20, no aspetta, crea una nota: comprare il pane');
  assert(
    cB.verb === 'CREATE' &&
    cB.entity === 'NOTE' &&
    cB.parameters.text === 'comprare il pane',
    'Classify Test B: "Crea un promemoria..., no aspetta, crea una nota..." -> CREATE NOTE',
    JSON.stringify(cB)
  );

  // Test C
  const cC = classifyIntent('Senti, crea una nota: A, no aspetta, crea un promemoria per B domani alle 20');
  assert(
    cC.verb === 'CREATE' &&
    cC.entity === 'REMINDER' &&
    cC.parameters.text === 'B' &&
    cC.parameters.dueAt !== undefined,
    'Classify Test C: with prefix "Senti, crea una nota: A, no aspetta, crea un promemoria per B..." -> CREATE REMINDER',
    JSON.stringify(cC)
  );

  // Test D
  const cD = classifyIntent('Non creare una nota, anzi crea una nota: comprare il pane');
  assert(
    cD.verb === 'CREATE' &&
    cD.entity === 'NOTE' &&
    cD.parameters.text === 'comprare il pane' &&
    cD.isLocalActionCandidate === true,
    'Classify Test D: "Non creare una nota, anzi crea una nota: comprare il pane" -> CREATE NOTE',
    JSON.stringify(cD)
  );

  // Test E
  const cE = classifyIntent('Ok, crea un promemoria per A, no aspetta, crea una nota: B');
  assert(
    cE.verb === 'CREATE' &&
    cE.entity === 'NOTE' &&
    cE.parameters.text === 'B',
    'Classify Test E: "Ok, crea un promemoria per A, no aspetta, crea una nota: B" -> CREATE NOTE',
    JSON.stringify(cE)
  );

  // Test F
  const cF = classifyIntent('Lascia perdere la nota, crea un promemoria per chiamare Roberto domani alle 20');
  assert(
    cF.verb === 'CREATE' &&
    cF.entity === 'REMINDER' &&
    cF.parameters.text === 'chiamare Roberto' &&
    cF.parameters.dueAt !== undefined,
    'Classify Test F: "Lascia perdere la nota, crea un promemoria..." -> CREATE REMINDER',
    JSON.stringify(cF)
  );

  // Test G
  const cG = classifyIntent('Mi correggo: crea una nota: comprare il pane');
  assert(
    cG.verb === 'CREATE' &&
    cG.entity === 'NOTE' &&
    cG.parameters.text === 'comprare il pane',
    'Classify Test G: "Mi correggo: crea una nota: comprare il pane" -> CREATE NOTE',
    JSON.stringify(cG)
  );

  // =========================================================================
  // SECTION 2: END-TO-END ORCHESTRATION & ISOLATION
  // =========================================================================
  console.log('\n-- Section 2: End-to-End Orchestration & Execution Isolation --');

  // Test A Execution: Must create ONLY the reminder, NOT the note!
  saveNotes([]);
  saveReminders([]);
  resetContext(now);
  const rA = await orchestrateUserInput('Crea una nota: test cambio, no aspetta, crea un promemoria per chiamare Roberto domani alle 20', now);
  assert(
    rA.type === 'HANDLED_LOCAL' && rA.affectedEntity === 'REMINDER',
    'Orchestrate Test A: handled as REMINDER (NOT Gemini, NOT Note)',
    JSON.stringify(rA)
  );
  const notesAfterA = loadNotes();
  const remsAfterA = loadReminders();
  assert(
    notesAfterA.length === 0,
    'Orchestrate Test A: NOTE was NOT created (notes count is 0)',
    `notes: ${notesAfterA.length}`
  );
  assert(
    remsAfterA.length === 1 &&
    remsAfterA[0].text === 'chiamare Roberto' &&
    new Date(remsAfterA[0].dueAt).getHours() === 20,
    'Orchestrate Test A: REMINDER was created with text "chiamare Roberto" at 20:00',
    `text: "${remsAfterA[0]?.text}", dueAt: "${remsAfterA[0]?.dueAt}"`
  );

  // Test B Execution: Must create ONLY the note, NOT the reminder!
  saveNotes([]);
  saveReminders([]);
  resetContext(now);
  const rB = await orchestrateUserInput('Crea un promemoria per chiamare Roberto domani alle 20, no aspetta, crea una nota: comprare il pane', now);
  assert(
    rB.type === 'HANDLED_LOCAL' && rB.affectedEntity === 'NOTE',
    'Orchestrate Test B: handled as NOTE',
    JSON.stringify(rB)
  );
  const notesAfterB = loadNotes();
  const remsAfterB = loadReminders();
  assert(
    remsAfterB.length === 0,
    'Orchestrate Test B: REMINDER was NOT created (reminders count is 0)',
    `reminders: ${remsAfterB.length}`
  );
  assert(
    notesAfterB.length === 1 && notesAfterB[0].text === 'comprare il pane',
    'Orchestrate Test B: NOTE was created with text "comprare il pane"',
    notesAfterB[0]?.text
  );

  // Test D Execution
  saveNotes([]);
  resetContext(now);
  const rD = await orchestrateUserInput('Non creare una nota, anzi crea una nota: comprare il pane', now);
  assert(
    rD.type === 'HANDLED_LOCAL' && rD.affectedEntity === 'NOTE',
    'Orchestrate Test D: handled locally as NOTE (NOT sent to Gemini)',
    JSON.stringify(rD)
  );
  const notesAfterD = loadNotes();
  assert(
    notesAfterD.length === 1 && notesAfterD[0].text === 'comprare il pane',
    'Orchestrate Test D: note saved with text "comprare il pane"',
    notesAfterD[0]?.text
  );

  // Test F Execution
  saveNotes([]);
  saveReminders([]);
  resetContext(now);
  const rF = await orchestrateUserInput('Lascia perdere la nota, crea un promemoria per chiamare Roberto domani alle 20', now);
  assert(
    rF.type === 'HANDLED_LOCAL' && rF.affectedEntity === 'REMINDER',
    'Orchestrate Test F: handled locally as REMINDER',
    JSON.stringify(rF)
  );
  const remsAfterF = loadReminders();
  assert(
    remsAfterF.length === 1 && remsAfterF[0].text === 'chiamare Roberto',
    'Orchestrate Test F: reminder saved with text "chiamare Roberto"',
    remsAfterF[0]?.text
  );

  // =========================================================================
  // SECTION 3: NEGATIVE & GUARDRAIL TESTS
  // =========================================================================
  console.log('\n-- Section 3: Negative & Guardrail Tests --');

  // "Ma non aspetta? Chi era Napoleone?" -> Gemini
  const g1 = await orchestrateUserInput('Ma non aspetta? Chi era Napoleone?', now);
  assert(
    g1.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Ma non aspetta? Chi era Napoleone?" routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(g1)
  );

  // "Cosa significa anzi?" -> Gemini
  const g2 = await orchestrateUserInput('Cosa significa anzi?', now);
  assert(
    g2.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Cosa significa anzi?" routes to Gemini',
    JSON.stringify(g2)
  );

  // "Chi era Napoleone?" -> Gemini
  const g3 = await orchestrateUserInput('Chi era Napoleone?', now);
  assert(
    g3.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Chi era Napoleone?" routes to Gemini',
    JSON.stringify(g3)
  );

  // Correction from action to question: "Crea una nota, no aspetta, chi era Napoleone?" -> Gemini
  saveNotes([]);
  const g4 = await orchestrateUserInput('Crea una nota, no aspetta, chi era Napoleone?', now);
  assert(
    g4.type === 'FALLTHROUGH_GEMINI',
    'Action corrected to question: "Crea una nota, no aspetta, chi era Napoleone?" routes to Gemini',
    JSON.stringify(g4)
  );
  assert(
    loadNotes().length === 0,
    'Action corrected to question: Note was NOT created',
    `notes: ${loadNotes().length}`
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL SELF-CORRECTION TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
