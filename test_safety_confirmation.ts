import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { resetContext, getContext } from './src/services/context/sessionContext';
import { loadNotes, saveNotes } from './src/utils/notesManager';
import { loadReminders, saveReminders } from './src/utils/reminderManager';
import { loadUserMemory, saveUserMemory } from './src/services/router/actionExecutor';
import {
  evaluateSafety,
  getRiskCategory,
  isDestructiveAction,
} from './src/services/router/safetyGuard';
import {
  createPendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  resolveConfirmationReply,
  setConfirmationTimeoutMs,
  resetConfirmationTimeoutMs,
} from './src/services/router/confirmationManager';
import { SemanticIntent } from './src/types/context';
import { TargetResolutionResult } from './src/services/router/targetResolver';

// Mock localStorage for node environment
const storage: Record<string, string> = {};
const mockStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = value;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    for (const k in storage) delete storage[k];
  },
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
  console.log('=== RUNNING SAFETY & CONFIRMATION ADVANCED TESTS (FASE 6F) ===\n');
  const now = 1780000000000;

  // =========================================================================
  // TEST A: DELETE richiede conferma
  // =========================================================================
  console.log('-- Test A: DELETE requires confirmation --');
  saveNotes([{ id: 'n1', text: 'comprare latte', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  const resA = await orchestrateUserInput('Cancella la nota comprare latte', now);
  assert(
    resA.type === 'CONFIRMATION_REQUIRED',
    'Test A: "Cancella la nota comprare latte" requires confirmation',
    JSON.stringify(resA)
  );
  assert(
    Boolean(resA.feedbackText?.includes('Sei sicuro') && resA.feedbackText?.includes('irreversibile')),
    'Test A: Confirmation prompt is explicit and warns of irreversibility',
    resA.feedbackText
  );
  assert(
    loadNotes().length === 1,
    'Test A: Data is NOT modified before confirmation'
  );
  assert(
    getPendingConfirmation(now) !== null,
    'Test A: Pending confirmation is stored in ConfirmationManager'
  );

  // =========================================================================
  // TEST B: DELETE confermato -> elimina correttamente
  // =========================================================================
  console.log('\n-- Test B: DELETE confirmed -> deletes correctly --');
  const resB = await orchestrateUserInput('sì', now + 1000);
  assert(
    resB.type === 'HANDLED_LOCAL' && resB.dataAffected === true,
    'Test B: Confirmation "sì" executes the deletion locally',
    JSON.stringify(resB)
  );
  assert(
    loadNotes().length === 0,
    'Test B verified: Note was removed from storage after confirmation'
  );
  assert(
    getPendingConfirmation(now + 1000) === null,
    'Test B: Pending confirmation is cleared after execution'
  );

  // =========================================================================
  // TEST C: DELETE rifiutato -> nessuna modifica
  // =========================================================================
  console.log('\n-- Test C: DELETE rejected -> no modification --');
  saveNotes([{ id: 'n2', text: 'pagare bolletta', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella la nota pagare bolletta', now);
  const resC = await orchestrateUserInput('no', now + 1000);
  assert(
    resC.type === 'HANDLED_LOCAL' && Boolean(resC.feedbackText?.includes('annullata')),
    'Test C: "no" cancels the operation',
    resC.feedbackText
  );
  assert(
    loadNotes().length === 1 && loadNotes()[0].text === 'pagare bolletta',
    'Test C verified: Note was NOT deleted after rejection'
  );
  assert(
    getPendingConfirmation(now + 1000) === null,
    'Test C: Pending confirmation cleared after cancellation'
  );

  // =========================================================================
  // TEST D: DELETE_ALL richiede conferma
  // =========================================================================
  console.log('\n-- Test D: DELETE_ALL requires confirmation --');
  saveNotes([
    { id: 'n3a', text: 'nota 1', createdAt: new Date(now).toISOString() },
    { id: 'n3b', text: 'nota 2', createdAt: new Date(now).toISOString() },
  ]);
  resetContext(now);
  clearPendingConfirmation();

  const resD = await orchestrateUserInput('Cancella tutte le note', now);
  assert(
    resD.type === 'CONFIRMATION_REQUIRED',
    'Test D: "Cancella tutte le note" requires explicit confirmation',
    JSON.stringify(resD)
  );
  assert(
    Boolean(resD.feedbackText?.includes('tutte le note')),
    'Test D: Prompt mentions deleting all notes',
    resD.feedbackText
  );
  assert(
    loadNotes().length === 2,
    'Test D: No notes deleted before confirmation'
  );

  // =========================================================================
  // TEST E: DELETE_ALL confermato -> elimina tutto
  // =========================================================================
  console.log('\n-- Test E: DELETE_ALL confirmed -> deletes all --');
  const resE = await orchestrateUserInput('confermo', now + 1000);
  assert(
    resE.type === 'HANDLED_LOCAL' && resE.dataAffected === true,
    'Test E: "confermo" executes DELETE_ALL',
    JSON.stringify(resE)
  );
  assert(
    loadNotes().length === 0,
    'Test E verified: All notes deleted from storage'
  );
  assert(
    getPendingConfirmation(now + 1000) === null,
    'Test E: Pending confirmation cleared after execution'
  );

  // =========================================================================
  // TEST F: Conferma ambigua -> non esegue, mantiene pending
  // =========================================================================
  console.log('\n-- Test F: Ambiguous reply -> does not execute, keeps pending --');
  saveReminders([
    {
      id: 'r1',
      text: 'chiamare dottore',
      dueAt: new Date(now + 3600000).toISOString(),
      completed: false,
      createdAt: new Date(now).toISOString(),
    },
  ]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella il promemoria chiamare dottore', now);
  const resF1 = await orchestrateUserInput('forse', now + 1000);
  assert(
    resF1.type === 'HANDLED_LOCAL' && resF1.dataAffected === false,
    'Test F (1/3): "forse" does not execute deletion',
    JSON.stringify(resF1)
  );
  assert(
    Boolean(resF1.feedbackText?.includes('Risposta non chiara') || resF1.feedbackText?.includes('confermare')),
    'Test F (1/3): Informs user that reply was unclear',
    resF1.feedbackText
  );
  assert(
    loadReminders().length === 1,
    'Test F (1/3): Reminder still intact in storage'
  );
  assert(
    getPendingConfirmation(now + 1000) !== null,
    'Test F (1/3): Pending confirmation remains active after "forse"'
  );

  // Test "sì ma spiegami"
  const resF2 = await orchestrateUserInput('sì ma spiegami prima', now + 2000);
  assert(
    resF2.dataAffected === false && loadReminders().length === 1,
    'Test F (2/3): "sì ma spiegami prima" does not execute deletion'
  );
  assert(
    getPendingConfirmation(now + 2000) !== null,
    'Test F (2/3): Pending confirmation remains active'
  );

  // Clear with explicit "no"
  const resF3 = await orchestrateUserInput('no', now + 3000);
  assert(
    Boolean(resF3.feedbackText?.includes('annullata')),
    'Test F (3/3): Explicit "no" successfully cancels after ambiguous attempts'
  );

  // =========================================================================
  // TEST G: Annulla / Lascia perdere / Cancella
  // =========================================================================
  console.log('\n-- Test G: Cancellation synonyms --');
  saveReminders([
    {
      id: 'r2',
      text: 'comprare pane',
      dueAt: new Date(now + 3600000).toISOString(),
      completed: false,
      createdAt: new Date(now).toISOString(),
    },
  ]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella il promemoria comprare pane', now);
  const resG1 = await orchestrateUserInput('lascia perdere', now + 1000);
  assert(
    Boolean(resG1.feedbackText?.includes('annullata')) && loadReminders().length === 1,
    'Test G: "lascia perdere" cancels without modifying data'
  );
  assert(
    getPendingConfirmation(now + 1000) === null,
    'Test G: Pending confirmation cleared after "lascia perdere"'
  );

  // =========================================================================
  // TEST H: Timeout -> pending invalido
  // =========================================================================
  console.log('\n-- Test H: Timeout invalidation (2 minutes) --');
  saveNotes([{ id: 'nh', text: 'nota timeout', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella la nota nota timeout', now);
  // 2 minutes + 1 ms later
  const resH = await orchestrateUserInput('sì', now + 120001);
  assert(
    resH.type === 'HANDLED_LOCAL' && Boolean(resH.feedbackText?.includes('scaduta')),
    'Test H: Reply after 2 minutes reports confirmation expired',
    resH.feedbackText
  );
  assert(
    loadNotes().length === 1,
    'Test H verified: Note was NOT deleted after timeout expired'
  );
  assert(
    getPendingConfirmation(now + 120001) === null,
    'Test H: Expired confirmation was cleared'
  );

  // =========================================================================
  // TEST I: Conferma usata due volte -> seconda volta non esegue
  // =========================================================================
  console.log('\n-- Test I: One-shot confirmation reuse guard --');
  saveNotes([{ id: 'ni', text: 'nota monouso', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella la nota nota monouso', now);
  // First confirmation
  const resI1 = await orchestrateUserInput('sì', now + 1000);
  assert(
    resI1.dataAffected === true && loadNotes().length === 0,
    'Test I: First "sì" executes deletion'
  );

  // Second confirmation immediately after
  const resI2 = await orchestrateUserInput('sì', now + 2000);
  assert(
    !resI2.dataAffected,
    'Test I: Second "sì" does NOT execute any deletion (one-shot guarantee)',
    JSON.stringify(resI2)
  );

  // =========================================================================
  // TEST J: Context switch -> vecchio pending invalidato
  // =========================================================================
  console.log('\n-- Test J: Context switch invalidates pending confirmation --');
  saveNotes([{ id: 'nj', text: 'nota protetta', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella la nota nota protetta', now);
  assert(
    getPendingConfirmation(now) !== null,
    'Test J: Confirmation pending for nota protetta'
  );

  // User switches context by asking a cognitive question
  const resJ1 = await orchestrateUserInput('Chi era Napoleone?', now + 1000);
  assert(
    resJ1.type === 'FALLTHROUGH_GEMINI',
    'Test J: Unrelated question routes to Gemini',
    JSON.stringify(resJ1)
  );
  assert(
    getPendingConfirmation(now + 1000) === null,
    'Test J: Pending confirmation was invalidated on context switch'
  );

  // Now user says "sì": it must NOT execute the old deletion
  const resJ2 = await orchestrateUserInput('sì', now + 2000);
  assert(
    !resJ2.dataAffected,
    'Test J: Subsequent "sì" does NOT delete the note after context switch'
  );
  assert(
    loadNotes().length === 1 && loadNotes()[0].text === 'nota protetta',
    'Test J verified: Note is safe and untouched in storage'
  );

  // =========================================================================
  // TEST K: UPDATE -> nessuna conferma (Requisito 9)
  // =========================================================================
  console.log('\n-- Test K: UPDATE requires NO confirmation --');
  saveNotes([{ id: 'nk', text: 'testo vecchio', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  const resK = await orchestrateUserInput('Modifica quella nota in: testo aggiornato', now);
  assert(
    resK.type === 'HANDLED_LOCAL' && resK.dataAffected === true,
    'Test K: UPDATE executes immediately without confirmation',
    JSON.stringify(resK)
  );
  assert(
    loadNotes()[0].text === 'testo aggiornato',
    'Test K verified: Note updated directly'
  );

  // =========================================================================
  // TEST L: DELETE con target ambiguo -> nessuna cancellazione arbitraria
  // =========================================================================
  console.log('\n-- Test L: Ambiguous DELETE target does not confirm or delete arbitrarily --');
  saveNotes([
    { id: 'nl1', text: 'comprare latte fresco', createdAt: new Date(now).toISOString() },
    { id: 'nl2', text: 'comprare latte di soia', createdAt: new Date(now).toISOString() },
  ]);
  resetContext(now);
  clearPendingConfirmation();

  // "Cancella la nota del latte" is ambiguous (matches both notes)
  const resL = await orchestrateUserInput('Cancella la nota del latte', now);
  assert(
    resL.type === 'HANDLED_LOCAL' && Boolean(resL.feedbackText?.includes('più') || resL.feedbackText?.includes('Quale')),
    'Test L: Ambiguous target asks clarification instead of prompting arbitrary deletion',
    resL.feedbackText
  );
  assert(
    loadNotes().length === 2,
    'Test L verified: Neither note was deleted'
  );
  assert(
    getPendingConfirmation(now) === null,
    'Test L: No pending confirmation created for ambiguous target'
  );

  // =========================================================================
  // TEST M: Memory DELETE protetto (singolo e totale)
  // =========================================================================
  console.log('\n-- Test M: MEMORY DELETE protection --');
  saveUserMemory({
    userName: 'Mario',
    userCity: 'Milano',
    preferences: ['pizza'],
    interests: [],
    projects: [],
    notes: [],
  });
  resetContext(now);
  clearPendingConfirmation();

  // Single memory delete
  const resM1 = await orchestrateUserInput('Dimentica che vivo a Milano', now);
  assert(
    resM1.type === 'CONFIRMATION_REQUIRED',
    'Test M (1/4): Single memory forget requires confirmation',
    JSON.stringify(resM1)
  );
  assert(
    loadUserMemory().userCity === 'Milano',
    'Test M (1/4): Memory untouched before confirmation'
  );

  // Confirm single forget
  const resM2 = await orchestrateUserInput('sì', now + 1000);
  assert(
    resM2.dataAffected === true && loadUserMemory().userCity === '',
    'Test M (2/4): Confirmed forget removed city from memory'
  );

  // Clear all memory
  const resM3 = await orchestrateUserInput('Cancella tutta la memoria', now + 2000);
  assert(
    resM3.type === 'CONFIRMATION_REQUIRED' && Boolean(resM3.feedbackText?.includes('tutta la memoria')),
    'Test M (3/4): Clear all memory requires explicit confirmation',
    resM3.feedbackText
  );

  // Confirm clear all memory
  const resM4 = await orchestrateUserInput('confermo', now + 3000);
  assert(
    resM4.dataAffected === true && !loadUserMemory().userName,
    'Test M (4/4): All memory cleared after explicit confirmation'
  );

  // =========================================================================
  // TEST N: Verifica post-delete corretta (DO -> VERIFY -> REPORT)
  // =========================================================================
  console.log('\n-- Test N: Post-delete verification --');
  saveNotes([{ id: 'nn', text: 'nota da verificare', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella la nota nota da verificare', now);
  const resN = await orchestrateUserInput('procedi', now + 1000);
  assert(
    resN.type === 'HANDLED_LOCAL' && resN.dataAffected === true,
    'Test N: VerifiedActionResult confirms dataAffected === true on successful deletion'
  );
  assert(
    !loadNotes().some((n) => n.id === 'nn'),
    'Test N verified: Storage confirmed empty for target note'
  );

  // =========================================================================
  // TEST O: Failure durante execution -> riportare FAILURE, non SUCCESS
  // =========================================================================
  console.log('\n-- Test O: Storage failure reports FAILURE, not SUCCESS --');
  saveNotes([{ id: 'no-fail', text: 'nota intoccabile', createdAt: new Date(now).toISOString() }]);
  resetContext(now);
  clearPendingConfirmation();

  await orchestrateUserInput('Cancella la nota nota intoccabile', now);

  // Sabotage saveNotes by making localStorage.setItem throw for notes key
  const originalSetItem = mockStorage.setItem;
  mockStorage.setItem = (key: string, val: string) => {
    if (key === 'maia_notes_v1') {
      // Simulate storage failure
      throw new Error('Simulated write failure');
    }
    storage[key] = val;
  };

  const resO = await orchestrateUserInput('sì', now + 1000);
  assert(
    resO.dataAffected === false,
    'Test O: When storage verification fails, dataAffected is false (not true)',
    JSON.stringify(resO)
  );
  assert(
    Boolean(resO.feedbackText?.includes('Errore') || resO.feedbackText?.includes('non')),
    'Test O: Feedback reports error honestly to the user',
    resO.feedbackText
  );

  // Restore storage
  mockStorage.setItem = originalSetItem;

  // =========================================================================
  // TEST P: Più richieste consecutive -> il pending corretto è il più recente
  // =========================================================================
  console.log('\n-- Test P: Multiple consecutive DELETEs -> newest pending replaces older --');
  saveNotes([
    { id: 'np1', text: 'progetto alfa', createdAt: new Date(now).toISOString() },
    { id: 'np2', text: 'progetto beta', createdAt: new Date(now).toISOString() },
  ]);
  resetContext(now);
  clearPendingConfirmation();

  // First request: delete note 1
  await orchestrateUserInput('Cancella la nota progetto alfa', now);
  const pending1 = getPendingConfirmation(now);
  assert(
    pending1?.resolution.payload?.parameters?.targetId === 'np1',
    'Test P (1/3): Pending set for note 1'
  );

  // Second request: delete note 2
  await orchestrateUserInput('Cancella la nota progetto beta', now + 1000);
  const pending2 = getPendingConfirmation(now + 1000);
  assert(
    pending2?.resolution.payload?.parameters?.targetId === 'np2',
    'Test P (2/3): New pending confirmation replaced previous and targets note 2'
  );
  assert(
    pending2?.id !== pending1?.id,
    'Test P (2/3): Pending confirmation has a new unique ID'
  );

  // User confirms with "sì"
  const resP = await orchestrateUserInput('sì', now + 2000);
  assert(
    resP.dataAffected === true,
    'Test P (3/3): Confirmed action executes'
  );
  const remainingP = loadNotes();
  assert(
    remainingP.some((n) => n.id === 'np1'),
    'Test P (3/3) verified: Note 1 was NOT deleted'
  );
  assert(
    !remainingP.some((n) => n.id === 'np2'),
    'Test P (3/3) verified: Note 2 was deleted (the authoritative newest pending)'
  );

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  if (passed === total) {
    console.log('ALL PHASE 6F SAFETY & CONFIRMATION TESTS PASSED WITH 100% SUCCESS!');
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
