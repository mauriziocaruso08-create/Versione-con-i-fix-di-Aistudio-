/**
 * Automated Test Suite for FASE 6G — Web Search Hardening
 *
 * Tests all 12 core requirements:
 * 1. Semantic search intent recognition
 * 2. Web Capability registration and supported verbs
 * 3. Local vs Web disambiguation
 * 4. Clean query extraction from conversational utterances
 * 5. Google Search Grounding error & result handling
 * 6. Authentic source citations attribution (no hallucinations)
 * 7. Freshness classification (CURRENT, HISTORICAL, GENERAL, EXPLICIT_WEB)
 * 8. Failure and recovery handling (429 quota, timeout, network error)
 * 9. DO -> VERIFY -> REPORT verification
 * 10. Context update in SessionContext (working memory, volatile)
 * 11. Follow-up queries and context switching
 * 12. Conversational variants & polite wrappers
 */

import { classifyIntent } from './src/services/router/semanticClassifier';
import {
  classifyFreshness,
  extractCleanSearchQuery,
  isWebSearchCandidate,
} from './src/services/router/searchQueryExtractor';
import { capabilityRegistry } from './src/services/capabilities/capabilityRegistry';
import { WebCapability } from './src/services/capabilities/webCapability';
import { executeWebSearch } from './src/services/webSearchService';
import {
  getContext,
  resetContext,
  setActiveEntity,
  setLastWebSearch,
} from './src/services/context/sessionContext';
import { orchestrateUserInput } from './src/services/router/maiaOrchestrator';
import { saveNotes } from './src/utils/notesManager';
import { saveReminders } from './src/utils/reminderManager';

// Mock localStorage for test runtime
const mockStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => mockStorage[k] || null,
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

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: any): void {
  if (condition) {
    passCount++;
    console.log(`✓ [PASS] ${testName}`);
  } else {
    failCount++;
    console.error(`✗ [FAIL] ${testName}`, detail !== undefined ? detail : '');
  }
}

// Global fetch mock controller
let currentFetchMock: ((url: string, opts: any) => Promise<any>) | null = null;
(global as any).fetch = (url: string, opts: any) => {
  if (currentFetchMock) {
    return currentFetchMock(url, opts);
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'mock query',
      summary: 'Mock search result summary.',
      sources: [{ title: 'Fonte Test', url: 'https://example.com/test' }],
    }),
  });
};

async function runTests() {
  console.log('\n=== RUNNING WEB SEARCH HARDENING TESTS (FASE 6G) ===\n');

  const now = 1700000000000;
  resetContext(now);
  saveNotes([]);
  saveReminders([]);

  // =========================================================================
  // SECTION 1: SEMANTIC SEARCH INTENT RECOGNITION
  // =========================================================================
  console.log('-- Section 1: Semantic Search Intent Recognition --');

  const intent1 = classifyIntent('Cerca le ultime notizie su Marte', getContext(now));
  assert(
    intent1.verb === 'SEARCH' && intent1.entity === 'WEB' && intent1.parameters.freshness === 'CURRENT',
    'Test 1.1: "Cerca le ultime notizie su Marte" classified as WEB SEARCH (CURRENT)'
  );

  const intent2 = classifyIntent('Cosa è successo oggi riguardo alle elezioni?', getContext(now));
  assert(
    intent2.verb === 'SEARCH' && intent2.entity === 'WEB' && intent2.parameters.freshness === 'CURRENT',
    'Test 1.2: "Cosa è successo oggi riguardo alle elezioni?" classified as WEB SEARCH (CURRENT)'
  );

  const intent3 = classifyIntent('Quanto costa attualmente lo Xiaomi 14?', getContext(now));
  assert(
    intent3.verb === 'SEARCH' && intent3.entity === 'WEB' && intent3.parameters.category === 'technology',
    'Test 1.3: "Quanto costa attualmente lo Xiaomi 14?" classified as WEB SEARCH (technology)'
  );

  const intent4 = classifyIntent('Controlla online le recensioni del ristorante', getContext(now));
  assert(
    intent4.verb === 'SEARCH' && intent4.entity === 'WEB' && intent4.parameters.freshness === 'EXPLICIT_WEB',
    'Test 1.4: "Controlla online le recensioni..." classified as WEB SEARCH (EXPLICIT_WEB)'
  );

  const intent5 = classifyIntent('Trova informazioni sul web su Malta', getContext(now));
  assert(
    intent5.verb === 'SEARCH' && intent5.entity === 'WEB' && intent5.parameters.freshness === 'EXPLICIT_WEB',
    'Test 1.5: "Trova informazioni sul web su Malta" classified as WEB SEARCH'
  );

  const intent6 = classifyIntent('Qual è il prezzo attuale di Bitcoin?', getContext(now));
  assert(
    intent6.verb === 'SEARCH' && intent6.entity === 'WEB',
    'Test 1.6: "Qual è il prezzo attuale di Bitcoin?" classified as WEB SEARCH'
  );

  const intent7 = classifyIntent('Verifica se domani c\'è sciopero dei treni', getContext(now));
  assert(
    intent7.verb === 'SEARCH' && intent7.entity === 'WEB',
    'Test 1.7: "Verifica se domani c\'è sciopero dei treni" classified as WEB SEARCH'
  );

  const intent8 = classifyIntent('Cosa dice Internet sulla fusione nucleare?', getContext(now));
  assert(
    intent8.verb === 'SEARCH' && intent8.entity === 'WEB' && intent8.parameters.freshness === 'EXPLICIT_WEB',
    'Test 1.8: "Cosa dice Internet sulla fusione nucleare?" classified as WEB SEARCH'
  );

  const intent9 = classifyIntent('Che si dice ultimamente di OpenAI?', getContext(now));
  assert(
    intent9.verb === 'SEARCH' && intent9.entity === 'WEB' && intent9.parameters.freshness === 'CURRENT',
    'Test 1.9: "Che si dice ultimamente di OpenAI?" classified as WEB SEARCH (CURRENT)'
  );

  // =========================================================================
  // SECTION 2: WEB CAPABILITY REGISTRATION & VERBS
  // =========================================================================
  console.log('\n-- Section 2: Capability Registry Integration --');

  const webCap = capabilityRegistry.getCapability('WEB');
  assert(webCap instanceof WebCapability, 'Test 2.1: WebCapability registered in capabilityRegistry');
  assert(
    Boolean(
      webCap?.supportedVerbs.includes('SEARCH') &&
        webCap?.supportedVerbs.includes('READ') &&
        webCap?.supportedVerbs.includes('EXPLAIN')
    ),
    'Test 2.2: WebCapability supports SEARCH, READ, and EXPLAIN'
  );

  // =========================================================================
  // SECTION 3: LOCAL VS WEB DISAMBIGUATION
  // =========================================================================
  console.log('\n-- Section 3: Local vs Web Disambiguation --');

  const local1 = classifyIntent('Mostra i miei promemoria', getContext(now));
  assert(
    local1.entity === 'REMINDER' && local1.verb === 'READ' && local1.isLocalActionCandidate === true,
    'Test 3.1: "Mostra i miei promemoria" handled as LOCAL REMINDER, NOT Web'
  );

  const local2 = classifyIntent('Cancella quella nota', getContext(now));
  assert(
    local2.entity === 'NOTE' && local2.verb === 'DELETE' && local2.isLocalActionCandidate === true,
    'Test 3.2: "Cancella quella nota" handled as LOCAL NOTE, NOT Web'
  );

  const local3 = classifyIntent('Cerca tra le mie note la ricetta della pizza', getContext(now));
  assert(
    local3.entity === 'NOTE' && local3.verb === 'READ' && local3.isLocalActionCandidate === true,
    'Test 3.3: "Cerca tra le mie note la ricetta della pizza" handled as LOCAL NOTE, NOT Web'
  );

  const local4 = classifyIntent('Cosa ricordi di me?', getContext(now));
  assert(
    local4.entity === 'MEMORY' && local4.verb === 'READ' && local4.isLocalActionCandidate === true,
    'Test 3.4: "Cosa ricordi di me?" handled as LOCAL MEMORY, NOT Web'
  );

  const local5 = classifyIntent('Aggiungi una nota: comprare pane', getContext(now));
  assert(
    local5.entity === 'NOTE' && local5.verb === 'CREATE' && local5.isLocalActionCandidate === true,
    'Test 3.5: "Aggiungi una nota: comprare pane" handled as LOCAL NOTE, NOT Web'
  );

  // =========================================================================
  // SECTION 4: QUERY EXTRACTION & CLEANING
  // =========================================================================
  console.log('\n-- Section 4: Query Extraction & Cleaning --');

  const extraction1 = extractCleanSearchQuery(
    'Mi puoi controllare online quanto costa oggi lo Xiaomi X?'
  );
  assert(
    !extraction1.cleanQuery.includes('Mi puoi controllare online') &&
      extraction1.cleanQuery.includes('Xiaomi X'),
    `Test 4.1: Clean query strips conversational fluff -> "${extraction1.cleanQuery}"`
  );

  const extraction2 = extractCleanSearchQuery('Cerca le ultime notizie su Marte.');
  assert(
    extraction2.cleanQuery === 'ultime notizie Marte' || extraction2.cleanQuery === 'Marte',
    `Test 4.2: Clean query extracts topic -> "${extraction2.cleanQuery}"`
  );

  const extraction3 = extractCleanSearchQuery('Cosa dice Internet sulla fusione nucleare?');
  assert(
    extraction3.cleanQuery === 'fusione nucleare',
    `Test 4.3: Clean query extracts topic -> "${extraction3.cleanQuery}"`
  );

  const extraction4 = extractCleanSearchQuery('Vorrei sapere cosa si trova online sui voli per Tokyo');
  assert(
    extraction4.cleanQuery.includes('voli per Tokyo'),
    `Test 4.4: Clean query removes "Vorrei sapere..." -> "${extraction4.cleanQuery}"`
  );

  // Raw query preservation
  const rawPreserved = classifyIntent(
    'Senti, mi puoi cercare online le recensioni dello Xiaomi 14?'
  );
  assert(
    rawPreserved.rawQuery === 'Senti, mi puoi cercare online le recensioni dello Xiaomi 14',
    'Test 4.5: rawQuery is intact in SemanticIntent'
  );
  assert(
    Boolean(rawPreserved.parameters.searchQuery?.includes('recensioni dello Xiaomi 14') ||
      rawPreserved.parameters.searchQuery?.includes('Xiaomi 14')),
    `Test 4.6: parameters.searchQuery is cleaned -> "${rawPreserved.parameters.searchQuery}"`
  );

  // =========================================================================
  // SECTION 5: COGNITIVE VS WEB DISTINCTION
  // =========================================================================
  console.log('\n-- Section 5: Cognitive vs Web Distinction --');

  const cog1 = classifyIntent('Chi era Napoleone?');
  assert(
    cog1.verb === 'EXPLAIN' && cog1.entity === 'UNKNOWN' && cog1.isLocalActionCandidate === false,
    'Test 5.1: "Chi era Napoleone?" routes to cognitive EXPLAIN (Gemini fallthrough)'
  );

  const cog2 = classifyIntent('Che cos\'è la fotosintesi?');
  assert(
    cog2.verb === 'EXPLAIN' && cog2.entity === 'UNKNOWN',
    'Test 5.2: "Che cos\'è la fotosintesi?" routes to cognitive EXPLAIN'
  );

  const cog3 = classifyIntent('Spiegami la teoria della relatività');
  assert(
    cog3.verb === 'EXPLAIN' && cog3.entity === 'UNKNOWN',
    'Test 5.3: "Spiegami la teoria della relatività" routes to cognitive EXPLAIN'
  );

  const cog4 = classifyIntent('Quanto fa 25 * 4?');
  assert(
    cog4.verb === 'EXPLAIN' && cog4.entity === 'UNKNOWN',
    'Test 5.4: Math question routes to cognitive EXPLAIN'
  );

  // Explicit override: "Cerca sul web chi era Napoleone"
  const overrideWeb = classifyIntent('Cerca sul web chi era Napoleone');
  assert(
    overrideWeb.verb === 'SEARCH' && overrideWeb.entity === 'WEB',
    'Test 5.5: "Cerca sul web chi era Napoleone" explicitly routes to WEB SEARCH'
  );

  // =========================================================================
  // SECTION 6: FRESHNESS CLASSIFICATION
  // =========================================================================
  console.log('\n-- Section 6: Freshness Classification --');

  assert(
    classifyFreshness('Quanto costa oggi il petrolio?') === 'CURRENT',
    'Test 6.1: "oggi" classified as CURRENT'
  );
  assert(
    classifyFreshness('Previsioni meteo per Roma') === 'CURRENT',
    'Test 6.2: "meteo" classified as CURRENT'
  );
  assert(
    classifyFreshness('Chi era Napoleone?') === 'HISTORICAL',
    'Test 6.3: "Chi era Napoleone?" classified as HISTORICAL'
  );
  assert(
    classifyFreshness('Cos\'è la fotosintesi?') === 'GENERAL',
    'Test 6.4: "Cos\'è la fotosintesi?" classified as GENERAL'
  );
  assert(
    classifyFreshness('Cerca sul web informazioni sui droni') === 'EXPLICIT_WEB',
    'Test 6.5: "sul web" classified as EXPLICIT_WEB'
  );

  // =========================================================================
  // SECTION 7: DO -> VERIFY -> REPORT & SOURCES ATTRIBUTION
  // =========================================================================
  console.log('\n-- Section 7: DO -> VERIFY -> REPORT & Citations Attribution --');

  // Case A: Real sources available
  currentFetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'Xiaomi 14 prezzo',
      summary: 'Lo Xiaomi 14 costa attualmente circa 899 euro in Italia.',
      sources: [
        { title: 'Xiaomi Italia Ufficiale', url: 'https://mi.com/it/xiaomi-14' },
        { title: 'TuttoAndroid', url: 'https://tuttoandroid.net/xiaomi-14-prezzo' },
      ],
    }),
  });

  const resA = await orchestrateUserInput('Quanto costa attualmente lo Xiaomi 14?', now);
  assert(resA.type === 'HANDLED_LOCAL', 'Test 7.1: Search handled locally');
  assert(
    Boolean(resA.feedbackText?.includes('899 euro')),
    'Test 7.2: Feedback text contains summary'
  );
  assert(
    Boolean(resA.feedbackText?.includes('https://mi.com/it/xiaomi-14')),
    'Test 7.3: Sources properly attributed in feedback'
  );
  assert(
    resA.sources !== undefined && resA.sources.length === 2,
    'Test 7.4: Verified sources list returned'
  );

  // Case B: No sources provided by provider -> DO NOT invent fake sources!
  currentFetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'concetto generale',
      summary: 'Risposta basata sui dati attuali senza link specifici.',
      sources: [],
    }),
  });

  const resB = await orchestrateUserInput('Cerca informazioni sui voli per Tokyo', now);
  assert(
    Boolean(!resB.feedbackText?.includes('http')),
    'Test 7.5: When no sources returned, MAIA does NOT simulate fake citations'
  );
  assert(
    resB.sources !== undefined && resB.sources.length === 0,
    'Test 7.6: Sources list is empty array'
  );

  // Case C: Empty or not found results
  currentFetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'xyz123nonexistent',
      summary: 'Nessun risultato rilevante trovato per questa ricerca.',
      sources: [],
    }),
  });

  const resC = await orchestrateUserInput('Cerca online xyz123nonexistent', now);
  assert(
    Boolean(resC.feedbackText?.includes('Non ho trovato') || resC.feedbackText?.includes('Nessun risultato')),
    'Test 7.7: Non-existent results clearly reported without hallucinating facts'
  );

  // =========================================================================
  // SECTION 8: FAILURE & RECOVERY (429 QUOTA, TIMEOUT, NETWORK)
  // =========================================================================
  console.log('\n-- Section 8: Failure & Recovery Handling --');

  // Case A: 429 Quota Exhaustion
  currentFetchMock = async () => ({
    ok: false,
    status: 429,
    json: async () => ({
      success: false,
      error: 'Quota API Gemini esaurita (errore 429).',
      isQuota: true,
    }),
  });

  const resQuota = await orchestrateUserInput('Cerca le ultime notizie sulla Luna', now);
  assert(
    Boolean(resQuota.feedbackText?.includes('429') || resQuota.feedbackText?.includes('quota')),
    'Test 8.1: HTTP 429 reported honestly as quota error (NOT "nessun risultato")'
  );

  // Verify pending action was saved for retry
  const ctxAfterQuota = getContext(now);
  assert(
    ctxAfterQuota.pendingAction !== null && ctxAfterQuota.pendingAction.entity === 'WEB',
    'Test 8.2: Context retains failed action for recovery/retry'
  );

  // Case B: Connection timeout
  currentFetchMock = async () => {
    const err: any = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };

  const resTimeout = await orchestrateUserInput('Cerca online il meteo di Milano', now);
  assert(
    Boolean(resTimeout.feedbackText?.includes('timeout')),
    'Test 8.3: Timeout error clearly communicated'
  );

  // Case C: General Network Error
  currentFetchMock = async () => {
    throw new Error('Failed to fetch (DNS error)');
  };

  const resNet = await orchestrateUserInput('Cerca online prezzi petrolio', now);
  assert(
    Boolean(resNet.feedbackText?.includes('connessione')),
    'Test 8.4: Network failure communicated honestly'
  );

  // =========================================================================
  // SECTION 9: SESSION CONTEXT UPDATE (WORKING MEMORY)
  // =========================================================================
  console.log('\n-- Section 9: SessionContext Updates (Working Memory) --');

  resetContext(now);
  currentFetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'Malta informazioni',
      summary: 'Malta è un arcipelago nel Mediterraneo con clima temperato.',
      sources: [{ title: 'Visit Malta', url: 'https://visitmalta.com' }],
    }),
  });

  const resMalta = await orchestrateUserInput('Cerca informazioni su Malta', now);
  const ctxMalta = getContext(now);

  assert(
    ctxMalta.activeEntity === 'WEB',
    'Test 9.1: SessionContext.activeEntity set to "WEB"'
  );
  assert(
    ctxMalta.lastWebSearch !== null && ctxMalta.lastWebSearch !== undefined,
    'Test 9.2: SessionContext.lastWebSearch recorded in volatile working memory'
  );
  assert(
    Boolean(ctxMalta.lastWebSearch?.searchQuery.includes('Malta')),
    'Test 9.3: lastWebSearch.searchQuery references Malta'
  );
  assert(
    mockStorage['maia_context'] === undefined && mockStorage['last_web_search'] === undefined,
    'Test 9.4: Strict Zero-Persistence rule: web search results NOT saved in localStorage'
  );

  // =========================================================================
  // SECTION 10: FOLLOW-UP AND CONTEXT SWITCH
  // =========================================================================
  console.log('\n-- Section 10: Follow-up & Context Switch --');

  // Case A: Follow-up query "E per Gozo?"
  currentFetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        query: body.query,
        summary: `Risultati per ${body.query}: Gozo è la seconda isola dell'arcipelago maltese.`,
        sources: [{ title: 'Visit Gozo', url: 'https://islandofgozo.org' }],
      }),
    };
  };

  const resFollowUp = await orchestrateUserInput('E per Gozo?', now + 5000);
  assert(
    resFollowUp.type === 'HANDLED_LOCAL',
    'Test 10.1: "E per Gozo?" handled as follow-up web search'
  );
  assert(
    Boolean(resFollowUp.feedbackText?.includes('Gozo')),
    'Test 10.2: Feedback contains Gozo information'
  );

  // Case B: Context Switch to Cognitive inquiry ("Chi era Napoleone?")
  const resSwitch = await orchestrateUserInput('Chi era Napoleone?', now + 10000);
  assert(
    resSwitch.type === 'FALLTHROUGH_GEMINI',
    'Test 10.3: Context switch: "Chi era Napoleone?" routes to Gemini (NOT forced web follow-up)'
  );
  const ctxSwitch = getContext(now + 10000);
  assert(
    ctxSwitch.activeEntity === null,
    'Test 10.4: activeEntity cleared on context switch to cognitive inquiry'
  );

  // Case C: Context Switch to Local action ("Mostra i miei promemoria")
  const resSwitchLocal = await orchestrateUserInput('Mostra i miei promemoria', now + 15000);
  assert(
    resSwitchLocal.type === 'HANDLED_LOCAL' && resSwitchLocal.affectedEntity === 'REMINDER',
    'Test 10.5: Context switch: "Mostra i miei promemoria" executes local reminder action'
  );

  // Case D: Pronoun Follow-up ("Quanto costa quello da 256 GB?")
  resetContext(now);
  currentFetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        query: body.query,
        summary: 'Lo Xiaomi 14 costa 899€.',
        sources: [],
      }),
    };
  };

  await orchestrateUserInput('Cerca il prezzo dello Xiaomi 14', now);

  currentFetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        query: body.query,
        summary: `Prezzo per ${body.query}: 999 euro.`,
        sources: [],
      }),
    };
  };

  const resPronoun = await orchestrateUserInput('Quanto costa quello da 256 GB?', now + 2000);
  assert(
    resPronoun.type === 'HANDLED_LOCAL' && resPronoun.affectedEntity === 'WEB',
    'Test 10.6: Pronoun follow-up "Quanto costa quello da 256 GB?" handled as WEB'
  );
  assert(
    Boolean(resPronoun.searchQuery?.includes('Xiaomi 14')),
    `Test 10.7: "quello" resolved to previous entity "Xiaomi 14" -> "${resPronoun.searchQuery}"`
  );

  // =========================================================================
  // SECTION 11: NATURAL LANGUAGE & CONVERSATIONAL WRAPPERS
  // =========================================================================
  console.log('\n-- Section 11: Conversational Variants & Polite Wrappers --');

  currentFetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      query: 'test',
      summary: 'Dati web trovati.',
      sources: [],
    }),
  });

  const var1 = await orchestrateUserInput('Senti, controlla online le ultime notizie su Marte', now);
  assert(
    var1.type === 'HANDLED_LOCAL' && var1.affectedEntity === 'WEB',
    'Test 11.1: "Senti, controlla online..." handled as WEB'
  );

  const var2 = await orchestrateUserInput('Mi puoi cercare sul web la ricetta della carbonara?', now);
  assert(
    var2.type === 'HANDLED_LOCAL' && var2.affectedEntity === 'WEB',
    'Test 11.2: "Mi puoi cercare sul web..." handled as WEB'
  );

  const var3 = await orchestrateUserInput('Guarda un po\' sul web quanto costa la benzina oggi', now);
  assert(
    var3.type === 'HANDLED_LOCAL' && var3.affectedEntity === 'WEB',
    'Test 11.3: "Guarda un po\' sul web..." handled as WEB'
  );

  const var4 = await orchestrateUserInput('Vorrei sapere cosa si trova online su Pompei', now);
  assert(
    var4.type === 'HANDLED_LOCAL' && var4.affectedEntity === 'WEB',
    'Test 11.4: "Vorrei sapere cosa si trova online su..." handled as WEB'
  );

  const var5 = await orchestrateUserInput('Puoi verificare se oggi c\'è sciopero?', now);
  assert(
    var5.type === 'HANDLED_LOCAL' && var5.affectedEntity === 'WEB',
    'Test 11.5: "Puoi verificare se oggi..." handled as WEB'
  );

  console.log(`\n=== RESULTS: ${passCount}/${passCount + failCount} TESTS PASSED ===`);
  if (failCount === 0) {
    console.log('ALL PHASE 6G WEB SEARCH HARDENING TESTS PASSED WITH 100% SUCCESS!\n');
  } else {
    console.error(`SOME TESTS FAILED: ${failCount} failures.\n`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
