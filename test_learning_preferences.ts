/**
 * Comprehensive Test Suite for Phase 6H — Learning & Preferences
 *
 * Verifies:
 * 1. Architecture separation (Volatile SessionContext vs Persistent UserMemory)
 * 2. Explicit preference registration (Brevity, Tone, Emoji, Language, Scoped Dev, Scoped Weather)
 * 3. Temporary vs Stable preferences (SessionContext overrides vs Memory persistence)
 * 4. Behavioral evidence counting and threshold-triggered proposal
 * 5. Confirmation flow for learned preferences (Affirmative vs Negative vs Topic Switch)
 * 6. Preference update and deduplication (Single active entry per key/scope)
 * 7. Contradiction resolution (Overwriting opposing preferences cleanly)
 * 8. Category classification (response_style, language, tone, verbosity, formatting, development, workflow, etc.)
 * 9. Listing/Querying preferences ("Mostrami le mie preferenze")
 * 10. Forgetting specific preferences ("Dimentica che preferisco risposte brevi")
 * 11. Resetting all preferences ("Resetta le mie preferenze") without wiping other user data
 * 12. Sensitive information guard (Passwords, PINs, IBANs, Credit Cards rejected)
 * 13. Effective preferences resolution (Scoped domain + stored + volatile overrides)
 * 14. DO -> VERIFY -> REPORT determinism across all preference actions
 */

import {
  classifyPreferenceCategory,
  formatPreferencesForDisplay,
  getEffectivePreferences,
  getStoredPreferences,
  isPreferenceQuery,
  isPreferenceReset,
  isSensitiveInformation,
  parsePreferenceStatement,
  recordLearningEvidence,
  removePreferenceByKeyOrText,
  saveOrUpdatePreference,
} from './src/services/learning/preferenceManager';
import {
  clearTemporaryPreferences,
  getContext,
  resetContext,
  setPendingPreferenceCandidate,
  setTemporaryPreference,
} from './src/services/context/sessionContext';
import { classifyIntent } from './src/services/router/semanticClassifier';
import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { loadUserMemory, saveUserMemory } from './src/services/router/actionExecutor';
import { MaiaPreference, UserMemory } from './src/types';

// In-memory mock for localStorage
const storageMap: Record<string, string> = {};
const mockStorage = {
  getItem: (k: string) => storageMap[k] ?? null,
  setItem: (k: string, v: string) => {
    storageMap[k] = v;
  },
  removeItem: (k: string) => {
    delete storageMap[k];
  },
  clear: () => {
    Object.keys(storageMap).forEach((k) => delete storageMap[k]);
  },
};
(globalThis as any).localStorage = mockStorage;
(globalThis as any).window = {
  localStorage: mockStorage,
};

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, msg: string): void {
  totalTests++;
  if (!condition) {
    console.error(`❌ [FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passedTests++;
  console.log(`✓ [PASS] ${msg}`);
}

function resetAll(): void {
  mockStorage.clear();
  resetContext();
}

async function runTests() {
  console.log('=== RUNNING PHASE 6H LEARNING & PREFERENCES TEST SUITE ===\n');

  // =========================================================================
  // Section 1: Sensitive Information Protection Guard
  // =========================================================================
  console.log('-- Section 1: Sensitive Information & Privacy Guard --');
  resetAll();

  assert(isSensitiveInformation('La mia password è segreta123') === true, 'Test 1.1: Detects password as sensitive');
  assert(isSensitiveInformation('Il mio codice PIN è 4455') === true, 'Test 1.2: Detects PIN as sensitive');
  assert(isSensitiveInformation('La mia carta di credito è 4000 1234') === true, 'Test 1.3: Detects credit card as sensitive');
  assert(isSensitiveInformation('Il mio IBAN è IT60X0542811101') === true, 'Test 1.4: Detects IBAN as sensitive');
  assert(isSensitiveInformation('Preferisco risposte brevi') === false, 'Test 1.5: Normal preference is NOT sensitive');

  const sensitiveOrch = await orchestrateUserInput('Ricordati che la mia password è admin123', Date.now());
  assert(sensitiveOrch.type === 'HANDLED_LOCAL', 'Test 1.6: Sensitive info handled locally with rejection');
  assert(
    sensitiveOrch.feedbackText?.includes('sicurezza') || sensitiveOrch.feedbackText?.includes('riservatezza') || false,
    'Test 1.7: Clear privacy rejection feedback given'
  );
  const memAfterSensitive = loadUserMemory();
  assert(
    !memAfterSensitive.preferences?.some((p) => p.includes('password')),
    'Test 1.8: Sensitive info never stored in persistent memory'
  );

  // =========================================================================
  // Section 2: Explicit Preference Registration
  // =========================================================================
  console.log('\n-- Section 2: Explicit Preference Registration --');
  resetAll();

  // 2.1 Brevity
  const resBrevity = await orchestrateUserInput('Preferisco risposte brevi', Date.now());
  assert(resBrevity.type === 'HANDLED_LOCAL', 'Test 2.1: "Preferisco risposte brevi" handled locally');
  assert(resBrevity.dataAffected === true, 'Test 2.1b: dataAffected is true');
  let mem = loadUserMemory();
  assert(mem.structuredPreferences?.some((p) => p.key === 'verbosity' && p.value === 'concise') === true, 'Test 2.2: Stored in structuredPreferences as verbosity: concise');
  assert(mem.structuredPreferences?.[0].source === 'EXPLICIT', 'Test 2.3: Preference source is EXPLICIT');

  // 2.2 Direct Tone
  const resDirect = await orchestrateUserInput('Preferisco che tu sia diretto', Date.now());
  assert(resDirect.type === 'HANDLED_LOCAL', 'Test 2.4: "Preferisco che tu sia diretto" handled locally');
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.some((p) => p.key === 'tone' && p.value === 'direct') === true, 'Test 2.5: Tone direct stored');


  // Long-form preference statement previously failed to save in Preview.
  const resDirectLong = await orchestrateUserInput('Preferisco che tu mi risponda sempre in modo diretto, senza girarci intorno. Memorizza questa preferenza.', Date.now());
  assert(resDirectLong.type === 'HANDLED_LOCAL' && resDirectLong.dataAffected === true, 'Test 2.5a: Long-form direct-response preference saved locally');
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.some((p) => p.key === 'tone' && p.value === 'direct') === true, 'Test 2.5b: Long-form preference persisted as tone: direct');
  const resDirectRead = await orchestrateUserInput('Come preferisco che tu mi risponda?', Date.now());
  assert(resDirectRead.type === 'HANDLED_LOCAL' && /dirett/i.test(resDirectRead.feedbackText || ''), 'Test 2.5c: Direct-response preference read locally');

  // 2.3 Emoji Minimization
  const resEmoji = await orchestrateUserInput('Non usare troppi emoji', Date.now());
  assert(resEmoji.type === 'HANDLED_LOCAL', 'Test 2.6: "Non usare troppi emoji" handled locally');
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.some((p) => p.key === 'formatting_emoji') === true, 'Test 2.7: formatting_emoji stored');

  // 2.4 Language Preference
  const resLang = await orchestrateUserInput("Preferisco l'italiano", Date.now());
  assert(resLang.type === 'HANDLED_LOCAL', 'Test 2.8: "Preferisco l\'italiano" handled locally');
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.some((p) => p.key === 'language' && p.value === 'italian') === true, 'Test 2.9: Language stored');

  // 2.5 Scoped Development Preference
  const resDev = await orchestrateUserInput('Quando sviluppo MAIA voglio risposte tecniche', Date.now());
  assert(resDev.type === 'HANDLED_LOCAL', 'Test 2.10: Scoped dev preference handled locally');
  mem = loadUserMemory();
  const devPref = mem.structuredPreferences?.find((p) => p.scope === 'development');
  assert(devPref !== undefined, 'Test 2.11: Scoped preference has scope="development"');
  assert(devPref?.category === 'development', 'Test 2.12: Category classified as development');

  // 2.6 Scoped Weather Preference
  const resWeather = await orchestrateUserInput('Quando chiedo il meteo dimmi anche il vento', Date.now());
  assert(resWeather.type === 'HANDLED_LOCAL', 'Test 2.13: Scoped weather preference handled locally');
  mem = loadUserMemory();
  assert(mem.structuredPreferences?.some((p) => p.key === 'weather_wind') === true, 'Test 2.14: weather_wind stored in memory');

  // =========================================================================
  // Section 3: Temporary vs Stable Preferences (Zero-Persistence on Temporary)
  // =========================================================================
  console.log('\n-- Section 3: Temporary vs Stable Preferences --');
  resetAll();

  // Baseline empty memory
  saveUserMemory({ userName: 'TestUser', preferences: [], structuredPreferences: [] } as any);

  // Temporary preference: "Per questa risposta sii molto dettagliata"
  const resTemp = await orchestrateUserInput('Per questa risposta sii molto dettagliata', Date.now());
  assert(resTemp.type === 'HANDLED_LOCAL', 'Test 3.1: Temporary preference override handled locally');
  assert(resTemp.dataAffected === false, 'Test 3.2: dataAffected is false (no persistent changes)');

  const ctxAfterTemp = getContext();
  assert(ctxAfterTemp.temporaryPreferences?.verbosity === 'detailed', 'Test 3.3: Temporary preference recorded in volatile SessionContext');

  const memAfterTemp = loadUserMemory();
  assert((memAfterTemp.structuredPreferences?.length || 0) === 0, 'Test 3.4: Persistent memory strictly untouched by temporary preference');
  assert((memAfterTemp.preferences?.length || 0) === 0, 'Test 3.5: No string preferences created in storage');

  // Stable preference: "Da ora in poi preferisco risposte sintetiche"
  const resStable = await orchestrateUserInput('Da ora in poi preferisco risposte sintetiche', Date.now());
  assert(resStable.type === 'HANDLED_LOCAL', 'Test 3.6: Stable preference handled locally');
  assert(resStable.dataAffected === true, 'Test 3.7: dataAffected is true for stable preference');
  const memAfterStable = loadUserMemory();
  assert(memAfterStable.structuredPreferences?.some((p) => p.key === 'verbosity' && p.value === 'concise') === true, 'Test 3.8: Stable preference saved to persistent memory');

  // =========================================================================
  // Section 4: Behavioral Evidence & Threshold-Triggered Confirmation
  // =========================================================================
  console.log('\n-- Section 4: Behavioral Evidence & Confirmation Proposal --');
  resetAll();

  // First occurrence of behavioral cue: "Fammi una risposta breve"
  const resBehav1 = await orchestrateUserInput('Fammi una risposta breve', Date.now());
  assert(resBehav1.type === 'HANDLED_LOCAL', 'Test 4.1: First behavioral cue handled locally');
  let memBehav = loadUserMemory();
  assert((memBehav.structuredPreferences?.length || 0) === 0, 'Test 4.2: Single behavioral cue does NOT create permanent preference');

  const ctxBehav1 = getContext();
  const evid1 = ctxBehav1.learningEvidence?.find((e) => e.key === 'verbosity');
  assert(evid1?.count === 1, 'Test 4.3: Learning evidence count incremented to 1 in SessionContext');
  assert(ctxBehav1.pendingPreferenceCandidate === null || ctxBehav1.pendingPreferenceCandidate === undefined, 'Test 4.4: No confirmation proposed on first occurrence');

  // Second occurrence of behavioral cue: "Fammi una risposta breve"
  const resBehav2 = await orchestrateUserInput('Fammi una risposta breve', Date.now());
  assert(resBehav2.type === 'HANDLED_LOCAL', 'Test 4.5: Second behavioral cue handled locally');
  assert(
    Boolean(resBehav2.feedbackText?.includes('Ho notato') && resBehav2.feedbackText?.includes('Vuoi che lo ricordi')),
    'Test 4.6: Second occurrence triggers confirmation proposal'
  );

  const ctxBehav2 = getContext();
  assert(ctxBehav2.pendingPreferenceCandidate !== null && ctxBehav2.pendingPreferenceCandidate !== undefined, 'Test 4.7: pendingPreferenceCandidate set in SessionContext');
  assert(ctxBehav2.pendingPreferenceCandidate?.key === 'verbosity', 'Test 4.8: Candidate targets verbosity');

  // Confirm with "Sì"
  const resConfirm = await orchestrateUserInput('Sì', Date.now());
  assert(resConfirm.type === 'HANDLED_LOCAL', 'Test 4.9: Confirmation handled locally');
  assert(resConfirm.dataAffected === true, 'Test 4.10: Confirmed preference persisted to memory');

  memBehav = loadUserMemory();
  const confirmedPref = memBehav.structuredPreferences?.find((p) => p.key === 'verbosity');
  assert(confirmedPref !== undefined, 'Test 4.11: Preference exists in UserMemory after confirmation');
  assert(confirmedPref?.source === 'CONFIRMED', 'Test 4.12: Preference source is marked CONFIRMED');

  const ctxAfterConfirm = getContext();
  assert(ctxAfterConfirm.pendingPreferenceCandidate === null, 'Test 4.13: pendingPreferenceCandidate cleared after confirmation');

  // Test Negative confirmation ("No")
  resetAll();
  await orchestrateUserInput('Fammi una risposta breve', Date.now());
  await orchestrateUserInput('Fammi una risposta breve', Date.now()); // Triggers proposal
  const resDecline = await orchestrateUserInput('No', Date.now());
  assert(resDecline.type === 'HANDLED_LOCAL', 'Test 4.14: Decline handled locally');
  assert(resDecline.dataAffected === false, 'Test 4.15: Decline leaves data unaffected');
  const memDeclined = loadUserMemory();
  assert((memDeclined.structuredPreferences?.length || 0) === 0, 'Test 4.16: Declined candidate was NOT saved to memory');

  // =========================================================================
  // Section 5: Preference Updates, Deduplication & Contradictions
  // =========================================================================
  console.log('\n-- Section 5: Preference Updates, Deduplication & Contradictions --');
  resetAll();

  // Step 1: Save initial brevity preference
  await orchestrateUserInput('Preferisco risposte brevi', Date.now());
  let memUpdate = loadUserMemory();
  assert(memUpdate.structuredPreferences?.length === 1, 'Test 5.1: Exactly 1 preference registered');
  assert(memUpdate.structuredPreferences?.[0].value === 'concise', 'Test 5.2: Initial value is concise');

  const initialUpdatedAt = memUpdate.structuredPreferences?.[0]?.updatedAt ?? 0;

  // Step 2: Later, user changes preference to detailed responses
  await orchestrateUserInput('Da ora preferisco risposte più dettagliate', Date.now() + 1000);
  memUpdate = loadUserMemory();
  assert(memUpdate.structuredPreferences?.length === 1, 'Test 5.3: Deduplication guaranteed - still exactly 1 preference');
  assert(memUpdate.structuredPreferences?.[0]?.value === 'detailed', 'Test 5.4: Value successfully updated to detailed');
  assert((memUpdate.structuredPreferences?.[0]?.updatedAt ?? 0) >= initialUpdatedAt, 'Test 5.5: updatedAt timestamp refreshed');

  // Verify conflicting strings were resolved in preferences array
  assert(
    !memUpdate.preferences.some((s) => /sintetic|brev/i.test(s)),
    'Test 5.6: Conflicting brevity strings removed from preferences array'
  );
  assert(
    memUpdate.preferences.some((s) => /dettagliat/i.test(s)),
    'Test 5.7: New detailed preference string present'
  );


  // Natural-language variants from the AI Studio preference failures must map
  // to structured values rather than falling through to the provider.
  const articulatedPref = parsePreferenceStatement('Vorrei che tu fossi più articolata');
  assert(articulatedPref.isPreference && articulatedPref.key === 'verbosity' && articulatedPref.value === 'detailed',
    'Test 5.8: Articulated response request is parsed as detailed verbosity');
  const directPref = parsePreferenceStatement('Vorrei che tu fossi più diretta');
  assert(directPref.isPreference && directPref.key === 'tone' && directPref.value === 'direct',
    'Test 5.9: Natural directness request is parsed as direct tone');



  // =========================================================================
  // Section 6: Category Classification
  // =========================================================================
  console.log('\n-- Section 6: Category Classification --');
  assert(classifyPreferenceCategory('verbosity') === 'verbosity', 'Test 6.1: verbosity category');
  assert(classifyPreferenceCategory('tone') === 'tone', 'Test 6.2: tone category');
  assert(classifyPreferenceCategory('language') === 'language', 'Test 6.3: language category');
  assert(classifyPreferenceCategory('formatting_emoji') === 'formatting', 'Test 6.4: formatting category');
  assert(classifyPreferenceCategory('technical_depth') === 'response_style', 'Test 6.5: response_style default');
  assert(classifyPreferenceCategory('technical_depth', 'sviluppo MAIA codice') === 'development', 'Test 6.6: development category with rawText');
  assert(classifyPreferenceCategory('workflow_hours', 'orario di lavoro') === 'workflow', 'Test 6.7: workflow category');
  assert(classifyPreferenceCategory('hobbies', 'musica classica') === 'interests', 'Test 6.8: interests category');

  // =========================================================================
  // Section 7: Querying / Displaying Preferences
  // =========================================================================
  console.log('\n-- Section 7: Querying Preferences ("Mostrami le mie preferenze") --');
  assert(isPreferenceQuery('Mostra tutte le preferenze che hai salvato'), 'Test 7.0: Saved-preferences phrasing recognized');
  assert(isPreferenceQuery('Mostrami tutte le mie preferenze'), 'Test 7.0b: All-preferences phrasing recognized');
  const mixedPreferenceDisplay = formatPreferencesForDisplay(
    [{ key: 'tone', value: 'direct', rawText: 'Preferisco risposte dirette' } as any],
    ['Preferisco risposte dirette', 'Preferisco che tu usi esempi pratici']
  );
  assert(mixedPreferenceDisplay.includes('Preferisco che tu usi esempi pratici'), 'Test 7.0c: Legacy preferences are included alongside structured preferences');
  assert(mixedPreferenceDisplay.split('Preferisco risposte dirette').length - 1 === 1, 'Test 7.0d: Duplicate structured/legacy preferences are deduplicated');
  resetAll();

  // Query on empty memory
  const resEmptyQuery = await orchestrateUserInput('Mostrami le mie preferenze', Date.now());
  assert(resEmptyQuery.type === 'HANDLED_LOCAL', 'Test 7.1: Empty preference query handled locally');
  assert(
    Boolean(resEmptyQuery.feedbackText?.includes('Non ho ancora memorizzato preferenze')),
    'Test 7.2: Helpful message when no preferences stored'
  );

  // Add 2 preferences
  await orchestrateUserInput('Preferisco risposte brevi', Date.now());
  await orchestrateUserInput('Preferisco che tu sia diretto', Date.now());

  const resListQuery = await orchestrateUserInput('Mostrami le mie preferenze', Date.now());
  assert(resListQuery.type === 'HANDLED_LOCAL', 'Test 7.3: Populated preference query handled locally');
  assert(Boolean(resListQuery.feedbackText?.includes('Ecco le tue preferenze attive:')), 'Test 7.4: Display header present');
  assert(
    Boolean(resListQuery.feedbackText?.includes('diretto') || resListQuery.feedbackText?.includes('sintetic')),
    'Test 7.5: Listed preferences contain recorded items'
  );

  // Check alternative Italian phrasing
  const resQuali = await orchestrateUserInput('Quali sono le mie preferenze?', Date.now());
  assert(resQuali.type === 'HANDLED_LOCAL', 'Test 7.6: "Quali sono le mie preferenze?" handled locally');

  // =========================================================================
  // Section 8: Forgetting Specific Preference
  // =========================================================================
  console.log('\n-- Section 8: Forgetting Specific Preference --');
  resetAll();

  await orchestrateUserInput('Preferisco risposte brevi', Date.now());
  await orchestrateUserInput('Preferisco che tu sia diretto', Date.now());
  let memBeforeForget = loadUserMemory();
  assert(memBeforeForget.structuredPreferences?.length === 2, 'Test 8.1: Memory has 2 preferences');

  // Delete single preference requires safety confirmation
  const resReqConf = await orchestrateUserInput('Dimentica che preferisco risposte brevi', Date.now());
  assert(resReqConf.type === 'CONFIRMATION_REQUIRED', 'Test 8.2: Deleting specific preference requires confirmation');

  // Confirm deletion
  const resConfForget = await orchestrateUserInput('Sì', Date.now());
  assert(resConfForget.type === 'HANDLED_LOCAL', 'Test 8.3: Confirmed deletion executed');
  assert(resConfForget.dataAffected === true, 'Test 8.4: dataAffected is true');

  const memAfterForget = loadUserMemory();
  assert(memAfterForget.structuredPreferences?.length === 1, 'Test 8.5: Exactly 1 preference remains');
  assert(
    !memAfterForget.structuredPreferences?.some((p) => p.key === 'verbosity'),
    'Test 8.6: Brevity preference removed'
  );
  assert(
    Boolean(memAfterForget.structuredPreferences?.some((p) => p.key === 'tone')),
    'Test 8.7: Tone preference kept intact'
  );

  // =========================================================================
  // Section 9: Resetting All Preferences
  // =========================================================================
  console.log('\n-- Section 9: Resetting All Preferences ("Resetta le mie preferenze") --');
  resetAll();

  // Populate user data: profile + notes + preferences
  saveUserMemory({
    userName: 'Maurizio',
    userCity: 'Malta',
    preferences: ['Preferisco risposte brevi'],
    structuredPreferences: [
      {
        id: 'pref-1',
        key: 'verbosity',
        value: 'concise',
        category: 'verbosity',
        confidence: 'HIGH',
        source: 'EXPLICIT',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rawText: 'Preferisco risposte brevi',
      },
    ],
    notes: ['Nota importante'],
    interests: ['AI'],
    projects: ['MAIA'],
  } as any);

  // "Resetta le mie preferenze" requires confirmation for high destructive action
  const resResetReq = await orchestrateUserInput('Resetta le mie preferenze', Date.now());
  assert(resResetReq.type === 'CONFIRMATION_REQUIRED', 'Test 9.1: Resetting all preferences requires safety confirmation');
  assert(Boolean(resResetReq.feedbackText?.includes('preferenze')), 'Test 9.2: Prompt specifically mentions preferences');

  // Confirm reset
  const resResetConf = await orchestrateUserInput('Sì', Date.now());
  assert(resResetConf.type === 'HANDLED_LOCAL', 'Test 9.3: Confirmed reset executed');
  assert(resResetConf.dataAffected === true, 'Test 9.4: dataAffected is true');

  const memAfterReset = loadUserMemory();
  assert((memAfterReset.preferences?.length || 0) === 0, 'Test 9.5: Preferences array is empty');
  assert((memAfterReset.structuredPreferences?.length || 0) === 0, 'Test 9.6: structuredPreferences is empty');

  // CRITICAL ARCHITECTURAL GUARANTEE: User profile, notes and other memories must NOT be wiped!
  assert(memAfterReset.userName === 'Maurizio', 'Test 9.7: User name preserved after preference reset');
  assert(memAfterReset.userCity === 'Malta', 'Test 9.8: User city preserved');
  assert(memAfterReset.notes?.length === 1, 'Test 9.9: Personal notes preserved');
  assert(memAfterReset.projects?.length === 1, 'Test 9.10: Projects preserved');

  // =========================================================================
  // Section 10: Effective Preferences Resolution
  // =========================================================================
  console.log('\n-- Section 10: Effective Preferences Resolution --');
  resetAll();

  const baseMemory: UserMemory = {
    userName: 'Maurizio',
    preferences: ['Preferisco risposte sintetiche'],
    interests: [],
    projects: [],
    notes: [],
    structuredPreferences: [
      {
        id: 'p1',
        key: 'verbosity',
        value: 'concise',
        category: 'verbosity',
        confidence: 'HIGH',
        source: 'EXPLICIT',
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'p2',
        key: 'technical_depth',
        value: 'technical',
        category: 'development',
        scope: 'development',
        confidence: 'HIGH',
        source: 'EXPLICIT',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  };

  // 10.1 Global resolution without special scope
  const eff1 = getEffectivePreferences(undefined, baseMemory);
  assert(eff1.verbosity === 'concise', 'Test 10.1: Global verbosity preference resolved');
  assert(eff1.technical_depth === undefined, 'Test 10.2: Scoped development preference NOT active in general domain');

  // 10.2 Scoped resolution with domain: "development"
  const effDev = getEffectivePreferences({ domain: 'development' }, baseMemory);
  assert(effDev.verbosity === 'concise', 'Test 10.3: Global verbosity still active in development');
  assert(effDev.technical_depth === 'technical', 'Test 10.4: Scoped development preference active when domain is development');

  // 10.3 Volatile SessionContext temporary override beats persistent preference
  const sessionCtxWithOverride = {
    ...getContext(),
    temporaryPreferences: { verbosity: 'detailed' },
  };
  const effOverride = getEffectivePreferences(undefined, baseMemory, sessionCtxWithOverride as any);
  assert(effOverride.verbosity === 'detailed', 'Test 10.5: Volatile SessionContext override takes precedence over persistent preference');

  // =========================================================================
  // Section 11: Local Action Candidates Disambiguation
  // =========================================================================
  console.log('\n-- Section 11: Disambiguation with Notes, Reminders & Gemini --');
  resetAll();

  // "Aggiungi una nota: preferisco il tè" -> NOTE, not preference!
  const noteIntent = classifyIntent('Aggiungi una nota: preferisco il tè', getContext());
  assert(noteIntent.entity === 'NOTE', 'Test 11.1: Note with "preferisco" keyword correctly classified as NOTE');

  // "Crea un promemoria per domani" -> REMINDER
  const remIntent = classifyIntent('Crea un promemoria per domani alle 10', getContext());
  assert(remIntent.entity === 'REMINDER', 'Test 11.2: Reminder correctly classified as REMINDER');

  // "Chi era Napoleone?" -> Cognitive EXPLAIN (Gemini fallthrough)
  const cogIntent = classifyIntent('Chi era Napoleone?', getContext());
  assert(cogIntent.verb === 'EXPLAIN' && cogIntent.isLocalActionCandidate === false, 'Test 11.3: Cognitive question routed to Gemini');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(`\n=== RESULTS: ${passedTests}/${totalTests} TESTS PASSED ===`);
  if (passedTests === totalTests) {
    console.log('ALL PHASE 6H LEARNING & PREFERENCES TESTS PASSED WITH 100% SUCCESS!');
  } else {
    console.error(`FAILED: ${totalTests - passedTests} tests failed.`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});
