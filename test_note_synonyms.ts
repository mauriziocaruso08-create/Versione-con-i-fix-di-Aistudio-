import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { resetContext } from './src/services/context/sessionContext';
import { loadNotes, saveNotes } from './src/utils/notesManager';

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
  console.log('=== RUNNING CREATE NOTE SYNONYMS TESTS ===\n');

  const now = 1775000000000;
  resetContext(now);
  saveNotes([]);

  // =========================================================================
  // SECTION 1: CLASSIFICATION OF NEW SYNONYMS
  // =========================================================================
  console.log('-- Section 1: Intent Classification of New Note Synonyms --');

  // 1. "Appunta: comprare il pane"
  const c1 = classifyIntent('Appunta: comprare il pane');
  assert(
    c1.verb === 'CREATE' &&
    c1.entity === 'NOTE' &&
    c1.parameters.text === 'comprare il pane' &&
    c1.isLocalActionCandidate === true,
    'Classify: "Appunta: comprare il pane" -> CREATE NOTE with text "comprare il pane"',
    JSON.stringify(c1)
  );

  // 2. "Appunta comprare il pane"
  const c2 = classifyIntent('Appunta comprare il pane');
  assert(
    c2.verb === 'CREATE' &&
    c2.entity === 'NOTE' &&
    c2.parameters.text === 'comprare il pane' &&
    c2.isLocalActionCandidate === true,
    'Classify: "Appunta comprare il pane" -> CREATE NOTE with text "comprare il pane"',
    JSON.stringify(c2)
  );

  // 3. "Segna una nota: test segna"
  const c3 = classifyIntent('Segna una nota: test segna');
  assert(
    c3.verb === 'CREATE' &&
    c3.entity === 'NOTE' &&
    c3.parameters.text === 'test segna' &&
    c3.isLocalActionCandidate === true,
    'Classify: "Segna una nota: test segna" -> CREATE NOTE with text "test segna"',
    JSON.stringify(c3)
  );

  // 4. "Segna una nota test segna"
  const c4 = classifyIntent('Segna una nota test segna');
  assert(
    c4.verb === 'CREATE' &&
    c4.entity === 'NOTE' &&
    c4.parameters.text === 'test segna' &&
    c4.isLocalActionCandidate === true,
    'Classify: "Segna una nota test segna" -> CREATE NOTE with text "test segna"',
    JSON.stringify(c4)
  );

  // =========================================================================
  // SECTION 2: CONVERSATIONAL-PREFIX VARIANTS
  // =========================================================================
  console.log('\n-- Section 2: Conversational-Prefix Variants --');

  // "Senti, appunta: comprare il pane"
  const cPref1 = classifyIntent('Senti, appunta: comprare il pane');
  assert(
    cPref1.verb === 'CREATE' &&
    cPref1.entity === 'NOTE' &&
    cPref1.parameters.text === 'comprare il pane',
    'Classify: "Senti, appunta: comprare il pane" -> CREATE NOTE text "comprare il pane"',
    JSON.stringify(cPref1)
  );

  // "Ok, allora, segna una nota: test"
  const cPref2 = classifyIntent('Ok, allora, segna una nota: test');
  assert(
    cPref2.verb === 'CREATE' &&
    cPref2.entity === 'NOTE' &&
    cPref2.parameters.text === 'test',
    'Classify: "Ok, allora, segna una nota: test" -> CREATE NOTE text "test"',
    JSON.stringify(cPref2)
  );

  // =========================================================================
  // SECTION 3: END-TO-END EXECUTION & PAYLOAD SANITIZATION
  // =========================================================================
  console.log('\n-- Section 3: End-to-End Execution & Payload Sanitization --');

  // Execute: "Appunta: comprare il pane"
  saveNotes([]);
  resetContext(now);
  const r1 = await orchestrateUserInput('Appunta: comprare il pane', now);
  assert(
    r1.type === 'HANDLED_LOCAL' && r1.dataAffected === true,
    'Orchestrate: "Appunta: comprare il pane" -> HANDLED_LOCAL (NOT Gemini)',
    JSON.stringify(r1)
  );
  const notes1 = loadNotes();
  assert(
    notes1.length === 1 && notes1[0].text === 'comprare il pane',
    'Payload Sanitization: saved note text is exactly "comprare il pane" (no "Appunta:", no ":")',
    notes1[0]?.text
  );

  // Execute: "Appunta comprare il pane"
  saveNotes([]);
  resetContext(now);
  const r2 = await orchestrateUserInput('Appunta comprare il pane', now);
  assert(
    r2.type === 'HANDLED_LOCAL' && r2.dataAffected === true,
    'Orchestrate: "Appunta comprare il pane" -> HANDLED_LOCAL',
    JSON.stringify(r2)
  );
  const notes2 = loadNotes();
  assert(
    notes2.length === 1 && notes2[0].text === 'comprare il pane',
    'Payload Sanitization: saved note text is exactly "comprare il pane"',
    notes2[0]?.text
  );

  // Execute: "Segna una nota: test segna"
  saveNotes([]);
  resetContext(now);
  const r3 = await orchestrateUserInput('Segna una nota: test segna', now);
  assert(
    r3.type === 'HANDLED_LOCAL' && r3.dataAffected === true,
    'Orchestrate: "Segna una nota: test segna" -> HANDLED_LOCAL',
    JSON.stringify(r3)
  );
  const notes3 = loadNotes();
  assert(
    notes3.length === 1 && notes3[0].text === 'test segna',
    'Payload Sanitization: saved note text is exactly "test segna" (no "Segna una nota:")',
    notes3[0]?.text
  );

  // Execute: "Segna una nota test segna"
  saveNotes([]);
  resetContext(now);
  const r4 = await orchestrateUserInput('Segna una nota test segna', now);
  assert(
    r4.type === 'HANDLED_LOCAL' && r4.dataAffected === true,
    'Orchestrate: "Segna una nota test segna" -> HANDLED_LOCAL',
    JSON.stringify(r4)
  );
  const notes4 = loadNotes();
  assert(
    notes4.length === 1 && notes4[0].text === 'test segna',
    'Payload Sanitization: saved note text is exactly "test segna"',
    notes4[0]?.text
  );

  // Execute wrapped: "Senti, appunta: comprare il pane"
  saveNotes([]);
  resetContext(now);
  const r5 = await orchestrateUserInput('Senti, appunta: comprare il pane', now);
  assert(
    r5.type === 'HANDLED_LOCAL' && r5.dataAffected === true,
    'Orchestrate wrapped: "Senti, appunta: comprare il pane" -> HANDLED_LOCAL',
    JSON.stringify(r5)
  );
  const notes5 = loadNotes();
  assert(
    notes5.length === 1 && notes5[0].text === 'comprare il pane',
    'Payload Sanitization wrapped: text is "comprare il pane"',
    notes5[0]?.text
  );

  // =========================================================================
  // SECTION 4: EXISTING FORMS REGRESSION
  // =========================================================================
  console.log('\n-- Section 4: Existing Forms Regression --');

  // "Crea una nota: comprare il latte"
  saveNotes([]);
  resetContext(now);
  const ex1 = await orchestrateUserInput('Crea una nota: comprare il latte', now);
  assert(
    ex1.type === 'HANDLED_LOCAL' && ex1.dataAffected === true,
    'Regression: "Crea una nota: comprare il latte" remains HANDLED_LOCAL',
    JSON.stringify(ex1)
  );
  const notesEx1 = loadNotes();
  assert(
    notesEx1.length === 1 && notesEx1[0].text === 'comprare il latte',
    'Existing text is "comprare il latte"',
    notesEx1[0]?.text
  );

  // "Prendi nota: comprare il latte"
  saveNotes([]);
  resetContext(now);
  const ex2 = await orchestrateUserInput('Prendi nota: comprare il latte', now);
  assert(
    ex2.type === 'HANDLED_LOCAL' && ex2.dataAffected === true,
    'Regression: "Prendi nota: comprare il latte" remains HANDLED_LOCAL',
    JSON.stringify(ex2)
  );
  const notesEx2 = loadNotes();
  assert(
    notesEx2.length === 1 && notesEx2[0].text === 'comprare il latte',
    'Existing text is "comprare il latte"',
    notesEx2[0]?.text
  );

  // "Annota: comprare il caffè"
  saveNotes([]);
  resetContext(now);
  const ex3 = await orchestrateUserInput('Annota: comprare il caffè', now);
  assert(
    ex3.type === 'HANDLED_LOCAL' && ex3.dataAffected === true,
    'Regression: "Annota: comprare il caffè" remains HANDLED_LOCAL',
    JSON.stringify(ex3)
  );
  const notesEx3 = loadNotes();
  assert(
    notesEx3.length === 1 && notesEx3[0].text === 'comprare il caffè',
    'Existing text is "comprare il caffè"',
    notesEx3[0]?.text
  );

  // =========================================================================
  // SECTION 5: COGNITIVE & CONVERSATIONAL GUARDRAILS
  // =========================================================================
  console.log('\n-- Section 5: Cognitive & Conversational Guardrails --');

  // "Cos'è una nota?" -> Gemini
  const g1 = await orchestrateUserInput("Cos'è una nota?", now);
  assert(
    g1.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Cos\'è una nota?" routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(g1)
  );

  // "Cosa significa appunta?" -> Gemini
  const g2 = await orchestrateUserInput('Cosa significa appunta?', now);
  assert(
    g2.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Cosa significa appunta?" routes to Gemini',
    JSON.stringify(g2)
  );

  // "Chi era Napoleone?" -> Gemini
  const g3 = await orchestrateUserInput('Chi era Napoleone?', now);
  assert(
    g3.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Chi era Napoleone?" routes to Gemini',
    JSON.stringify(g3)
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL CREATE NOTE SYNONYMS TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
