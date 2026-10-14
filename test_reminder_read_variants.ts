import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { resetContext } from './src/services/context/sessionContext';
import { saveReminders } from './src/utils/reminderManager';
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
  console.log('=== RUNNING REMINDER READ WITH POSSESSIVE VARIANTS TESTS ===\n');

  const now = 1775000000000;
  resetContext(now);
  saveUserMemory({
    userName: 'Maurizio',
    userCity: 'Malta',
    preferences: ['Risposte concise'],
    interests: ['Intelligenza Artificiale'],
    projects: ['MAIA'],
    notes: [],
  });

  // Seed reminders
  saveReminders([
    {
      id: 'rem-1',
      text: 'comprare il latte',
      dueAt: new Date(now + 3600000).toISOString(),
      completed: false,
      createdAt: new Date(now).toISOString(),
    },
    {
      id: 'rem-2',
      text: 'chiamare il medico',
      dueAt: new Date(now + 7200000).toISOString(),
      completed: false,
      createdAt: new Date(now).toISOString(),
    },
  ]);

  // =========================================================================
  // 1. CLASSIFICATION CHECKS
  // =========================================================================
  console.log('-- Section 1: Intent Classification of Possessive Variations --');

  // 1a. "Fammi vedere i miei promemoria"
  const c1 = classifyIntent('Fammi vedere i miei promemoria');
  assert(
    c1.verb === 'READ' && c1.entity === 'REMINDER' && c1.isLocalActionCandidate === true,
    'Classify: "Fammi vedere i miei promemoria" -> READ REMINDER',
    JSON.stringify(c1)
  );

  // 1b. "Mostrami i miei promemoria"
  const c2 = classifyIntent('Mostrami i miei promemoria');
  assert(
    c2.verb === 'READ' && c2.entity === 'REMINDER' && c2.isLocalActionCandidate === true,
    'Classify: "Mostrami i miei promemoria" -> READ REMINDER',
    JSON.stringify(c2)
  );

  // 1c. "Fammi vedere il mio promemoria"
  const c3 = classifyIntent('Fammi vedere il mio promemoria');
  assert(
    c3.verb === 'READ' && c3.entity === 'REMINDER' && c3.isLocalActionCandidate === true,
    'Classify: "Fammi vedere il mio promemoria" -> READ REMINDER (singular)',
    JSON.stringify(c3)
  );

  // 1d. "Mostra i miei promemoria"
  const c4 = classifyIntent('Mostra i miei promemoria');
  assert(
    c4.verb === 'READ' && c4.entity === 'REMINDER' && c4.isLocalActionCandidate === true,
    'Classify: "Mostra i miei promemoria" -> READ REMINDER',
    JSON.stringify(c4)
  );

  // 1e. "Mostrami il mio promemoria"
  const c5 = classifyIntent('Mostrami il mio promemoria');
  assert(
    c5.verb === 'READ' && c5.entity === 'REMINDER' && c5.isLocalActionCandidate === true,
    'Classify: "Mostrami il mio promemoria" -> READ REMINDER',
    JSON.stringify(c5)
  );

  // 1f. "Voglio vedere i miei promemoria"
  const c6 = classifyIntent('Voglio vedere i miei promemoria');
  assert(
    c6.verb === 'READ' && c6.entity === 'REMINDER' && c6.isLocalActionCandidate === true,
    'Classify: "Voglio vedere i miei promemoria" -> READ REMINDER',
    JSON.stringify(c6)
  );

  // 1g. "Quali sono i miei promemoria"
  const c7 = classifyIntent('Quali sono i miei promemoria');
  assert(
    c7.verb === 'READ' && c7.entity === 'REMINDER' && c7.isLocalActionCandidate === true,
    'Classify: "Quali sono i miei promemoria" -> READ REMINDER',
    JSON.stringify(c7)
  );

  // 1h. "Mostra i promemoria" (baseline unwrapped)
  const c8 = classifyIntent('Mostra i promemoria');
  assert(
    c8.verb === 'READ' && c8.entity === 'REMINDER' && c8.isLocalActionCandidate === true,
    'Classify: "Mostra i promemoria" -> READ REMINDER (baseline)',
    JSON.stringify(c8)
  );

  // 1i. "Fammi vedere i promemoria" (baseline unwrapped)
  const c9 = classifyIntent('Fammi vedere i promemoria');
  assert(
    c9.verb === 'READ' && c9.entity === 'REMINDER' && c9.isLocalActionCandidate === true,
    'Classify: "Fammi vedere i promemoria" -> READ REMINDER (baseline)',
    JSON.stringify(c9)
  );

  const detailIntent = classifyIntent('Mostrami i dettagli del promemoria per chiamare il medico');
  assert(
    Boolean(detailIntent.verb === 'READ' && detailIntent.entity === 'REMINDER' && detailIntent.target.rawReference?.includes('chiamare il medico')),
    'Classify: reminder details query targets the requested reminder',
    JSON.stringify(detailIntent)
  );

  // =========================================================================
  // 2. END-TO-END ORCHESTRATION OF POSSESSIVE REMINDER READS
  // =========================================================================
  console.log('\n-- Section 2: End-to-End Orchestration of Possessive Reminder Reads --');

  // "Fammi vedere i miei promemoria"
  const r1 = await orchestrateUserInput('Fammi vedere i miei promemoria', now);
  assert(
    r1.type === 'HANDLED_LOCAL' &&
    r1.feedbackText?.includes('Ecco i tuoi promemoria:') === true &&
    r1.feedbackText?.includes('comprare il latte') === true,
    'Orchestrate: "Fammi vedere i miei promemoria" -> HANDLED_LOCAL (NOT Gemini)',
    JSON.stringify(r1)
  );

  // Detail requests should return one matched item, not the full reminder list.
  const detailRead = await orchestrateUserInput('Mostrami i dettagli del promemoria per chiamare il medico', now);
  assert(
    detailRead.type === 'HANDLED_LOCAL' &&
    detailRead.feedbackText?.includes('chiamare il medico') === true &&
    detailRead.feedbackText?.includes('comprare il latte') === false,
    'Orchestrate: specific reminder details return only the requested item',
    JSON.stringify(detailRead)
  );

  // "Mostrami i miei promemoria"
  const r2 = await orchestrateUserInput('Mostrami i miei promemoria', now);
  assert(
    r2.type === 'HANDLED_LOCAL' &&
    r2.feedbackText?.includes('Ecco i tuoi promemoria:') === true,
    'Orchestrate: "Mostrami i miei promemoria" -> HANDLED_LOCAL (NOT Gemini)',
    JSON.stringify(r2)
  );

  // "Fammi vedere il mio promemoria" with multiple reminders
  const r3 = await orchestrateUserInput('Fammi vedere il mio promemoria', now);
  assert(
    r3.type === 'HANDLED_LOCAL' &&
    r3.feedbackText?.includes('promemoria') === true,
    'Orchestrate: "Fammi vedere il mio promemoria" (plural dataset) -> HANDLED_LOCAL',
    JSON.stringify(r3)
  );

  // "Voglio vedere i miei promemoria"
  const r4 = await orchestrateUserInput('Voglio vedere i miei promemoria', now);
  assert(
    r4.type === 'HANDLED_LOCAL' &&
    r4.feedbackText?.includes('Ecco i tuoi promemoria:') === true,
    'Orchestrate: "Voglio vedere i miei promemoria" -> HANDLED_LOCAL',
    JSON.stringify(r4)
  );

  // Singular resolution with exactly 1 reminder
  saveReminders([
    {
      id: 'rem-only',
      text: 'ritirare pacco in posta',
      dueAt: new Date(now + 3600000).toISOString(),
      completed: false,
      createdAt: new Date(now).toISOString(),
    },
  ]);

  const rSingular = await orchestrateUserInput('Fammi vedere il mio promemoria', now);
  assert(
    rSingular.type === 'HANDLED_LOCAL' &&
    /Ecco (?:il tuo promemoria|il promemoria):/.test(rSingular.feedbackText || '') &&
    rSingular.feedbackText?.includes('ritirare pacco in posta') === true,
    'Orchestrate singular: exactly 1 reminder accepts singular wording',
    JSON.stringify(rSingular)
  );

  // =========================================================================
  // 3. REGRESSION & CONTROL TESTS
  // =========================================================================
  console.log('\n-- Section 3: Regression & Control Tests --');

  // Baseline 1: "Mostra i promemoria"
  const b1 = await orchestrateUserInput('Mostra i promemoria', now);
  assert(
    b1.type === 'HANDLED_LOCAL',
    'Baseline: "Mostra i promemoria" remains HANDLED_LOCAL',
    JSON.stringify(b1)
  );

  // Baseline 2: "Fammi vedere i promemoria"
  const b2 = await orchestrateUserInput('Fammi vedere i promemoria', now);
  assert(
    b2.type === 'HANDLED_LOCAL',
    'Baseline: "Fammi vedere i promemoria" remains HANDLED_LOCAL',
    JSON.stringify(b2)
  );

  // Memory control: "Cosa ricordi di me?"
  const m1 = await orchestrateUserInput('Cosa ricordi di me?', now);
  assert(
    m1.type === 'HANDLED_LOCAL' &&
    m1.affectedEntity === 'MEMORY' &&
    m1.sourceLabel?.includes('memory') === true,
    'Memory Control: "Cosa ricordi di me?" remains MEMORY read (NOT affected)',
    JSON.stringify(m1)
  );

  // Cognitive questions still routed to Gemini
  const g1 = await orchestrateUserInput('Chi era Napoleone?', now);
  assert(
    g1.type === 'FALLTHROUGH_GEMINI',
    'Cognitive: "Chi era Napoleone?" still routes to Gemini (FALLTHROUGH_GEMINI)',
    JSON.stringify(g1)
  );

  const g2 = await orchestrateUserInput('Spiegami la teoria della relatività', now);
  assert(
    g2.type === 'FALLTHROUGH_GEMINI',
    'Cognitive: "Spiegami la teoria della relatività" routes to Gemini',
    JSON.stringify(g2)
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL REMINDER READ TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
