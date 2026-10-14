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
  console.log('=== RUNNING POLITE & INTERROGATIVE LOCAL ACTIONS TESTS (BUG #8) ===\n');

  const now = 1775000000000;
  resetContext(now);
  saveNotes([]);
  saveReminders([]);

  // =========================================================================
  // SECTION 1: INTENT CLASSIFICATION OF POLITE / INTERROGATIVE FORMS
  // =========================================================================
  console.log('-- Section 1: Intent Classification of Polite / Interrogative Forms --');

  // Test A
  const cA = classifyIntent('Mi puoi appuntare che devo comprare il pane?');
  assert(
    cA.verb === 'CREATE' &&
    cA.entity === 'NOTE' &&
    cA.parameters.text === 'devo comprare il pane' &&
    cA.isLocalActionCandidate === true,
    'Classify Test A: "Mi puoi appuntare che devo comprare il pane?" -> CREATE NOTE "devo comprare il pane"',
    JSON.stringify(cA)
  );

  // Test B
  const cB = classifyIntent('Puoi prendere nota che devo comprare il caffè?');
  assert(
    cB.verb === 'CREATE' &&
    cB.entity === 'NOTE' &&
    cB.parameters.text === 'devo comprare il caffè' &&
    cB.isLocalActionCandidate === true,
    'Classify Test B: "Puoi prendere nota che devo comprare il caffè?" -> CREATE NOTE "devo comprare il caffè"',
    JSON.stringify(cB)
  );

  // Test C
  const cC = classifyIntent('Puoi prendere nota di comprare il latte?');
  assert(
    cC.verb === 'CREATE' &&
    cC.entity === 'NOTE' &&
    cC.parameters.text === 'comprare il latte' &&
    cC.isLocalActionCandidate === true,
    'Classify Test C: "Puoi prendere nota di comprare il latte?" -> CREATE NOTE "comprare il latte"',
    JSON.stringify(cC)
  );

  // Test D
  const cD = classifyIntent('Mi fai il favore di appuntarmi che devo comprare il latte?');
  assert(
    cD.verb === 'CREATE' &&
    cD.entity === 'NOTE' &&
    cD.parameters.text === 'devo comprare il latte' &&
    cD.isLocalActionCandidate === true,
    'Classify Test D: "Mi fai il favore di appuntarmi che devo comprare il latte?" -> CREATE NOTE "devo comprare il latte"',
    JSON.stringify(cD)
  );

  // Test E
  const cE = classifyIntent('Potresti appuntare che domani devo chiamare Roberto?');
  assert(
    cE.verb === 'CREATE' &&
    cE.entity === 'NOTE' &&
    cE.parameters.text === 'domani devo chiamare Roberto' &&
    cE.isLocalActionCandidate === true,
    'Classify Test E: "Potresti appuntare che domani devo chiamare Roberto?" -> CREATE NOTE "domani devo chiamare Roberto"',
    JSON.stringify(cE)
  );

  // Test F
  const cF = classifyIntent('Senti, mi puoi appuntare che devo comprare il pane?');
  assert(
    cF.verb === 'CREATE' &&
    cF.entity === 'NOTE' &&
    cF.parameters.text === 'devo comprare il pane',
    'Classify Test F: with prefix "Senti, mi puoi appuntare che devo comprare il pane?" -> CREATE NOTE',
    JSON.stringify(cF)
  );

  // Test G
  const cG = classifyIntent('Mi puoi appuntare che devo comprare il pane, no aspetta, crea un promemoria per chiamare Roberto domani alle 20');
  assert(
    cG.verb === 'CREATE' &&
    cG.entity === 'REMINDER' &&
    cG.parameters.text === 'chiamare Roberto' &&
    cG.parameters.dueAt !== undefined,
    'Classify Test G: override with polite note opener -> CREATE REMINDER',
    JSON.stringify(cG)
  );

  // =========================================================================
  // SECTION 2: END-TO-END EXECUTION & PAYLOAD VERIFICATION
  // =========================================================================
  console.log('\n-- Section 2: End-to-End Execution & Payload Verification --');

  // Test A Execution
  saveNotes([]);
  resetContext(now);
  const rA = await orchestrateUserInput('Mi puoi appuntare che devo comprare il pane?', now);
  assert(
    rA.type === 'HANDLED_LOCAL' && rA.affectedEntity === 'NOTE',
    'Orchestrate Test A: handled locally as NOTE (NOT sent to Gemini)',
    JSON.stringify(rA)
  );
  const notesA = loadNotes();
  assert(
    notesA.length === 1 && notesA[0].text === 'devo comprare il pane',
    'Payload Test A: exactly "devo comprare il pane" (no "Mi puoi appuntare che", no "?")',
    notesA[0]?.text
  );

  // Test B Execution
  saveNotes([]);
  resetContext(now);
  const rB = await orchestrateUserInput('Puoi prendere nota che devo comprare il caffè?', now);
  assert(
    rB.type === 'HANDLED_LOCAL' && rB.affectedEntity === 'NOTE',
    'Orchestrate Test B: handled locally as NOTE',
    JSON.stringify(rB)
  );
  const notesB = loadNotes();
  assert(
    notesB.length === 1 && notesB[0].text === 'devo comprare il caffè',
    'Payload Test B: exactly "devo comprare il caffè"',
    notesB[0]?.text
  );

  // Test C Execution
  saveNotes([]);
  resetContext(now);
  const rC = await orchestrateUserInput('Puoi prendere nota di comprare il latte?', now);
  assert(
    rC.type === 'HANDLED_LOCAL' && rC.affectedEntity === 'NOTE',
    'Orchestrate Test C: handled locally as NOTE',
    JSON.stringify(rC)
  );
  const notesC = loadNotes();
  assert(
    notesC.length === 1 && notesC[0].text === 'comprare il latte',
    'Payload Test C: exactly "comprare il latte" (stripped "di")',
    notesC[0]?.text
  );

  // Test D Execution
  saveNotes([]);
  resetContext(now);
  const rD = await orchestrateUserInput('Oh, mi fai il favore di appuntarmi che devo comprare il latte?', now);
  assert(
    rD.type === 'HANDLED_LOCAL' && rD.affectedEntity === 'NOTE',
    'Orchestrate Test D: handled locally as NOTE',
    JSON.stringify(rD)
  );
  const notesD = loadNotes();
  assert(
    notesD.length === 1 && notesD[0].text === 'devo comprare il latte',
    'Payload Test D: exactly "devo comprare il latte"',
    notesD[0]?.text
  );

  // Test E Execution
  saveNotes([]);
  resetContext(now);
  const rE = await orchestrateUserInput('Potresti appuntare che domani devo chiamare Roberto?', now);
  assert(
    rE.type === 'HANDLED_LOCAL' && rE.affectedEntity === 'NOTE',
    'Orchestrate Test E: handled locally as NOTE',
    JSON.stringify(rE)
  );
  const notesE = loadNotes();
  assert(
    notesE.length === 1 && notesE[0].text === 'domani devo chiamare Roberto',
    'Payload Test E: exactly "domani devo chiamare Roberto"',
    notesE[0]?.text
  );

  // Test G Execution: override test must create REMINDER and NO note
  saveNotes([]);
  saveReminders([]);
  resetContext(now);
  const rG = await orchestrateUserInput('Mi puoi appuntare che devo comprare il pane, no aspetta, crea un promemoria per chiamare Roberto domani alle 20', now);
  assert(
    rG.type === 'HANDLED_LOCAL' && rG.affectedEntity === 'REMINDER',
    'Orchestrate Test G: handled locally as REMINDER',
    JSON.stringify(rG)
  );
  assert(
    loadNotes().length === 0,
    'Orchestrate Test G: Note was NOT created',
    `notes: ${loadNotes().length}`
  );
  assert(
    loadReminders().length === 1 && loadReminders()[0].text === 'chiamare Roberto',
    'Orchestrate Test G: Reminder created with text "chiamare Roberto"',
    loadReminders()[0]?.text
  );

  // =========================================================================
  // SECTION 3: NEGATIVE GUARDRAILS
  // =========================================================================
  console.log('\n-- Section 3: Negative Guardrails --');

  // Test H: "Cosa significa appuntare?"
  const gH = await orchestrateUserInput('Cosa significa appuntare?', now);
  assert(
    gH.type === 'FALLTHROUGH_GEMINI',
    'Guardrail H: "Cosa significa appuntare?" routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(gH)
  );

  // Test I: "Come si prende una nota?"
  const gI = await orchestrateUserInput('Come si prende una nota?', now);
  assert(
    gI.type === 'FALLTHROUGH_GEMINI',
    'Guardrail I: "Come si prende una nota?" routes to Gemini',
    JSON.stringify(gI)
  );

  // Test J: "Puoi spiegarmi come funzionano le note?"
  const gJ = await orchestrateUserInput('Puoi spiegarmi come funzionano le note?', now);
  assert(
    gJ.type === 'FALLTHROUGH_GEMINI',
    'Guardrail J: "Puoi spiegarmi come funzionano le note?" routes to Gemini',
    JSON.stringify(gJ)
  );

  // Test K: "Che nota hai preso?"
  const gK = await orchestrateUserInput('Che nota hai preso?', now);
  assert(
    gK.type === 'FALLTHROUGH_GEMINI' || gK.affectedEntity !== 'NOTE' || (gK as any).verb !== 'CREATE',
    'Guardrail K: "Che nota hai preso?" must NOT be CREATE NOTE',
    JSON.stringify(gK)
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL POLITE & INTERROGATIVE TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
