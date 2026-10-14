import { MaiaPersonalFact, MaiaPreference, PreferenceCategory, PreferenceSource, UserMemory } from '../../types';
import { SessionContext } from '../../types/context';
import { loadUserMemory, saveUserMemory } from '../router/actionExecutor';
import { setLearningEvidence } from '../context/sessionContext';

/**
 * Sensitive data protection guard (Phase 6H Requirement 13).
 * Never automatically learn or store credentials, financial info, or secret keys.
 */
export function isSensitiveInformation(text: string): boolean {
  return /\b(?:password|(?:codice\s+)?pin|pin\s+della|carta\s+di\s+credito|cvv|iban|codice\s+fiscale|conto\s+corrente|token\s+segreto|api\s+key|chiave\s+privata|diagnosi\s+medica|malattia\s+intima)\b/i.test(
    text
  );
}

/**
 * Classifies a preference key or expression into one of the extensible categories.
 */
export function classifyPreferenceCategory(key: string, rawText: string = ''): PreferenceCategory {
  const normKey = key.replace(/[_-]+/g, ' ');
  const combined = `${normKey} ${rawText}`.toLowerCase();

  if (/\b(?:development|sviluppo|maia|sviluppare|codice|programmazione|tecnic[aoei]|architettura)\b/i.test(combined)) {
    return 'development';
  }
  if (/\b(?:formatting|emoji|formattazione|elenchi|punti|grassetto|layout)\b/i.test(combined)) {
    return 'formatting';
  }
  if (/\b(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|dettagliat[aoei]|lunghezza|approfondit[aoei]|articolat[aoei]|lung[aoei]|verbosity)\b/i.test(combined)) {
    return 'verbosity';
  }
  if (/\b(?:dirett[aoei]|ironic[aoei]|formal[ei]|informal[ei]|gentil[ei]|ton[oei]|temperamento)\b/i.test(combined)) {
    return 'tone';
  }
  if (/\b(?:language|linguaggio|lingua|italiano|inglese|dialetto|siciliano|parla\s+in)\b/i.test(combined)) {
    return 'language';
  }
  if (/\b(?:interaction|ripetere|ripeti|interazione|chiedimi|conferma|domande)\b/i.test(combined)) {
    return 'interaction';
  }
  if (/\b(?:workflow|lavoro|processo|metodo|abitudine|orario)\b/i.test(combined)) {
    return 'workflow';
  }
  if (/\b(?:interests|hobby|passione|interessi|musica|fotografia|sport)\b/i.test(combined)) {
    return 'interests';
  }

  return 'response_style';
}

export interface ParsedPersonalFact {
  isPersonalFact: boolean;
  key?: string;
  value?: string;
  rawText?: string;
}

function normalizePersonalFactKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(?:preferito|preferita|preferiti|preferite)\b/g, (match) => match)
    .replace(/[^a-z0-9àèéìòù\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_');
}

function cleanPersonalFactValue(value: string): string {
  return value
    .trim()
    .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|el|los|las|un|una)\s+/i, '')
    .trim();
}

/**
 * Parses explicit first-person personal facts without requiring a fixed vocabulary.
 * The semantic shape is: possessive attribute + copula + value.
 * Examples: "Il mio colore preferito è il verde", "La mia squadra preferita è il Milan".
 */
export function parsePersonalFactStatement(rawInput: string): ParsedPersonalFact {
  const clean = rawInput.trim().replace(/[.?!;:]+$/, '').trim();
  if (isSensitiveInformation(clean)) return { isPersonalFact: false };

  const match = clean.match(
    /^(?:il mio|la mia|i miei|le mie)\s+(.+?)\s+(?:è|e'|sono)\s+(.+)$/i
  );
  if (!match) return { isPersonalFact: false };

  const label = match[1].trim();
  const value = cleanPersonalFactValue(match[2]);
  if (!label || !value) return { isPersonalFact: false };

  return {
    isPersonalFact: true,
    key: normalizePersonalFactKey(label),
    value,
    rawText: clean,
  };
}

/** Persists a deterministic personal fact, updating the same semantic key in place. */
export function saveOrUpdatePersonalFact(
  fact: { key: string; value: unknown; rawText?: string; confidence?: 'LOW' | 'MEDIUM' | 'HIGH' },
  currentMemory: UserMemory,
  now: number = Date.now()
): { updatedMemory: UserMemory; affectedFact: MaiaPersonalFact; wasUpdated: boolean } {
  const list = currentMemory.personalFacts ? [...currentMemory.personalFacts] : [];
  const index = list.findIndex((item) => item.key === fact.key);
  const base = {
    key: fact.key,
    value: fact.value,
    confidence: fact.confidence || 'HIGH' as const,
    source: 'EXPLICIT' as const,
    rawText: fact.rawText,
    updatedAt: now,
  };

  if (index >= 0) {
    const affectedFact = { ...list[index], ...base };
    list[index] = affectedFact;
    return { updatedMemory: { ...currentMemory, personalFacts: list }, affectedFact, wasUpdated: true };
  }

  const affectedFact: MaiaPersonalFact = {
    id: `fact-${now}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    ...base,
  };
  list.push(affectedFact);
  return { updatedMemory: { ...currentMemory, personalFacts: list }, affectedFact, wasUpdated: false };
}

export interface ParsedPreference {
  isPreference: boolean;
  isTemporary?: boolean;
  isBehavioralEvidence?: boolean;
  key?: string;
  value?: unknown;
  category?: PreferenceCategory;
  scope?: string;
  rawText?: string;
  standardizedText?: string;
}

/**
 * Parses user input to detect explicit preferences, temporary overrides, or repeated behavioral cues.
 */
export function parsePreferenceStatement(rawInput: string): ParsedPreference {
  const clean = rawInput.trim().replace(/[.?!;:]+$/, '').trim();
  const lower = clean.toLowerCase();

  // Safety / Privacy Guard
  if (isSensitiveInformation(clean)) {
    return { isPreference: false };
  }

  // 1. Temporary Preference Overrides
  // e.g. "Per questa risposta sii molto dettagliata", "Solo per stavolta spiegamelo in modo semplice"
  const isTemporary =
    /\b(?:solo\s+per\s+(?:questa|stavolta|ora|oggi)|per\s+questa\s+(?:volta|risposta)|adesso\s+fammi|per\s+ora|momentaneamente)\b/i.test(
      lower
    );

  if (isTemporary) {
    if (/\b(?:dettagliat[aoei]|approfondit[aoei]|lung[aoei])\b/i.test(lower)) {
      return {
        isPreference: true,
        isTemporary: true,
        key: 'verbosity',
        value: 'detailed',
        category: 'verbosity',
        rawText: clean,
      };
    }
    if (/\b(?:brev[ei]|sintetic[aoei]|concis[aoei]|corta)\b/i.test(lower)) {
      return {
        isPreference: true,
        isTemporary: true,
        key: 'verbosity',
        value: 'concise',
        category: 'verbosity',
        rawText: clean,
      };
    }
    if (/\b(?:semplice|semplicemente|facile)\b/i.test(lower)) {
      return {
        isPreference: true,
        isTemporary: true,
        key: 'technical_depth',
        value: 'simplified',
        category: 'response_style',
        rawText: clean,
      };
    }
    return {
      isPreference: true,
      isTemporary: true,
      key: 'response_style',
      value: clean,
      category: 'response_style',
      rawText: clean,
    };
  }

  // 2. Scoped Preferences (e.g. "Quando sviluppo MAIA voglio risposte tecniche", "Quando scherziamo puoi usare il dialetto")
  const devMatch = lower.match(
    /\b(?:quando\s+sviluppo|nello\s+sviluppo\s+di|quando\s+lavoro\s+a)\s+maia[,\s]+(?:voglio|preferisco|dammi)\s+(.+)/i
  );
  if (devMatch) {
    const rawVal = devMatch[1].trim();
    const isTech = /\b(?:tecnic[aoei]|approfondit[aoei]|codice)\b/i.test(rawVal);
    return {
      isPreference: true,
      key: 'technical_depth',
      value: isTech ? 'technical' : rawVal,
      category: 'development',
      scope: 'development',
      rawText: clean,
      standardizedText: 'Quando sviluppo MAIA preferisco risposte tecniche',
    };
  }

  const dialectMatch = lower.match(
    /\b(?:quando\s+scherziamo[,\s]+(?:puoi\s+usare|usa)\s+il\s+dialetto|usa\s+il\s+dialetto\s+quando\s+scherziamo)\b/i
  );
  if (dialectMatch) {
    return {
      isPreference: true,
      key: 'dialect_usage',
      value: 'allowed_casual',
      category: 'response_style',
      scope: 'casual',
      rawText: clean,
      standardizedText: 'Quando scherziamo puoi usare il dialetto',
    };
  }

  // Scoped Weather preference (e.g. "Quando chiedo il meteo dimmi anche il vento")
  const weatherMatch = lower.match(
    /\b(?:quando\s+chiedo\s+il\s+meteo|nel\s+meteo|sulle\s+previsioni)[,\s]+(?:dimmi|includi|dammi|metti)\s+(?:anche\s+)?il\s+vento\b/i
  );
  if (weatherMatch) {
    return {
      isPreference: true,
      key: 'weather_wind',
      value: 'include_wind',
      category: 'workflow',
      scope: 'weather',
      rawText: clean,
      standardizedText: 'Quando chiedo il meteo dimmi anche il vento',
    };
  }

  // 3. Explicit General Preferences (Stable)
  // Brevity / Verbosity
  if (
    /(?:da\s+ora(?:\s+in\s+poi)?|d['’]ora\s+in\s+poi|preferisco|preferirei|voglio\s+(?:sempre)?|da\s+adesso)\s+.*?(?:risposte\s+)?(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|corte)/i.test(
      lower
    ) ||
    /^(?:preferisco|preferirei)\s+(?:le\s+)?risposte\s+(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|corte)$/i.test(
      lower
    ) ||
    /^(?:da\s+ora(?:\s+in\s+poi)?|d['’]ora\s+in\s+poi|da\s+adesso)\s+(?:preferisco|preferirei|voglio)\s+(?:risposte\s+)?(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|corte)$/i.test(
      lower
    )
  ) {
    return {
      isPreference: true,
      key: 'verbosity',
      value: 'concise',
      category: 'verbosity',
      rawText: clean,
      standardizedText: 'Preferisco risposte sintetiche',
    };
  }

  // Detail / In-depth. Accept both concise preference statements and natural
  // formulations such as "vorrei che tu fossi più articolata". Keep this
  // deterministic so preference capture does not depend on the language model.
  if (
    /(?:da\s+ora(?:\s+in\s+poi)?|d['’]ora\s+in\s+poi|preferisco|preferirei|voglio\s+(?:sempre)?|da\s+adesso|vorrei|desidero|mi\s+piacerebbe|chiedo)\s+.*?(?:risposte\s+)?(?:più\s+)?(?:dettagliat[aoei]|approfondit[aoei]|lunghe|articolat[aoei])/i.test(
      lower
    ) ||
    /\b(?:che\s+tu\s+sia|che\s+tu\s+fossi|tu\s+risponda|tu\s+rispondessi|mi\s+rispondi)\s+(?:in\s+modo\s+)?(?:più\s+)?(?:dettagliat[aoei]|approfondit[aoei]|articolat[aoei])/i.test(lower) ||
    /^(?:preferisco|preferirei)\s+(?:le\s+)?risposte\s+(?:più\s+)?(?:dettagliat[aoei]|approfondit[aoei]|lunghe)$/i.test(
      lower
    ) ||
    /^(?:da\s+ora(?:\s+in\s+poi)?|d['’]ora\s+in\s+poi|da\s+adesso)\s+(?:preferisco|preferirei|voglio)\s+(?:risposte\s+)?(?:più\s+)?(?:dettagliat[aoei]|approfondit[aoei]|lunghe|articolate)$/i.test(
      lower
    )
  ) {
    return {
      isPreference: true,
      key: 'verbosity',
      value: 'detailed',
      category: 'verbosity',
      rawText: clean,
      standardizedText: 'Preferisco risposte dettagliate',
    };
  }

  // Direct tone, including natural requests addressed to the assistant.
  if (
    /(?:preferisco|preferirei|voglio|sii|vorrei|desidero|mi\s+piacerebbe)\s+(?:che\s+tu\s+(?:sia|fossi)\s+)?(?:più\s+)?dirett[aoei]|(?:che\s+tu\s+(?:sia|fossi)|tu\s+risponda|tu\s+rispondessi)\s+(?:in\s+modo\s+)?(?:più\s+)?dirett[aoei]|preferisco\s+.*\b(?:dirett[aoei]|senza\s+girarci\s+intorno|senza\s+fare\s+giri\s+di\s+parole)\b|(?:non\s+fare\s+troppi\s+giri\s+di\s+parole|vai\s+dritt[ao]\s+al\s+punto)/i.test(
      lower
    )
  ) {
    return {
      isPreference: true,
      key: 'tone',
      value: 'direct',
      category: 'tone',
      rawText: clean,
      standardizedText: 'Preferisco che tu sia diretto',
    };
  }

  // Formatting: Minimal Emoji
  if (
    /(?:non\s+usare|niente|evita|senza)\s+(?:troppi\s+|troppe\s+)?emoji/i.test(lower) ||
    /preferisco\s+(?:senza|meno)\s+emoji/i.test(lower)
  ) {
    return {
      isPreference: true,
      key: 'formatting_emoji',
      value: 'minimal',
      category: 'formatting',
      rawText: clean,
      standardizedText: 'Non usare troppi emoji',
    };
  }

  // Language: Italian
  if (
    /(?:preferisco|parlami\s+in|rispondimi\s+in)\s+(?:la\s+lingua\s+|l['’])?italian[ao]/i.test(lower)
  ) {
    return {
      isPreference: true,
      key: 'language',
      value: 'italian',
      category: 'language',
      rawText: clean,
      standardizedText: 'Preferisco l\'italiano',
    };
  }

  // Interaction: Avoid repetition
  if (
    /(?:non\s+farmi\s+ripetere|evita\s+di\s+ripetere|non\s+ripetere)\s+(?:le\s+cose|quello\s+che|ci[oò]\s+che)/i.test(
      lower
    )
  ) {
    return {
      isPreference: true,
      key: 'repetition',
      value: 'no_repetition',
      category: 'interaction',
      rawText: clean,
      standardizedText: 'Non farmi ripetere le cose che ti ho già detto',
    };
  }

  // 4. Behavioral Evidence Cues (single occurrence requests)
  // e.g. "Fammi una risposta breve", "Sii sintetica", "Rispondi in modo conciso"
  if (
    /^(?:fammi\s+una\s+risposta\s+breve|sii\s+sintetic[ao]|rispondi\s+in\s+modo\s+conciso|anche\s+qui\s+fammi\s+una\s+risposta\s+breve|risposta\s+breve\s+anche\s+qui|risposta\s+breve|fammi\s+risposte\s+brevi|fammi\s+una\s+risposta\s+sintetica)$/i.test(
      lower
    )
  ) {
    return {
      isPreference: false,
      isBehavioralEvidence: true,
      key: 'verbosity',
      value: 'concise',
      category: 'verbosity',
      rawText: clean,
      standardizedText: 'Preferisco risposte brevi',
    };
  }

  return { isPreference: false };
}

/**
 * Checks if input is explicitly asking to read/list user preferences.
 */
export function isPreferenceQuery(input: string): boolean {
  const clean = input.trim().toLowerCase().replace(/[.?!;:]+$/, '').trim();
  return (
    /^(?:mostra(?:mi)?|quali\s+sono|elenca|dimmi|cosa\s+(?:sai|ricordi)\s+delle|visualizza)\s+(?:(?:tutte\s+)?le\s+)?(?:mie\s+)?preferenze\b/i.test(
      clean
    ) ||
    /^(?:mostra(?:mi)?|elenca|visualizza)\s+(?:tutte\s+)?le\s+preferenze\s+(?:che\s+hai\s+)?(?:salvato|memorizzato)\b/i.test(clean) ||
    /^(?:cosa\s+preferisco|le\s+mie\s+preferenze\??)$/i.test(clean) ||
    /^(?:come\s+preferisco\s+che\s+tu\s+(?:mi\s+)?rispond(?:a|i)|come\s+ti\s+ho\s+chiesto\s+di\s+rispondermi)\??$/i.test(clean)
  );
}

/**
 * Checks if input is explicitly asking to reset/clear all user preferences.
 */
export function isPreferenceReset(input: string): boolean {
  const clean = input.trim().toLowerCase().replace(/[.?!;:]+$/, '').trim();
  return (
    /^(?:resetta|cancella|elimina|rimuovi|azzera|svuota)\s+(?:(?:tutte\s+)?le\s+)?(?:mie\s+)?preferenze\b/i.test(
      clean
    ) ||
    /^(?:dimentica|scorda)\s+(?:(?:tutte\s+)?le\s+)?(?:mie\s+)?preferenze$/i.test(clean)
  );
}

/**
 * Formats preferences nicely for user-facing feedback.
 */
export function formatPreferencesForDisplay(
  structured: MaiaPreference[] = [],
  rawList: string[] = []
): string {
  if (structured.length === 0 && rawList.length === 0) {
    return 'Non ho ancora memorizzato preferenze sul tuo modo di interagire.';
  }

  const lines: string[] = ['Ecco le tue preferenze attive:'];
  const seen = new Set<string>();
  const addLine = (text: string, scopeNote = '') => {
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    lines.push(`• ${text}${scopeNote}`);
  };

  for (const p of structured) {
    const scopeNote = p.scope ? ` [ambito: ${p.scope}]` : '';
    addLine(p.rawText || p.key, scopeNote);
  }
  // Legacy/raw preferences may still contain valid entries not migrated to
  // structuredPreferences. Include them without duplicating structured ones.
  for (const raw of rawList) addLine(raw);

  return lines.join('\n');
}

/**
 * Saves or updates a structured preference inside UserMemory, ensuring single active entry per key,
 * timestamp refresh, contradiction resolution, and human-readable string synchronization.
 */
export function saveOrUpdatePreference(
  preference: {
    id?: string;
    key: string;
    value: unknown;
    category?: PreferenceCategory;
    source?: PreferenceSource;
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
    rawText?: string;
    scope?: string;
    standardizedText?: string;
  },
  currentMemory: UserMemory,
  now: number = Date.now()
): {
  updatedMemory: UserMemory;
  affectedPreference: MaiaPreference;
  wasUpdated: boolean;
} {
  const existingList = currentMemory.structuredPreferences ? [...currentMemory.structuredPreferences] : [];
  const existingStringList = currentMemory.preferences ? [...currentMemory.preferences] : [];

  const category = preference.category || classifyPreferenceCategory(preference.key, preference.rawText);
  const source = preference.source || 'EXPLICIT';
  const confidence = preference.confidence || 'HIGH';
  const rawText = preference.rawText || preference.standardizedText || `${preference.key}: ${String(preference.value)}`;
  const standardizedText =
    preference.standardizedText ||
    (typeof preference.value === 'string' && preference.value === 'concise'
      ? 'Preferisco risposte sintetiche'
      : typeof preference.value === 'string' && preference.value === 'detailed'
      ? 'Preferisco risposte dettagliate'
      : rawText);

  // Find existing preference by key and scope
  const existingIdx = existingList.findIndex(
    (p) => p.key === preference.key && (p.scope || '') === (preference.scope || '')
  );

  let affectedPreference: MaiaPreference;
  let wasUpdated = false;

  if (existingIdx !== -1) {
    wasUpdated = true;
    affectedPreference = {
      ...existingList[existingIdx],
      value: preference.value,
      category,
      source,
      confidence,
      updatedAt: now,
      rawText,
      scope: preference.scope,
    };
    existingList[existingIdx] = affectedPreference;
  } else {
    affectedPreference = {
      id: preference.id || `pref-${now}-${Math.random().toString(36).slice(2, 7)}`,
      key: preference.key,
      value: preference.value,
      category,
      confidence,
      source,
      createdAt: now,
      updatedAt: now,
      rawText,
      scope: preference.scope,
    };
    existingList.push(affectedPreference);
  }

  // Sync human-readable string in currentMemory.preferences
  // Remove conflicting or duplicate strings
  let updatedStringList = existingStringList.filter((item) => {
    const lowerItem = item.toLowerCase();
    const parsedExisting = parsePreferenceStatement(item);
    if (
      parsedExisting.isPreference &&
      parsedExisting.key === preference.key &&
      (parsedExisting.scope || '') === (preference.scope || '')
    ) {
      return false;
    }
    // If verbosity, remove both short and detailed existing strings
    if (preference.key === 'verbosity') {
      const isBrevity = /\b(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|corte)\b/i.test(lowerItem);
      const isDetail = /\b(?:dettagliat[aoei]|approfondit[aoei]|lunghe|articolate)\b/i.test(lowerItem);
      return !isBrevity && !isDetail;
    }
    // If tone direct, remove direct tone
    if (preference.key === 'tone' && /\bdirett[ao]\b/i.test(lowerItem)) {
      return false;
    }
    // If exact or fuzzy match with new standardizedText, remove old
    if (lowerItem === standardizedText.toLowerCase()) {
      return false;
    }
    return true;
  });

  updatedStringList.push(standardizedText);

  const updatedMemory: UserMemory = {
    ...currentMemory,
    preferences: updatedStringList,
    structuredPreferences: existingList,
  };

  return {
    updatedMemory,
    affectedPreference,
    wasUpdated,
  };
}

/**
 * Returns stored structured preferences from memory.
 */
export function getStoredPreferences(memory?: UserMemory): MaiaPreference[] {
  const mem = memory || loadUserMemory();
  return mem.structuredPreferences || [];
}

/**
 * Retrieves effective preferences, factoring in optional context scope (e.g. 'development')
 * and volatile SessionContext overrides.
 */
export function getEffectivePreferences(
  context?: { domain?: string; topic?: string },
  memory?: UserMemory,
  sessionCtx?: SessionContext
): Record<string, unknown> {
  const effective: Record<string, unknown> = {};
  const stored = getStoredPreferences(memory);

  const activeDomain = context?.domain?.toLowerCase() || context?.topic?.toLowerCase() || '';

  // 1. Apply persistent preferences that match domain scope or are global
  for (const pref of stored) {
    if (pref.scope) {
      // Scoped preference only applies if domain matches
      if (activeDomain.includes(pref.scope.toLowerCase())) {
        effective[pref.key] = pref.value;
      }
    } else {
      effective[pref.key] = pref.value;
    }
  }

  // 2. Overlay volatile temporary preferences from SessionContext
  if (sessionCtx?.temporaryPreferences) {
    for (const [k, v] of Object.entries(sessionCtx.temporaryPreferences)) {
      effective[k] = v;
    }
  }

  return effective;
}

/**
 * Records learning behavioral evidence in SessionContext and decides whether to propose confirmation.
 */
export function recordLearningEvidence(
  key: string,
  value: unknown,
  sessionCtx: SessionContext,
  now: number = Date.now()
): {
  evidenceCount: number;
  shouldProposeConfirmation: boolean;
  candidatePreference: MaiaPreference;
} {
  const evidenceList = sessionCtx.learningEvidence ? [...sessionCtx.learningEvidence] : [];
  const existingIdx = evidenceList.findIndex((e) => e.key === key && e.value === value);

  let count = 1;
  if (existingIdx !== -1) {
    count = evidenceList[existingIdx].count + 1;
    evidenceList[existingIdx] = {
      ...evidenceList[existingIdx],
      count,
      lastObservedAt: now,
    };
  } else {
    evidenceList.push({
      key,
      value,
      count: 1,
      lastObservedAt: now,
    });
  }

  sessionCtx.learningEvidence = evidenceList;
  setLearningEvidence(evidenceList, now);

  // Threshold: propose confirmation on second occurrence (repeated evidence)
  const shouldProposeConfirmation = count >= 2;

  const candidatePreference: MaiaPreference = {
    id: `cand-${now}`,
    key,
    value,
    category: classifyPreferenceCategory(key),
    confidence: 'MEDIUM',
    source: 'CONFIRMED',
    createdAt: now,
    updatedAt: now,
    rawText: key === 'verbosity' && value === 'concise' ? 'Preferisco risposte brevi' : `${key}: ${String(value)}`,
  };

  return {
    evidenceCount: count,
    shouldProposeConfirmation,
    candidatePreference,
  };
}

/**
 * Removes a preference by key or matching description from both structured and string lists.
 */
export function removePreferenceByKeyOrText(
  targetTextOrKey: string,
  currentMemory: UserMemory
): {
  updatedMemory: UserMemory;
  wasRemoved: boolean;
  removedItem?: string;
} {
  const normTarget = targetTextOrKey.toLowerCase().trim();
  const existingList = currentMemory.structuredPreferences ? [...currentMemory.structuredPreferences] : [];
  const existingStrings = currentMemory.preferences ? [...currentMemory.preferences] : [];

  let removedItem: string | undefined;
  let wasRemoved = false;

  const isBrevityTarget = /\b(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|corte)\b/i.test(normTarget);
  const isDetailTarget = /\b(?:dettagliat[aoei]|approfondit[aoei]|lunghe|articolate)\b/i.test(normTarget);
  const isDirectTarget = /\b(?:dirett[aoei]|giri\s+di\s+parole|punto)\b/i.test(normTarget);
  const isEmojiTarget = /\b(?:emoji|faccine)\b/i.test(normTarget);

  // 1. Try matching in structured preferences
  const structIdx = existingList.findIndex((p) => {
    const pKey = p.key.toLowerCase();
    const pRaw = (p.rawText || '').toLowerCase();
    const pVal = String(p.value).toLowerCase();

    if (isBrevityTarget && p.key === 'verbosity' && p.value === 'concise') return true;
    if (isDetailTarget && p.key === 'verbosity' && p.value === 'detailed') return true;
    if (isDirectTarget && p.key === 'tone' && p.value === 'direct') return true;
    if (isEmojiTarget && p.key === 'formatting_emoji') return true;

    return (
      pKey.includes(normTarget) ||
      normTarget.includes(pKey) ||
      pRaw.includes(normTarget) ||
      normTarget.includes(pRaw) ||
      pVal.includes(normTarget)
    );
  });

  if (structIdx !== -1) {
    removedItem = existingList[structIdx].rawText || existingList[structIdx].key;
    existingList.splice(structIdx, 1);
    wasRemoved = true;
  }

  // 2. Remove matching strings from string array
  const updatedStrings = existingStrings.filter((s) => {
    const sLower = s.toLowerCase();

    if (isBrevityTarget && /\b(?:brev[ei]|sintetic(?:[aoei]|he)|concis[aoei]|corte)\b/i.test(sLower)) {
      if (!removedItem) removedItem = s;
      wasRemoved = true;
      return false;
    }
    if (isDetailTarget && /\b(?:dettagliat[aoei]|approfondit[aoei]|lunghe|articolate)\b/i.test(sLower)) {
      if (!removedItem) removedItem = s;
      wasRemoved = true;
      return false;
    }
    if (isDirectTarget && /\bdirett[aoei]\b/i.test(sLower)) {
      if (!removedItem) removedItem = s;
      wasRemoved = true;
      return false;
    }
    if (isEmojiTarget && /\bemoji\b/i.test(sLower)) {
      if (!removedItem) removedItem = s;
      wasRemoved = true;
      return false;
    }

    if (
      sLower.includes(normTarget) ||
      normTarget.includes(sLower) ||
      (removedItem && sLower.includes(removedItem.toLowerCase()))
    ) {
      if (!removedItem) removedItem = s;
      wasRemoved = true;
      return false;
    }
    return true;
  });

  const updatedMemory: UserMemory = {
    ...currentMemory,
    preferences: updatedStrings,
    structuredPreferences: existingList,
  };

  return { updatedMemory, wasRemoved, removedItem };
}

