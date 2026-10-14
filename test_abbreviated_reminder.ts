import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { resetContext } from './src/services/context/sessionContext';
import { loadReminders, saveReminders } from './src/utils/reminderManager';
import { saveUserMemory } from './src/services/router/actionExecutor';

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
  console.log('=== RUNNING ABBREVIATED CREATE REMINDER TESTS ===\n');

  const now = 1775000000000;
  resetContext(now);
  saveReminders([]);
  saveUserMemory({
    userName: 'Maurizio',
    userCity: 'Malta',
    preferences: ['Risposte concise'],
    interests: ['Intelligenza Artificiale'],
    projects: ['MAIA'],
    notes: [],
  });

  // =========================================================================
  // SECTION 1: INTENT CLASSIFICATION OF ABBREVIATED FORMS
  // =========================================================================
  console.log('-- Section 1: Intent Classification of Abbreviated Forms --');

  // 1. "promemoria: chiamare Roberto"
  const c1 = classifyIntent('promemoria: chiamare Roberto');
  assert(
    c1.verb === 'CREATE' &&
    c1.entity === 'REMINDER' &&
    c1.parameters.text === 'chiamare Roberto' &&
    c1.isLocalActionCandidate === true,
    'Classify: "promemoria: chiamare Roberto" -> CREATE REMINDER with text "chiamare Roberto"',
    JSON.stringify(c1)
  );

  // 2. "promemoria chiamare Roberto"
  const c2 = classifyIntent('promemoria chiamare Roberto');
  assert(
    c2.verb === 'CREATE' &&
    c2.entity === 'REMINDER' &&
    c2.parameters.text === 'chiamare Roberto' &&
    c2.isLocalActionCandidate === true,
    'Classify: "promemoria chiamare Roberto" -> CREATE REMINDER with text "chiamare Roberto"',
    JSON.stringify(c2)
  );

  // 3. "promemoria: chiamare Roberto domani alle 20"
  const c3 = classifyIntent('promemoria: chiamare Roberto domani alle 20');
  assert(
    c3.verb === 'CREATE' &&
    c3.entity === 'REMINDER' &&
    c3.parameters.text === 'chiamare Roberto' &&
    c3.parameters.dueAt !== undefined &&
    new Date(c3.parameters.dueAt).getHours() === 20,
    'Classify: "promemoria: chiamare Roberto domani alle 20" -> text "chiamare Roberto", dueAt at 20:00',
    JSON.stringify(c3)
  );

  // 4. "promemoria chiamare Roberto domani alle 20"
  const c4 = classifyIntent('promemoria chiamare Roberto domani alle 20');
  assert(
    c4.verb === 'CREATE' &&
    c4.entity === 'REMINDER' &&
    c4.parameters.text === 'chiamare Roberto' &&
    c4.parameters.dueAt !== undefined &&
    new Date(c4.parameters.dueAt).getHours() === 20,
    'Classify: "promemoria chiamare Roberto domani alle 20" -> text "chiamare Roberto", dueAt at 20:00',
    JSON.stringify(c4)
  );

  // 5. "promemoria per chiamare Roberto domani alle 20"
  const c5 = classifyIntent('promemoria per chiamare Roberto domani alle 20');
  assert(
    c5.verb === 'CREATE' &&
    c5.entity === 'REMINDER' &&
    c5.parameters.text === 'chiamare Roberto' &&
    c5.parameters.dueAt !== undefined &&
    new Date(c5.parameters.dueAt).getHours() === 20,
    'Classify: "promemoria per chiamare Roberto domani alle 20" -> text "chiamare Roberto", dueAt at 20:00',
    JSON.stringify(c5)
  );

  // 6. "memo: chiamare Roberto"
  const c6 = classifyIntent('memo: chiamare Roberto');
  assert(
    c6.verb === 'CREATE' &&
    c6.entity === 'REMINDER' &&
    c6.parameters.text === 'chiamare Roberto',
    'Classify: "memo: chiamare Roberto" -> CREATE REMINDER with text "chiamare Roberto"',
    JSON.stringify(c6)
  );

  // 7. "reminder: chiamare Roberto"
  const c7 = classifyIntent('reminder: chiamare Roberto');
  assert(
    c7.verb === 'CREATE' &&
    c7.entity === 'REMINDER' &&
    c7.parameters.text === 'chiamare Roberto',
    'Classify: "reminder: chiamare Roberto" -> CREATE REMINDER with text "chiamare Roberto"',
    JSON.stringify(c7)
  );

  // =========================================================================
  // SECTION 2: END-TO-END ORCHESTRATION & PAYLOAD SANITIZATION
  // =========================================================================
  console.log('\n-- Section 2: End-to-End Orchestration & Payload Sanitization --');

  // Test e2e 1: an abbreviated reminder without a time must ask for one,
  // rather than inventing a due date or persisting an incomplete reminder.
  saveReminders([]);
  resetContext(now);
  const r1 = await orchestrateUserInput('promemoria: chiamare Roberto', now);
  assert(
    r1.type === 'HANDLED_LOCAL' && r1.dataAffected === false,
    'Orchestrate: no-time reminder is handled locally and asks for a time',
    JSON.stringify(r1)
  );
  assert(
    /quando|ora/i.test(r1.feedbackText || '') && loadReminders().length === 0,
    'No-time reminder must ask for a time and must not be persisted',
    JSON.stringify({ feedbackText: r1.feedbackText, reminders: loadReminders() })
  );

  // Test e2e 2: the same safe behavior applies without the colon.
  saveReminders([]);
  resetContext(now);
  const r2 = await orchestrateUserInput('promemoria chiamare Roberto', now);
  assert(
    r2.type === 'HANDLED_LOCAL' && r2.dataAffected === false,
    'Orchestrate: abbreviated no-time reminder is handled locally and asks for a time',
    JSON.stringify(r2)
  );
  assert(
    /quando|ora/i.test(r2.feedbackText || '') && loadReminders().length === 0,
    'Abbreviated no-time reminder must not be persisted before its time is clarified',
    JSON.stringify({ feedbackText: r2.feedbackText, reminders: loadReminders() })
  );

  // Test e2e 3: "promemoria: chiamare Roberto domani alle 20"
  saveReminders([]);
  resetContext(now);
  const r3 = await orchestrateUserInput('promemoria: chiamare Roberto domani alle 20', now);
  assert(
    r3.type === 'HANDLED_LOCAL' && r3.dataAffected === true,
    'Orchestrate: "promemoria: chiamare Roberto domani alle 20" -> HANDLED_LOCAL',
    JSON.stringify(r3)
  );
  const rems3 = loadReminders();
  assert(
    rems3.length === 1 &&
    rems3[0].text === 'chiamare Roberto' &&
    new Date(rems3[0].dueAt).getHours() === 20,
    'Date/Time Extraction: saved reminder text is "chiamare Roberto" and hour is 20:00',
    `text: "${rems3[0]?.text}", dueAt: "${rems3[0]?.dueAt}"`
  );

  // Test e2e 4: "promemoria chiamare Roberto domani alle 20"
  saveReminders([]);
  resetContext(now);
  const r4 = await orchestrateUserInput('promemoria chiamare Roberto domani alle 20', now);
  assert(
    r4.type === 'HANDLED_LOCAL' && r4.dataAffected === true,
    'Orchestrate: "promemoria chiamare Roberto domani alle 20" -> HANDLED_LOCAL',
    JSON.stringify(r4)
  );
  const rems4 = loadReminders();
  assert(
    rems4.length === 1 &&
    rems4[0].text === 'chiamare Roberto' &&
    new Date(rems4[0].dueAt).getHours() === 20,
    'Date/Time Extraction: text is "chiamare Roberto" and hour is 20:00 without colon',
    `text: "${rems4[0]?.text}", dueAt: "${rems4[0]?.dueAt}"`
  );

  // =========================================================================
  // SECTION 3: REGRESSION OF EXISTING COMMANDS
  // =========================================================================
  console.log('\n-- Section 3: Regression of Existing Commands --');

  // Full-form 1: "Crea un promemoria per chiamare Roberto domani alle 20"
  saveReminders([]);
  resetContext(now);
  const f1 = await orchestrateUserInput('Crea un promemoria per chiamare Roberto domani alle 20', now);
  assert(
    f1.type === 'HANDLED_LOCAL' && f1.dataAffected === true,
    'Regression: "Crea un promemoria per chiamare Roberto domani alle 20" remains HANDLED_LOCAL',
    JSON.stringify(f1)
  );
  const remsF1 = loadReminders();
  assert(
    remsF1.length === 1 &&
    remsF1[0].text === 'chiamare Roberto' &&
    new Date(remsF1[0].dueAt).getHours() === 20,
    'Full-form text is "chiamare Roberto" and due at 20:00',
    remsF1[0]?.text
  );

  // Full-form 2: "Ricordami di chiamare Roberto domani alle 20"
  saveReminders([]);
  resetContext(now);
  const f2 = await orchestrateUserInput('Ricordami di chiamare Roberto domani alle 20', now);
  assert(
    f2.type === 'HANDLED_LOCAL' && f2.dataAffected === true,
    'Regression: "Ricordami di chiamare Roberto domani alle 20" remains HANDLED_LOCAL',
    JSON.stringify(f2)
  );
  const remsF2 = loadReminders();
  assert(
    remsF2.length === 1 &&
    remsF2[0].text === 'chiamare Roberto' &&
    new Date(remsF2[0].dueAt).getHours() === 20,
    'Full-form "Ricordami di..." text is "chiamare Roberto" and due at 20:00',
    remsF2[0]?.text
  );

  // Memory regression: "Ricordati che mi piace il caffè"
  const m1 = await orchestrateUserInput('Ricordati che mi piace il caffè', now);
  assert(
    m1.type === 'HANDLED_LOCAL' && m1.affectedEntity === 'MEMORY',
    'Regression: "Ricordati che mi piace il caffè" remains MEMORY create',
    JSON.stringify(m1)
  );

  // Memory control: "Cosa ricordi di me?"
  const m2 = await orchestrateUserInput('Cosa ricordi di me?', now);
  assert(
    m2.type === 'HANDLED_LOCAL' && m2.affectedEntity === 'MEMORY',
    'Regression: "Cosa ricordi di me?" remains MEMORY read',
    JSON.stringify(m2)
  );

  // =========================================================================
  // SECTION 4: CONVERSATIONAL & COGNITIVE GUARDRAILS
  // =========================================================================
  console.log('\n-- Section 4: Conversational & Cognitive Guardrails --');

  // "Cos'è un promemoria?" -> Gemini
  const g1 = await orchestrateUserInput("Cos'è un promemoria?", now);
  assert(
    g1.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Cos\'è un promemoria?" routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(g1)
  );

  // "Cosa significa promemoria?" -> Gemini
  const g2 = await orchestrateUserInput('Cosa significa promemoria?', now);
  assert(
    g2.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Cosa significa promemoria?" routes to Gemini',
    JSON.stringify(g2)
  );

  // "Spiegami come funziona un promemoria" -> Gemini
  const g3 = await orchestrateUserInput('Spiegami come funziona un promemoria', now);
  assert(
    g3.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Spiegami come funziona un promemoria" routes to Gemini',
    JSON.stringify(g3)
  );

  // General question: "Chi era Napoleone?" -> Gemini
  const g4 = await orchestrateUserInput('Chi era Napoleone?', now);
  assert(
    g4.type === 'FALLTHROUGH_GEMINI',
    'Guardrail: "Chi era Napoleone?" routes to Gemini',
    JSON.stringify(g4)
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL ABBREVIATED CREATE REMINDER TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
