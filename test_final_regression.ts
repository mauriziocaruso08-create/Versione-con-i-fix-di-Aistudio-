/**
 * Phase 6I — Final Cross-Module Regression & Architecture Validation Suite
 *
 * Verifies end-to-end integration and architectural integrity across:
 * A. Notes (CRUD, ordinal selection, contextual references, DELETE_ALL, disambiguation)
 * B. Reminders (CRUD, contextual references, missing-param continuation, DELETE_ALL)
 * C. Memory (facts, sensitive data guard, preferences vs memories disambiguation)
 * D. Preferences / Learning (explicit, temporary, learned, contradictions, reset, scope)
 * E. Safety / Confirmation (destructive protection, one-shot, ambiguous, context switch)
 * F. Web Search (explicit/current routing, follow-up, failure honesty, source attribution)
 * G. Session Context (working memory, displayedItems, selectedItem, pendingAction, TTL)
 * H. Cross-Domain Disambiguation (note vs reminder vs memory vs preference vs web vs Gemini)
 * I. Failure & Recovery (NOT_FOUND, AMBIGUOUS, storage write failure, honest errors)
 * J. Pipeline Integrity (Input -> Context -> Intent -> Target -> Safety -> Capability -> Verify -> Update -> Response)
 */

import { orchestrateUserInput, OrchestrationResult } from './src/services/router/maiaOrchestrator';
import {
  getContext,
  resetContext,
  setDisplayedItems,
  setSelectedItem,
  setPendingClarification,
  setTemporaryPreference,
  clearTemporaryPreferences,
} from './src/services/context/sessionContext';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { resolveTarget } from './src/services/router/targetResolver';
import { evaluateSafety } from './src/services/router/safetyGuard';
import { capabilityRegistry } from './src/services/capabilities/capabilityRegistry';
import {
  clearPendingConfirmation,
  getPendingConfirmation,
  setConfirmationTimeoutMs,
  resetConfirmationTimeoutMs,
} from './src/services/router/confirmationManager';
import { loadNotes, saveNotes } from './src/utils/notesManager';
import { loadReminders, saveReminders } from './src/utils/reminderManager';
import { loadUserMemory, saveUserMemory } from './src/services/router/actionExecutor';
import {
  isSensitiveInformation,
  parsePreferenceStatement,
  getEffectivePreferences,
  saveOrUpdatePreference,
  removePreferenceByKeyOrText,
} from './src/services/learning/preferenceManager';
import { MaiaNote, MaiaReminder, UserMemory } from './src/types';

// =============================================================================
// STORAGE & FETCH MOCKS
// =============================================================================

const mockStorage: Record<string, string> = {};
const customLocalStorage = {
  getItem: (k: string) => mockStorage[k] ?? null,
  setItem: (k: string, v: string) => {
    mockStorage[k] = v;
  },
  removeItem: (k: string) => {
    delete mockStorage[k];
  },
  clear: () => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  },
};

(globalThis as any).localStorage = customLocalStorage;
(globalThis as any).window = {
  localStorage: customLocalStorage,
};

let currentFetchMock: ((url: string, opts?: any) => Promise<any>) | null = null;
const defaultFetchMock = (url: string, opts?: any) => {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'mock query',
      summary: 'Risultato mock di ricerca web.',
      sources: [{ title: 'Fonte Autorevole', url: 'https://example.com/notizie' }],
    }),
  });
};

(globalThis as any).fetch = (url: string, opts?: any) => {
  if (currentFetchMock) {
    return currentFetchMock(url, opts);
  }
  return defaultFetchMock(url, opts);
};

// =============================================================================
// TEST HARNESS
// =============================================================================

let totalCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: any): void {
  totalCount++;
  if (condition) {
    passCount++;
    console.log(`✓ [PASS] ${testName}`);
  } else {
    failCount++;
    console.error(`✗ [FAIL] ${testName}`, detail !== undefined ? detail : '');
    throw new Error(`Assertion failed: ${testName}`);
  }
}

function resetEnvironment(): void {
  customLocalStorage.clear();
  resetContext();
  clearPendingConfirmation();
  resetConfirmationTimeoutMs();
  currentFetchMock = null;
}

// =============================================================================
// TEST SUITE EXECUTION
// =============================================================================

async function runCrossModuleRegression() {
  console.log('=================================================================');
  console.log('=== PHASE 6I: FINAL CROSS-MODULE REGRESSION TEST SUITE ===');
  console.log('=================================================================\n');

  // Project chat commands support both natural colon syntax and the explicit
  // "chiamato" form; both write to the dedicated project archive.
  resetEnvironment();
  const projectIntent = classifyIntent('Crea un progetto: Prova MAIA', getContext());
  assert(projectIntent.entity === 'PROJECT' && projectIntent.verb === 'CREATE' && projectIntent.parameters.projectName === 'Prova MAIA',
    'P1.1: Colon-form project creation is classified locally');
  const projectCreate = await orchestrateUserInput('Crea un progetto: Prova MAIA', Date.now());
  assert(projectCreate.type === 'HANDLED_LOCAL' && projectCreate.dataAffected === true, 'P1.2: Chat creates project locally');
  const projectDuplicate = await orchestrateUserInput('Crea un progetto chiamato Prova MAIA', Date.now());
  assert(projectDuplicate.type === 'HANDLED_LOCAL' && projectDuplicate.dataAffected === false, 'P1.3: Duplicate project name does not create a second row');
  const projectList = await orchestrateUserInput('Mostra i miei progetti', Date.now());
  assert(projectList.type === 'HANDLED_LOCAL' && /Prova MAIA/.test(projectList.feedbackText || ''), 'P1.4: Chat list reads from the dedicated project archive');

  resetEnvironment();
  const compoundPreference = await orchestrateUserInput('Preferisco risposte più articolate e dirette', Date.now());
  const compoundMemory = loadUserMemory();
  assert(compoundPreference.type === 'HANDLED_LOCAL' && compoundPreference.dataAffected === true, 'P1.5: Compound response preference handled locally');
  assert(Boolean(compoundMemory.structuredPreferences?.some((p) => p.key === 'verbosity' && p.value === 'detailed') && compoundMemory.structuredPreferences?.some((p) => p.key === 'tone' && p.value === 'direct')),
    'P1.6: Both articulated and direct preferences are persisted as separate structured values');

  // ---------------------------------------------------------------------------
  // SECTION A: NOTES (CRUD, Contextual References, Ordinal, Delete All)
  // ---------------------------------------------------------------------------
  console.log('-- Section A: Notes Integration & Cross-Module Flows --');
  resetEnvironment();

  // A1: Create -> Read -> Update -> Read
  const a1Create = await orchestrateUserInput('Crea una nota: Comprare il latte d\'avena', Date.now());
  assert(a1Create.type === 'HANDLED_LOCAL', 'A1.1: Note created locally');
  assert(a1Create.dataAffected === true, 'A1.2: dataAffected is true');
  let notes = loadNotes();
  assert(notes.length === 1 && notes[0].text === "Comprare il latte d'avena", 'A1.3: Note text preserved in storage');

  const a1Read = await orchestrateUserInput('Mostra le mie note', Date.now());
  assert(a1Read.type === 'HANDLED_LOCAL', 'A1.4: Notes read locally');
  assert(Boolean(a1Read.feedbackText?.includes("latte d'avena")), 'A1.5: Read feedback contains note text');

  const a1Update = await orchestrateUserInput('Modifica quella nota: Comprare il latte di soia', Date.now());
  assert(a1Update.type === 'HANDLED_LOCAL', 'A1.6: Contextual note update handled locally');
  notes = loadNotes();
  assert(notes[0].text === 'Comprare il latte di soia', 'A1.7: Note text updated in storage');

  const a1Read2 = await orchestrateUserInput('Mostrami le note', Date.now());
  assert(Boolean(a1Read2.feedbackText?.includes('latte di soia')), 'A1.8: Second read shows updated text');

  // A1.8a-A1.8e: Generic possessive target is not a literal title; ask the user
  // to choose locally and resume the requested update against the selected ID.
  resetEnvironment();
  saveNotes([
    { id: 'generic-note-1', title: 'Lista spesa', text: 'Pane', createdAt: new Date().toISOString() } as any,
    { id: 'generic-note-2', title: 'Progetto MAIA', text: 'Roadmap iniziale', createdAt: new Date().toISOString() } as any,
  ]);
  const a1GenericTarget = await orchestrateUserInput('Modifica la mia nota e scrivi: Test aggiornato', Date.now());
  assert(a1GenericTarget.type === 'HANDLED_LOCAL', 'A1.8a: Generic note update is handled locally');
  assert(getContext().pendingClarification?.type === 'SELECT_TARGET', 'A1.8b: Generic note target asks for selection when multiple notes exist');
  assert(loadNotes().every((n) => n.text !== 'Test aggiornato'), 'A1.8c: No note is modified before target selection');
  const a1GenericSelection = await orchestrateUserInput('2', Date.now());
  assert(a1GenericSelection.type === 'HANDLED_LOCAL', 'A1.8d: Numeric target answer resumes the pending note update');
  const genericUpdatedNotes = loadNotes();
  assert(genericUpdatedNotes[0].text === 'Pane' && genericUpdatedNotes[1].text === 'Test aggiornato' && genericUpdatedNotes[1].title === 'Progetto MAIA', 'A1.8e: Only selected note content changes and title is preserved');

  // A1.9-A1.10: Exact note-title lookup must use the local archive, not web/Gemini.
  resetEnvironment();
  saveNotes([{ id: 'lookup-title-1', title: 'Test routing locale MAIA', text: 'Contenuto completo della nota locale.', createdAt: new Date().toISOString() } as any]);
  const a1LocalOpen = await orchestrateUserInput('Apri la nota Test routing locale MAIA.', Date.now());
  assert(a1LocalOpen.type === 'HANDLED_LOCAL', 'A1.9: Explicit note-title lookup handled locally');
  assert(/Contenuto completo della nota locale/i.test(a1LocalOpen.feedbackText || ''), 'A1.10: Exact note-title lookup returns stored content');

  // A2: Multiple notes + ordinal selection update
  resetEnvironment();
  await orchestrateUserInput('Crea una nota: Prima nota importante', Date.now());
  await orchestrateUserInput('Crea una nota: Seconda nota lavoro', Date.now());
  await orchestrateUserInput('Crea una nota: Terza nota spesa', Date.now());
  await orchestrateUserInput('Mostra le note', Date.now());

  const a2OrdUpdate = await orchestrateUserInput('Modifica la seconda nota e scrivi: Seconda nota aggiornata', Date.now());
  assert(a2OrdUpdate.type === 'HANDLED_LOCAL', 'A2.1: Ordinal update handled locally');
  notes = loadNotes();
  const secondNote = notes.find((n) => n.text === 'Seconda nota aggiornata');
  assert(secondNote !== undefined, 'A2.2: Second note updated via ordinal selection');

  // A3: Contextual reference + delete + safety confirmation
  resetEnvironment();
  await orchestrateUserInput('Crea una nota: Nota da eliminare', Date.now());
  const a3DelReq = await orchestrateUserInput('Cancella quella nota', Date.now());
  assert(a3DelReq.type === 'CONFIRMATION_REQUIRED', 'A3.1: Contextual delete requires safety confirmation');
  assert(loadNotes().length === 1, 'A3.2: Storage untouched before confirmation');
  const a3Confirm = await orchestrateUserInput('Sì', Date.now());
  assert(a3Confirm.type === 'HANDLED_LOCAL' && a3Confirm.dataAffected === true, 'A3.3: Confirmed delete executed');
  assert(loadNotes().length === 0, 'A3.4: Exactly one note deleted');

  // A4: DELETE_ALL notes + confirmation
  saveNotes([
    { id: 'n1', text: 'Nota 1', createdAt: new Date().toISOString() },
    { id: 'n2', text: 'Nota 2', createdAt: new Date().toISOString() },
  ]);
  const a4DelAllReq = await orchestrateUserInput('Cancella tutte le note', Date.now());
  assert(a4DelAllReq.type === 'CONFIRMATION_REQUIRED', 'A4.1: DELETE_ALL notes requires confirmation');
  assert(loadNotes().length === 2, 'A4.2: All notes untouched before confirmation');
  const a4DelAllConf = await orchestrateUserInput('Confermo', Date.now());
  assert(a4DelAllConf.type === 'HANDLED_LOCAL', 'A4.3: Confirmed DELETE_ALL executed');
  assert(loadNotes().length === 0, 'A4.4: Notes storage completely cleared');

  // A5: Ambiguous target must not modify data
  resetEnvironment();
  saveNotes([
    { id: 'n1', text: 'Comprare pane e burro', createdAt: new Date().toISOString() },
    { id: 'n2', text: 'Comprare pane integrale', createdAt: new Date().toISOString() },
  ]);
  const a5Amb = await orchestrateUserInput('Cancella la nota sul pane', Date.now());
  assert(a5Amb.type === 'HANDLED_LOCAL', 'A5.1: Ambiguous target handled locally');
  assert(Boolean(a5Amb.feedbackText?.includes('più') || a5Amb.feedbackText?.includes('Quale')), 'A5.2: Asks user to clarify ambiguous target');
  assert(loadNotes().length === 2, 'A5.3: Storage unmodified when target is ambiguous');

  // A6: Conversational prefixes remain local
  const a6Pref = await orchestrateUserInput('Senti, per favore, crea una nota: Ricordare le chiavi', Date.now());
  assert(a6Pref.type === 'HANDLED_LOCAL', 'A6.1: Conversational prefix handled locally');
  notes = loadNotes();
  assert(notes.some((n) => n.text === 'Ricordare le chiavi'), 'A6.2: Clean note payload extracted');

  // ---------------------------------------------------------------------------
  // SECTION B: REMINDERS (CRUD, Contextual, Continuation, Delete All)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section B: Reminders Integration & Cross-Module Flows --');
  resetEnvironment();

  // B1: Create -> Read -> Update -> Read
  const b1Create = await orchestrateUserInput('Crea un promemoria per chiamare Marco domani alle 15', Date.now());
  assert(b1Create.type === 'HANDLED_LOCAL', 'B1.1: Reminder created locally');
  let reminders = loadReminders();
  assert(reminders.length === 1 && reminders[0].text === 'chiamare Marco', 'B1.2: Reminder text parsed cleanly');
  assert(
    new Date(reminders[0].dueAt).getHours() === 15 &&
    new Date(reminders[0].dueAt).getMinutes() === 0,
    'B1.3: Reminder dueAt set to 15:00 local time'
  );
  const b1Read = await orchestrateUserInput('Mostrami i miei promemoria', Date.now());
  assert(b1Read.type === 'HANDLED_LOCAL', 'B1.4: Reminders read locally');
  assert(Boolean(b1Read.feedbackText?.includes('chiamare Marco')), 'B1.5: Read feedback shows reminder');

  // B2: Contextual reference "quel promemoria"
  const b2Update = await orchestrateUserInput('Modifica quel promemoria e scrivi: chiamare Marco per lavoro', Date.now());
  assert(b2Update.type === 'HANDLED_LOCAL', 'B2.1: Contextual reminder update handled locally');
  reminders = loadReminders();
  assert(reminders[0].text === 'chiamare Marco per lavoro', 'B2.2: Reminder text updated in storage');

  // B2.3: Move reminder time without corrupting its text
  const b2Time = await orchestrateUserInput('Sposta il promemoria di chiamare Marco per lavoro a domani alle 17:30', Date.now());
  assert(b2Time.type === 'HANDLED_LOCAL', 'B2.3: Reminder time update handled locally');
  reminders = loadReminders();
  assert(reminders[0].text === 'chiamare Marco per lavoro', 'B2.4: Time update preserves reminder text');
  assert(new Date(reminders[0].dueAt).getHours() === 17 && new Date(reminders[0].dueAt).getMinutes() === 30, 'B2.5: Reminder time updated to 17:30 local time');

  // B2.6-B2.8: Date/time may appear before the reminder target in natural phrasing.
  const b2MiddleTime = await orchestrateUserInput('Sposta a domani alle 16:40 il promemoria di chiamare Marco per lavoro', Date.now());
  assert(b2MiddleTime.type === 'HANDLED_LOCAL', 'B2.6: Middle-position date/time update handled locally');
  reminders = loadReminders();
  assert(reminders[0].text === 'chiamare Marco per lavoro', 'B2.7: Middle-position date/time does not corrupt reminder text');
  assert(new Date(reminders[0].dueAt).getHours() === 16 && new Date(reminders[0].dueAt).getMinutes() === 40, 'B2.8: Middle-position date/time is applied');

  // B3: Missing parameter continuation
  const b3Miss = await orchestrateUserInput('Modifica quel promemoria', Date.now());
  assert(b3Miss.type === 'HANDLED_LOCAL', 'B3.1: Missing parameter prompt returned locally');
  assert(getContext().pendingClarification?.type === 'MISSING_PARAM', 'B3.2: pendingClarification set with MISSING_PARAM');
  const b3Cont = await orchestrateUserInput('chiamare Luca invece', Date.now());
  assert(b3Cont.type === 'HANDLED_LOCAL', 'B3.3: Continuation completes pending update locally');
  reminders = loadReminders();
  assert(reminders[0].text === 'chiamare Luca invece', 'B3.4: Storage updated via continuation');

  // B3.5-B3.8: A reminder missing only its due time must resume when the user answers.
  const b3CreateMissingTime = await orchestrateUserInput('Ricordami di fare una cosa importante', Date.now());
  assert(b3CreateMissingTime.type === 'HANDLED_LOCAL', 'B3.5: Reminder missing time asks for clarification locally');
  assert(getContext().pendingClarification?.type === 'MISSING_PARAM' && getContext().pendingClarification?.missingParameter === 'dueAt', 'B3.6: Missing reminder dueAt is retained as pending clarification');
  const b3CreateContinue = await orchestrateUserInput('domani alle 10:00', Date.now());
  assert(b3CreateContinue.type === 'HANDLED_LOCAL', 'B3.7: Time answer completes reminder creation');
  reminders = loadReminders();
  assert(reminders.some((r) => r.text.toLowerCase().includes('fare una cosa importante') && new Date(r.dueAt).getHours() === 10), 'B3.8: Clarified reminder is actually persisted with requested time');


  // B3.9-B3.11: A date without a clock time must not inherit 09:00 or persist.
  resetEnvironment();
  const b3DateOnly = await orchestrateUserInput('Ricordami domani di comprare il pane', Date.now());
  assert(b3DateOnly.type === 'HANDLED_LOCAL', 'B3.9: Date-only reminder request handled locally');
  assert(/che ora|a che ora|orario esatto/i.test(b3DateOnly.feedbackText || ''), 'B3.10: Date-only reminder asks for an explicit time');
  assert(loadReminders().length === 0, 'B3.11: Date-only reminder is not saved before clarification');


  // B3.12-B3.14: Repeating an identical request must not create duplicate rows.
  resetEnvironment();
  const b3Dup1 = await orchestrateUserInput('Ricordami domani alle 15:00 di comprare il pane', Date.now());
  const b3Dup2 = await orchestrateUserInput('Ricordami domani alle 15:00 di comprare il pane', Date.now());
  assert(b3Dup1.type === 'HANDLED_LOCAL' && b3Dup2.type === 'HANDLED_LOCAL', 'B3.12: Duplicate reminder requests are handled locally');
  assert(loadReminders().length === 1, 'B3.13: Exact duplicate reminder is not persisted twice');
  assert(/esiste già|già presente|già impostato/i.test(b3Dup2.feedbackText || ''), 'B3.14: Duplicate response is explicit and honest');

  // B3.14a-B3.14c: A date/time prefix must never leak into the task text.
  resetEnvironment();
  const b3TimePrefix = await orchestrateUserInput('Ricordami domani alle 15:00 di chiamare il dentista', Date.now());
  assert(b3TimePrefix.type === 'HANDLED_LOCAL', 'B3.14a: Date-time-first reminder handled locally');
  const timePrefixReminders = loadReminders();
  assert(timePrefixReminders.length === 1, 'B3.14b: Date-time-first reminder stored exactly once');
  assert(timePrefixReminders[0].text === 'chiamare il dentista', 'B3.14c: Date/time wording is excluded from reminder task text');
  assert(new Date(timePrefixReminders[0].dueAt).getHours() === 15 && new Date(timePrefixReminders[0].dueAt).getMinutes() === 0, 'B3.14d: Date-time-first reminder keeps requested 15:00 time');

  // B3.15-B3.16: Completed reminder query excludes active reminders.
  saveReminders([
    { id: 'done-1', text: 'Pane già comprato', dueAt: new Date(Date.now() + 86400000).toISOString(), completed: true, createdAt: new Date().toISOString() },
    { id: 'active-1', text: 'Chiamare dentista', dueAt: new Date(Date.now() + 86400000).toISOString(), completed: false, createdAt: new Date().toISOString() },
  ]);
  const b3Completed = await orchestrateUserInput('Mostrami i promemoria completati', Date.now());
  assert(Boolean(b3Completed.feedbackText?.includes('Pane già comprato')), 'B3.15: Completed reminder appears in completed-only list');
  assert(!b3Completed.feedbackText?.includes('Chiamare dentista'), 'B3.16: Active reminder excluded from completed-only list');

  // B4: Delete reminder + confirmation. Isolate this scenario from the
  // reminder created in B3.5-B3.8 so the test checks the intended target.
  saveReminders([
    { id: 'b4-luca', text: 'chiamare Luca invece', dueAt: new Date(Date.now() + 86400000).toISOString(), completed: false, createdAt: new Date().toISOString() },
  ]);
  const b4DelReq = await orchestrateUserInput('Cancella il promemoria chiamare Luca', Date.now());
  assert(b4DelReq.type === 'CONFIRMATION_REQUIRED', 'B4.1: Delete reminder requires confirmation');
  assert(loadReminders().length === 1 && loadReminders()[0].text === 'chiamare Luca invece', 'B4.2: Reminder safe before confirmation');
  const b4DelConf = await orchestrateUserInput('Sì', Date.now());
  assert(b4DelConf.type === 'HANDLED_LOCAL', 'B4.3: Confirmed delete executed');
  assert(loadReminders().length === 0, 'B4.4: Confirmed target deleted from storage');

  // B5: DELETE_ALL reminders + confirmation
  saveReminders([
    { id: 'r1', text: 'Task 1', dueAt: new Date().toISOString(), completed: false, createdAt: new Date().toISOString() },
    { id: 'r2', text: 'Task 2', dueAt: new Date().toISOString(), completed: false, createdAt: new Date().toISOString() },
  ]);
  const b5DelAllReq = await orchestrateUserInput('Elimina tutti i promemoria', Date.now());
  assert(b5DelAllReq.type === 'CONFIRMATION_REQUIRED', 'B5.1: DELETE_ALL reminders requires confirmation');
  const b5DelAllConf = await orchestrateUserInput('Sì', Date.now());
  assert(b5DelAllConf.type === 'HANDLED_LOCAL', 'B5.2: Confirmed DELETE_ALL executed');
  assert(loadReminders().length === 0, 'B5.3: All reminders cleared from storage');

  // B6: Ambiguous reminder target must not delete
  saveReminders([
    { id: 'r1', text: 'Dentista lunedì', dueAt: new Date().toISOString(), completed: false, createdAt: new Date().toISOString() },
    { id: 'r2', text: 'Dentista martedì', dueAt: new Date().toISOString(), completed: false, createdAt: new Date().toISOString() },
  ]);
  const b6Amb = await orchestrateUserInput('Cancella il promemoria dentista', Date.now());
  assert(b6Amb.type === 'HANDLED_LOCAL', 'B6.1: Ambiguous target handled locally');
  assert(Boolean(b6Amb.feedbackText?.includes('più') || b6Amb.feedbackText?.includes('Quale')), 'B6.2: Clarification asked');
  assert(loadReminders().length === 2, 'B6.3: No reminder deleted');

  // ---------------------------------------------------------------------------
  // SECTION C: MEMORY (Facts, Sensitive Barrier, Disambiguation)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section C: Memory Integration & Cross-Module Flows --');
  resetEnvironment();

  // C1: Explicit memory creation & read
  const c1Create = await orchestrateUserInput('Ricordati che il mio gatto si chiama Milo', Date.now());
  assert(c1Create.type === 'HANDLED_LOCAL', 'C1.1: Explicit memory created locally');
  let mem = loadUserMemory();
  assert(mem.notes.some((n) => n.includes('Milo')), 'C1.2: Memory fact saved in persistent memory');

  const c1Read = await orchestrateUserInput('Cosa ricordi di me?', Date.now());
  assert(c1Read.type === 'HANDLED_LOCAL', 'C1.3: Memory read handled locally');
  assert(Boolean(c1Read.feedbackText?.includes('Milo')), 'C1.4: Memory read outputs stored fact');

  // C2: Memory deletion with confirmation
  const c2DelReq = await orchestrateUserInput('Dimentica che il mio gatto si chiama Milo', Date.now());
  assert(c2DelReq.type === 'CONFIRMATION_REQUIRED', 'C2.1: Memory deletion requires confirmation');
  assert(loadUserMemory().notes.length === 1, 'C2.2: Memory untouched before confirmation');
  const c2DelConf = await orchestrateUserInput('Sì', Date.now());
  assert(c2DelConf.type === 'HANDLED_LOCAL', 'C2.3: Confirmed memory deletion executed');
  mem = loadUserMemory();
  assert(!mem.notes.some((n) => n.includes('Milo')), 'C2.4: Fact removed from memory');

  // C3: Sensitive data barrier
  assert(isSensitiveInformation('Il mio PIN è 9876') === true, 'C3.1: PIN detected as sensitive');
  assert(isSensitiveInformation('La mia password è Segreto!23') === true, 'C3.2: Password detected as sensitive');
  const c3Sens = await orchestrateUserInput('Ricordati che la mia password è Segreto!23', Date.now());
  assert(c3Sens.type === 'HANDLED_LOCAL', 'C3.3: Sensitive info blocked locally');
  assert(Boolean(c3Sens.feedbackText?.includes('sicurezza') || c3Sens.feedbackText?.includes('riservatezza')), 'C3.4: Privacy rejection notice given');
  assert(!loadUserMemory().notes.some((n) => n.includes('Segreto')), 'C3.5: Sensitive info never stored');

  // C4: Preferences vs Memory disambiguation
  const c4Pref = await orchestrateUserInput('Preferisco risposte brevi', Date.now());
  assert(c4Pref.type === 'HANDLED_LOCAL', 'C4.1: Preference statement recognized as preference');
  mem = loadUserMemory();
  assert(Boolean(mem.structuredPreferences?.some((p) => p.key === 'verbosity')), 'C4.2: Structured preference stored in structuredPreferences');
  assert(!mem.notes.some((n) => n.includes('risposte brevi')), 'C4.3: Preference NOT polluted into ordinary notes array');

  // ---------------------------------------------------------------------------
  // SECTION D: PREFERENCES & LEARNING (Explicit, Volatile, Scoped, Reset)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section D: Preferences & Learning Cross-Module Flows --');
  resetEnvironment();

  // D1: Volatile Temporary Preference vs Persistent Memory
  const d1Temp = await orchestrateUserInput('Per questa risposta sii molto dettagliata', Date.now());
  assert(d1Temp.type === 'HANDLED_LOCAL', 'D1.1: Temporary preference handled locally');
  assert(d1Temp.dataAffected === false, 'D1.2: Volatile override does NOT affect persistent data');
  assert(getContext().temporaryPreferences?.verbosity === 'detailed', 'D1.3: Temporary preference in SessionContext');
  assert((loadUserMemory().structuredPreferences?.length || 0) === 0, 'D1.4: Persistent memory untouched');

  // D2: Persistent Preference + Effective Resolution
  const d2Pers = await orchestrateUserInput('Da ora in poi preferisco risposte sintetiche', Date.now());
  assert(d2Pers.type === 'HANDLED_LOCAL' && d2Pers.dataAffected === true, 'D2.1: Persistent preference saved');
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.[0].value === 'concise', 'D2.2: Stored value is concise');

  const effPref = getEffectivePreferences(undefined, mem, getContext());
  assert(effPref.verbosity === 'detailed', 'D2.3: Active volatile temporary preference takes priority over stored concise');

  // Clear temporary preference
  clearTemporaryPreferences();
  const effPref2 = getEffectivePreferences(undefined, mem, getContext());
  assert(effPref2.verbosity === 'concise', 'D2.4: Stored concise becomes effective after temporary preference cleared');

  // D3: Contradiction / Update with deduplication
  await orchestrateUserInput('Preferisco risposte dettagliate', Date.now());
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.length === 1, 'D3.1: Exactly 1 active verbosity preference (deduplicated)');
  assert(mem.structuredPreferences?.[0].value === 'detailed', 'D3.2: Value successfully updated to detailed');

  // D4: Reset all preferences protects user profile & notes
  saveUserMemory({
    userName: 'Maurizio',
    userCity: 'Malta',
    notes: ['Nota personale importante'],
    preferences: ['Preferisco risposte dettagliate'],
    structuredPreferences: [
      {
        id: 'p1',
        key: 'verbosity',
        value: 'detailed',
        category: 'verbosity',
        confidence: 'HIGH',
        source: 'EXPLICIT',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  } as any);

  const d4ResetReq = await orchestrateUserInput('Resetta le mie preferenze', Date.now());
  assert(d4ResetReq.type === 'CONFIRMATION_REQUIRED', 'D4.1: Reset preferences requires confirmation');
  const d4ResetConf = await orchestrateUserInput('Sì', Date.now());
  assert(d4ResetConf.type === 'HANDLED_LOCAL' && d4ResetConf.dataAffected === true, 'D4.2: Confirmed reset executed');
  mem = loadUserMemory();
  assert((mem.structuredPreferences?.length || 0) === 0, 'D4.3: structuredPreferences cleared');
  assert((mem.preferences?.length || 0) === 0, 'D4.4: preferences array cleared');
  assert(mem.userName === 'Maurizio' && mem.userCity === 'Malta', 'D4.5: User profile strictly preserved');
  assert(mem.notes.length === 1, 'D4.6: User personal notes strictly preserved');


  // D5: Profile-field deletion by category and by exact stored value.
  resetEnvironment();
  saveUserMemory({ userName: 'Maurizio', userCity: 'Malta', preferences: [], interests: [], projects: [], notes: [], structuredPreferences: [], personalFacts: [] } as any);
  const d5CityReq = await orchestrateUserInput('Cancella la città', Date.now());
  assert(d5CityReq.type === 'CONFIRMATION_REQUIRED', 'D5.1: City-category deletion requires confirmation');
  const d5CityConf = await orchestrateUserInput('Sì', Date.now());
  assert(d5CityConf.type === 'HANDLED_LOCAL' && d5CityConf.dataAffected === true, 'D5.2: Confirmed city-category deletion is handled locally');
  assert(loadUserMemory().userCity === '', 'D5.3: City field is actually removed');

  resetEnvironment();
  saveUserMemory({ userName: 'Maurizio', userCity: 'Malta', preferences: [], interests: [], projects: [], notes: [], structuredPreferences: [], personalFacts: [] } as any);
  const d5ValueReq = await orchestrateUserInput('Cancella Malta', Date.now());
  assert(d5ValueReq.type === 'CONFIRMATION_REQUIRED', 'D5.4: Exact city-value deletion requires confirmation');
  const d5ValueConf = await orchestrateUserInput('Sì', Date.now());
  assert(d5ValueConf.type === 'HANDLED_LOCAL' && d5ValueConf.dataAffected === true, 'D5.5: Confirmed exact city-value deletion is handled locally');
  assert(loadUserMemory().userCity === '', 'D5.6: Exact city value is actually removed');

  // ---------------------------------------------------------------------------
  // SECTION E: SAFETY & CONFIRMATION (One-Shot, Context Switch, Ambiguous)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section E: Safety & Confirmation Guardrails --');
  resetEnvironment();

  saveNotes([{ id: 'safe-1', text: 'Nota da proteggere', createdAt: new Date().toISOString() }]);

  // E1: Destructive action asks confirmation
  const e1Req = await orchestrateUserInput('Cancella la nota Nota da proteggere', Date.now());
  assert(e1Req.type === 'CONFIRMATION_REQUIRED', 'E1.1: Confirmation required');
  assert(getPendingConfirmation() !== null, 'E1.2: Pending confirmation created in ConfirmationManager');

  // E2: Ambiguous reply does not delete, keeps pending
  const e2Amb = await orchestrateUserInput('forse', Date.now());
  assert(e2Amb.type === 'HANDLED_LOCAL', 'E2.1: Ambiguous answer handled locally');
  assert(Boolean(e2Amb.feedbackText?.includes('confermare')), 'E2.2: User asked to clarify confirmation');
  assert(loadNotes().length === 1, 'E2.3: Data untouched after ambiguous reply');
  assert(getPendingConfirmation() !== null, 'E2.4: Pending confirmation still active');

  // E3: Context switch to cognitive query invalidates pending confirmation
  const e3Switch = await orchestrateUserInput('Chi era Napoleone?', Date.now());
  assert(e3Switch.type === 'FALLTHROUGH_GEMINI', 'E3.1: Cognitive query falls through to Gemini');
  assert(getPendingConfirmation() === null, 'E3.2: Stale pending confirmation invalidated on context switch');

  // E4: Subsequent "sì" after context switch does NOT execute stale delete
  const e4Stale = await orchestrateUserInput('Sì', Date.now());
  assert(e4Stale.type === 'FALLTHROUGH_GEMINI', 'E4.1: "Sì" after context switch routes to conversational model');
  assert(loadNotes().length === 1, 'E4.2: Note protected from stale confirmation execution');

  // E5: One-shot execution guarantee
  const e5Req = await orchestrateUserInput('Cancella la nota Nota da proteggere', Date.now());
  assert(e5Req.type === 'CONFIRMATION_REQUIRED', 'E5.1: New confirmation requested');
  const e5Conf1 = await orchestrateUserInput('Sì', Date.now());
  assert(e5Conf1.type === 'HANDLED_LOCAL', 'E5.2: Confirmation executed');
  assert(loadNotes().length === 0, 'E5.3: Note deleted');
  const e5Conf2 = await orchestrateUserInput('Sì', Date.now());
  assert(e5Conf2.type !== 'CONFIRMATION_REQUIRED' && e5Conf2.dataAffected !== true, 'E5.4: Second "Sì" does not execute any deletion');

  // ---------------------------------------------------------------------------
  // SECTION F: WEB SEARCH (Routing, Follow-up, Honesty, Verified Sources)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section F: Web Search Capability & Disambiguation --');
  resetEnvironment();

  // F1: Explicit web search
  const f1Search = await orchestrateUserInput('Cerca sul web le ultime notizie su Marte', Date.now());
  assert(f1Search.type === 'HANDLED_LOCAL', 'F1.1: Web search handled locally');
  assert(f1Search.sources !== undefined && f1Search.sources.length > 0, 'F1.2: Verified sources returned');
  assert(getContext().activeEntity === 'WEB', 'F1.3: activeEntity set to WEB');
  assert(getContext().lastWebSearch?.searchQuery.includes('Marte') === true, 'F1.4: lastWebSearch recorded in context');

  // F2: Local commands never become web searches
  const f2Local = await orchestrateUserInput('Mostra i miei promemoria', Date.now());
  assert(f2Local.type === 'HANDLED_LOCAL', 'F2.1: "Mostra i miei promemoria" handled as local reminder');
  assert(getContext().activeEntity === 'REMINDER', 'F2.2: activeEntity switched to REMINDER');

  // F3: Follow-up web search
  await orchestrateUserInput('Cerca sul web il meteo a Roma', Date.now());
  const f3Follow = await orchestrateUserInput('E a Milano?', Date.now());
  assert(f3Follow.type === 'HANDLED_LOCAL', 'F3.1: Follow-up query handled as WEB');
  assert(getContext().lastWebSearch?.searchQuery.includes('Milano') === true, 'F3.2: Context resolved follow-up with previous domain');

  // F4: Quota / Network error returns honest failure
  currentFetchMock = () => Promise.resolve({ ok: false, status: 429, statusText: 'Too Many Requests' });
  const f4Quota = await orchestrateUserInput('Cerca sul web gli eventi di oggi', Date.now());
  assert(f4Quota.type === 'HANDLED_LOCAL', 'F4.1: Quota error handled gracefully');
  assert(Boolean(f4Quota.feedbackText?.includes('limite') || f4Quota.feedbackText?.includes('quota')), 'F4.2: Honest quota communication');
  currentFetchMock = null;

  // ---------------------------------------------------------------------------
  // SECTION G: SESSION CONTEXT LIFECYCLE (Working Memory, TTL, Invalidation)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section G: Session Context Lifecycle & Invariants --');
  resetEnvironment();

  // G1: displayedItems & selectedItem tracking
  const sampleNotes: MaiaNote[] = [
    { id: 'item-1', text: 'Nota A', createdAt: new Date().toISOString() },
    { id: 'item-2', text: 'Nota B', createdAt: new Date().toISOString() },
  ];
  saveNotes(sampleNotes);
  await orchestrateUserInput('Mostrami le note', Date.now());
  const ctxAfterRead = getContext();
  assert(ctxAfterRead.displayedItems.length === 2, 'G1.1: displayedItems populated in SessionContext');
  assert(ctxAfterRead.displayedItems[0].id === 'item-1', 'G1.2: displayedItems references match');

  // G2: pendingClarification lifecycle
  setPendingClarification(
    {
      type: 'MISSING_PARAM',
      originalIntent: {
        verb: 'UPDATE',
        entity: 'NOTE',
        target: { type: 'PRONOUN' },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: 'Modifica quella nota',
        isLocalActionCandidate: true,
      },
      missingParameter: 'newText',
    },
    Date.now()
  );
  assert(getContext().pendingClarification !== null, 'G2.1: pendingClarification set');
  setPendingClarification(null);
  assert(getContext().pendingClarification === null, 'G2.2: pendingClarification cleared');

  // G3: resetContext clears working memory completely
  setTemporaryPreference('tone', 'direct');
  setDisplayedItems([{ index: 1, id: 'd1', entity: 'NOTE', summary: 'test' }], 'NOTE');
  resetContext();
  const cleanCtx = getContext();
  assert(cleanCtx.displayedItems.length === 0, 'G3.1: displayedItems cleared on reset');
  assert(
    Object.keys(cleanCtx.temporaryPreferences || {}).length === 0,
    'G3.2: temporaryPreferences cleared on reset'
  );
  assert(cleanCtx.pendingAction === null, 'G3.3: pendingAction cleared on reset');

  // ---------------------------------------------------------------------------
  // SECTION H: CROSS-DOMAIN DISAMBIGUATION
  // ---------------------------------------------------------------------------
  console.log('\n-- Section H: Cross-Domain Semantic Disambiguation --');
  resetEnvironment();

  // H1: "Aggiungi una nota: preferisco il caffè amaro" -> NOTE, not preference!
  const h1 = classifyIntent('Aggiungi una nota: preferisco il caffè amaro', getContext());
  assert(h1.entity === 'NOTE' && h1.verb === 'CREATE', 'H1.1: Note with "preferisco" keyword correctly classified as NOTE');

  // H2: "Ricordami di controllare le mie note" -> REMINDER, not note!
  const h2 = classifyIntent('Ricordami di controllare le mie note domani alle 9', getContext());
  assert(h2.entity === 'REMINDER' && h2.verb === 'CREATE', 'H2.1: Reminder referencing notes classified as REMINDER');

  // H3: "Cerca tra le mie note la ricetta" -> NOTE SEARCH, not web search!
  const h3 = classifyIntent('Cerca tra le mie note la ricetta dei biscotti', getContext());
  assert(h3.entity === 'NOTE' && h3.verb === 'READ', 'H3.1: Note search classified as local NOTE');

  // H4: "Cosa ricordi delle mie preferenze?" -> MEMORY READ
  const h4 = classifyIntent('Cosa ricordi delle mie preferenze?', getContext());
  assert(h4.entity === 'MEMORY' && h4.verb === 'READ', 'H4.1: Preference recall classified as MEMORY READ');

  // H5: "Chi era Napoleone?" -> Cognitive EXPLAIN -> Gemini
  const h5 = classifyIntent('Chi era Napoleone?', getContext());
  assert(h5.verb === 'EXPLAIN' && h5.isLocalActionCandidate === false, 'H5.1: Cognitive query classified as Gemini fallthrough');

  // ---------------------------------------------------------------------------
  // SECTION I: FAILURE & RECOVERY (NOT_FOUND, AMBIGUOUS, Storage Errors)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section I: Failure & Recovery Handling --');
  resetEnvironment();

  // I1: NOT_FOUND non-existent note
  const i1NotFound = await orchestrateUserInput('Cancella la nota astronave galattica sconosciuta', Date.now());
  assert(i1NotFound.type === 'HANDLED_LOCAL', 'I1.1: Handled locally without crashing');
  assert(Boolean(i1NotFound.feedbackText?.includes('trovat') || i1NotFound.feedbackText?.includes('Nessun')), 'I1.2: Honest NOT_FOUND message');
  assert(i1NotFound.dataAffected === false, 'I1.3: dataAffected is false');

  // I2: Storage write failure reported honestly
  saveNotes([{ id: 'n-fail', text: 'Nota per test fallimento', createdAt: new Date().toISOString() }]);
  const origSetItem = customLocalStorage.setItem;
  customLocalStorage.setItem = () => {
    throw new Error('Simulated write error');
  };
  try {
    const i2WriteFail = await orchestrateUserInput('Modifica quella nota e scrivi: fallimento', Date.now());
    assert(i2WriteFail.dataAffected === false, 'I2.1: dataAffected is false on storage write error');
    assert(
      Boolean(i2WriteFail.feedbackText?.toLowerCase().includes('errore') || i2WriteFail.feedbackText?.includes('Non sono riuscita')),
      'I2.2: Honest error feedback'
    );
  } finally {
    customLocalStorage.setItem = origSetItem;
  }

  // ---------------------------------------------------------------------------
  // SECTION J: PIPELINE INTEGRITY (Full Sequential Pipeline Trace)
  // ---------------------------------------------------------------------------
  console.log('\n-- Section J: End-to-End Pipeline Integrity --');
  resetEnvironment();

  // Input -> SessionContext -> SemanticIntent -> TargetResolution -> SafetyGuard -> Capability -> Verify -> Update -> Response
  const testInput = 'Crea una nota: Pipeline test verificato';
  const initialContext = getContext();

  // 1. Semantic intent classification
  const tracedIntent = classifyIntent(testInput, initialContext);
  assert(tracedIntent.entity === 'NOTE' && tracedIntent.verb === 'CREATE', 'J1.1: Intent generated correctly');

  // 2. Target resolution
  const targetResult = resolveTarget(tracedIntent, initialContext, { notes: loadNotes() });
  assert(targetResult.status === 'NOT_APPLICABLE', 'J1.2: CREATE target resolution is NOT_APPLICABLE');

  // 3. Safety evaluation
  const safetyEval = evaluateSafety(tracedIntent, targetResult);
  assert(safetyEval.decision === 'ALLOW', 'J1.3: Safe CREATE action allowed to execute');

  // 4. Capability execution
  const noteCap = capabilityRegistry.getCapability('NOTE');
  assert(noteCap !== null, 'J1.4: NoteCapability found in registry');

  // 5. Full orchestrator execution verifies end-to-end chaining
  const pipelineRes = await orchestrateUserInput(testInput, Date.now());
  assert(pipelineRes.type === 'HANDLED_LOCAL', 'J1.5: Pipeline returned HANDLED_LOCAL');
  assert(pipelineRes.dataAffected === true, 'J1.6: Storage verification confirmed');
  const finalContext = getContext();
  assert(finalContext.lastSuccessfulAction !== null, 'J1.7: SessionContext updated with lastSuccessfulAction');
  assert(
    Boolean(finalContext.selectedItem?.summary.includes('Pipeline test')),
    'J1.8: SessionContext updated with created note in selectedItem'
  );

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n=================================================================');
  console.log(`=== PHASE 6I REGRESSION RESULTS: ${passCount}/${totalCount} TESTS PASSED ===`);
  console.log('=================================================================\n');

  if (failCount > 0) {
    console.error(`FAILED: ${failCount} tests failed.`);
    process.exit(1);
  } else {
    console.log('ALL PHASE 6I CROSS-MODULE REGRESSION TESTS PASSED WITH 100% SUCCESS!');
  }
}

runCrossModuleRegression().catch((err) => {
  console.error('Final regression suite execution failed:', err);
  process.exit(1);
});
