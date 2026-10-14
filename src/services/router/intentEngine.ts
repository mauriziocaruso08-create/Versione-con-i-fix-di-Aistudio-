import { SessionContext, SemanticEntity, SemanticIntent, SemanticVerb } from '../../types/context';
import { classifyIntent, resolveSelfCorrection } from './semanticClassifier';

/**
 * MAIA Intent Engine (semantic layer).
 *
 * The classifier remains the deterministic parser/extractor. This layer is the
 * semantic front door: it recognizes intent from verb/entity meaning rather
 * than requiring one exact command phrase, then delegates detailed extraction
 * to the classifier when needed.
 *
 * No LLM calls, storage writes or side effects are allowed here.
 */

interface LexiconEntry {
  pattern: RegExp;
  weight: number;
}

const VERB_LEXICON: Record<SemanticVerb, LexiconEntry[]> = {
  CREATE: [
    { pattern: /\b(crea|creare|creami|creiamo|aggiungi|aggiungere|salva|salvare|memorizza|memorizzare|appunta|annota|segna|segnati|scrivi|prendi\s+nota)\b/i, weight: 2 },
    { pattern: /\b(prendi\s+nota|metti|mettere|inserisci|inserire)\b/i, weight: 2 },
  ],
  READ: [
    { pattern: /\b(mostra|mostrami|vedi|vedere|leggi|leggimi|apri|elenca|elencami|cerca|trova|qual(?:e| è)|come\s+mi\s+chiamo|dove\s+vivo)\b/i, weight: 2 },
    { pattern: /\b(quali|qual[ èe]|cosa\s+c['’]?[eè]|che\s+note|che\s+promemoria)\b/i, weight: 1 },
  ],
  UPDATE: [
    { pattern: /\b(modifica|modificare|aggiorna|aggiornare|cambia|cambiare|correggi|correggere|sposta|spostare|rimanda|rimandare|posticipa|posticipare|move|update|change)\b/i, weight: 2 },
  ],
  DELETE: [
    { pattern: /\b(cancella|cancellare|elimina|eliminare|rimuovi|rimuovere|scarta|scartare|butta|buttare|delete|remove|cancel)\b/i, weight: 2 },
  ],
  COMPLETE: [
    { pattern: /\b(completa|completare|fatto|falla\s+finita|segna\s+come\s+fatto|spunta)\b/i, weight: 2 },
  ],
  SEARCH: [
    { pattern: /\b(cerca|cercare|ricerca|ricercare|trova|trovare|cerca\s+online|sul\s+web|su\s+internet)\b/i, weight: 2 },
  ],
  EXPLAIN: [
    { pattern: /\b(spiega|spiegami|spiegare|perch[eé]|come\s+funziona|cosa\s+significa|raccontami|parlami)\b/i, weight: 2 },
  ],
};

const ENTITY_LEXICON: Record<SemanticEntity, LexiconEntry[]> = {
  NOTE: [
    { pattern: /\b(nota|note|annotazione|annotazioni|appunto|appunti)\b/i, weight: 2 },
  ],
  REMINDER: [
    { pattern: /\b(promemoria|promemorie|ricordami|ricordare|ricordo|reminder|avviso|avvisami|remember|remind)\b/i, weight: 2 },
  ],
  MEMORY: [
    { pattern: /\b(memoria|ricorda\s+che|dimentica|scorda|preferenza|preferenze|ricordi\s+(?:di|su)\s+me|sai\s+(?:di|su)\s+me|remember\s+that|forget)\b/i, weight: 2 },
  ],
  WEB: [
    { pattern: /\b(web|internet|online|google|notizie|news|meteo|tempo\s+atmosferico)\b/i, weight: 2 },
  ],
  CALENDAR: [{ pattern: /\b(calendario|appuntamento|appuntamenti|evento|eventi)\b/i, weight: 2 }],
  TASK: [{ pattern: /\b(task|attivit[aà]|compito|compiti|todo|cose\s+da\s+fare)\b/i, weight: 2 }],
  PROJECT: [{ pattern: /\b(progetto|progetti|project|projects)\b/i, weight: 2 }],
  UNKNOWN: [],
};

function scoreLexicon(query: string, lexicon: Record<string, LexiconEntry[]>): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [key, entries] of Object.entries(lexicon)) {
    let score = 0;
    for (const entry of entries) {
      if (entry.pattern.test(query)) score += entry.weight;
    }
    if (score > 0) scores.set(key, score);
  }
  return scores;
}

function bestScore(scores: Map<string, number>): { key?: string; score: number; tied: boolean } {
  let key: string | undefined;
  let score = 0;
  let tied = false;
  for (const [candidate, value] of scores) {
    if (value > score) {
      key = candidate;
      score = value;
      tied = false;
    } else if (value > 0 && value === score) {
      tied = true;
    }
  }
  return { key, score, tied };
}

function normalizeSemanticAliases(query: string): string {
  let q = query
    .trim()
    .replace(/\bmemorizza(?:re)?\b/gi, 'crea')
    .replace(/\bsalva(?:re)?\b/gi, 'crea')
    .replace(/\bappunta(?:re)?\b/gi, 'crea')
    .replace(/\bannota(?:re)?\b/gi, 'crea')
    .replace(/\bmetti\s+(?:un\s+)?promemoria\b/gi, 'crea promemoria')
    .replace(/\bricordami\b/gi, 'crea promemoria')
    .replace(/\bavvisami\b/gi, 'crea promemoria');
  q = q.replace(/^segnati\s+una\s+cosa\s*:\s*(.+)$/i, 'prendi nota che $1');
  q = q.replace(/^mi\s+devo\s+ricordare\s+di\s+(.+?)(?:,\s*(?:segnalo|annotalo|appuntalo))?$/i, 'crea promemoria $1');
  q = q.replace(/^non\s+voglio\s+dimenticarmi\s+di\s+(.+)$/i, 'crea promemoria $1');
  q = q.replace(/^remember\s+that\s+(.+)$/i, 'ricordati che $1');
  q = q.replace(/^remember\s+(.+)$/i, 'ricordati che $1');
  q = q.replace(/^remind\s+me\s+(?:to\s+)?(.+)$/i, 'ricordami di $1');
  q = q.replace(/\btomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\b/gi, (_match, hour: string, minute?: string) =>
    minute ? `domani alle ${hour}:${minute}` : `domani alle ${hour}`,
  );
  q = q.replace(/\bday\s+after\s+tomorrow\b/gi, 'dopodomani');
  q = q.replace(/\btomorrow\b/gi, 'domani');
  q = q.replace(/\btoday\b/gi, 'oggi');
  q = q.replace(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/gi, (_match, hour: string, minute?: string) =>
    minute ? `alle ${hour}:${minute}` : `alle ${hour}`,
  );
  q = q.replace(/^please\s+remind\s+me\s+(?:to\s+)?(.+)$/i, 'ricordami di $1');
  q = q.replace(/^create\s+(?:a|an)\s+note\s*(?::|\s+)?(.+)$/i, 'crea una nota: $1');
  q = q.replace(/^make\s+(?:a|an)\s+note\s*(?::|\s+)?(.+)$/i, 'crea una nota: $1');
  q = q.replace(/^what(?:'s| is)\s+my\s+name\??$/i, 'qual è il mio nome');
  q = q.replace(/^where\s+do\s+i\s+live\??$/i, 'dove vivo');
  q = q.replace(/^what(?:'s| is)\s+my\s+(.+?)\??$/i, 'qual è il mio $1');
  q = q.replace(/^what\s+do\s+i\s+prefer(?:\s+to\s+eat)?\??$/i, 'cosa preferisco mangiare');
  q = q.replace(/^recuerda\s+que\s+(.+)$/i, 'ricordati che $1');
  q = q.replace(/^recuerda\s+(.+)$/i, 'ricordati che $1');
  q = q.replace(/^create\s+a\s+note\s+called\s+(.+?)\s+with\s+[\"“”]?(.+?)[\"“”]?$/i, 'crea una nota chiamata $1 con scritto $2');
  q = q.replace(/^make\s+a\s+note\s+called\s+(.+?)\s+with\s+[\"“”]?(.+?)[\"“”]?$/i, 'crea una nota chiamata $1 con scritto $2');
  q = q.replace(/^which\s+reminders\s+do\s+i\s+have\??$/i, 'quali promemoria ho');
  q = q.replace(/^what\s+reminders\s+do\s+i\s+have\??$/i, 'quali promemoria ho');
  q = q.replace(/^show\s+me\s+my\s+reminders\s*$/i, 'mostrami i promemoria');
  q = q.replace(/^what\s+notes\s+do\s+i\s+have\??$/i, 'quali note ho');
  q = q.replace(/^show\s+me\s+my\s+notes\s*$/i, 'mostrami le note');
  q = q.replace(/^what\s+do\s+i\s+prefer\??$/i, 'quali sono le mie preferenze');
  q = q.replace(/^move\s+it\s+to\s+(.+)$/i, 'spostalo a $1');
  q = q.replace(/^move\s+that\s+to\s+(.+)$/i, 'spostalo a $1');
  q = q.replace(/^move\s+(?:the\s+)?reminder\s+to\s+(.+)$/i, 'sposta il promemoria a $1');
  q = q.replace(/^delete\s+the\s+reminder\s*(.*)$/i, 'cancella il promemoria $1');
  q = q.replace(/^delete\s+the\s+note\s*(.*)$/i, 'cancella la nota $1');
  return q;
}

function extractGenericPayload(query: string, verb: SemanticVerb, entity: SemanticEntity): string | undefined {
  if (verb !== 'CREATE') return undefined;
  const normalized = normalizeSemanticAliases(query);
  const patterns: RegExp[] = entity === 'NOTE'
    ? [
        /\b(?:crea|aggiungi|salva|memorizza|appunta|annota|segna)\b(?:\s+una?\s+nota)?\s*(?::|,)?\s*(?:che|di|come)?\s+(.+)$/i,
        /\b(?:crea|aggiungi|salva|memorizza|appunta|annota|segna)\b\s+(.+)$/i,
      ]
    : entity === 'REMINDER'
      ? [
          /\b(?:crea|metti|aggiungi)\b\s+(?:un\s+)?promemoria\s*(?::|,|per)?\s*(.*)$/i,
          /\b(?:ricordami|avvisami)\b\s*(.*)$/i,
        ]
      : [];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const payload = match?.[1]?.trim();
    if (payload) return payload.replace(/^[:\s,\-–—]+/, '').trim();
  }
  return undefined;
}

function buildGenericIntent(
  query: string,
  verb: SemanticVerb,
  entity: SemanticEntity,
  confidence: SemanticIntent['confidence']
): SemanticIntent {
  const text = extractGenericPayload(query, verb, entity);
  return {
    verb,
    entity,
    target: { type: 'UNRESOLVED' },
    parameters: text ? { text } : {},
    confidence,
    rawQuery: query.trim(),
    isLocalActionCandidate: entity === 'NOTE' || entity === 'REMINDER' || entity === 'MEMORY',
  };
}

/** Analyze semantic intent before detailed command parsing. */
export function analyzeIntent(
  query: string,
  context?: SessionContext,
  isSubQuery = false,
): SemanticIntent {
  const clean = query.trim();
  if (!clean) {
    return buildGenericIntent(clean, 'EXPLAIN', 'UNKNOWN', 'LOW');
  }

  // Resolve the final corrected clause before the lexical front door scores
  // abandoned words such as "crea una nota" in the original utterance.
  if (!isSubQuery) {
    const correction = resolveSelfCorrection(clean);
    if (correction) {
      const correctedIntent = analyzeIntent(correction.suffix, context, true);
      return { ...correctedIntent, rawQuery: clean };
    }
  }
  const operationalNote = clean.match(/^memorizza\s+che\s+(.+)$/i);
  if (
    operationalNote &&
    /^(?:devo|dovrei|bisogna|comprare|compra|fare|da fare|non dimenticare di|ricordarmi di)\b/i.test(operationalNote[1].trim())
  ) {
    const noteIntent = analyzeIntent(
      `crea una nota: ${operationalNote[1].trim()}`,
      context,
      true
    );
    return { ...noteIntent, rawQuery: clean };
  }

  const normalized = normalizeSemanticAliases(clean);
  if ((context?.activeEntity === 'REMINDER' || context?.activeCollectionType === 'REMINDER') && /^move\s+(?:it|that)\s+to\b/i.test(clean)) {
    return classifyIntent('spostalo a ' + clean.replace(/^move\s+(?:it|that)\s+to\s+/i, ''), context, isSubQuery);
  }
  if ((context?.activeEntity === 'NOTE' || context?.activeCollectionType === 'NOTE') && /^add\s+/i.test(clean)) {
    return classifyIntent('aggiungi anche ' + clean.replace(/^add\s+/i, ''), context, isSubQuery);
  }
  const verbScores = scoreLexicon(normalized, VERB_LEXICON);
  const entityScores = scoreLexicon(normalized, ENTITY_LEXICON);
  const verb = bestScore(verbScores);
  const entity = bestScore(entityScores);

  // Strong semantic pairs are allowed to bypass exact command templates.
  if (verb.key && entity.key && !verb.tied && !entity.tied && verb.score >= 2 && entity.score >= 2) {
    const semanticVerb = verb.key as SemanticVerb;
    const semanticEntity = entity.key as SemanticEntity;

    // Search/explain requests should not be forced into local actions.
    if (semanticVerb === 'EXPLAIN') {
      return buildGenericIntent(clean, 'EXPLAIN', 'UNKNOWN', 'HIGH');
    }

    // Calendar/task are reserved capabilities: keep them non-local for now.
    if (semanticEntity === 'CALENDAR' || semanticEntity === 'TASK') {
      return buildGenericIntent(clean, semanticVerb, semanticEntity, 'MEDIUM');
    }

    const parsed = classifyIntent(normalized, context, isSubQuery);
    // Prefer the detailed parser whenever it recognized the same semantic area;
    // this preserves payload/date/target extraction already covered by tests.
    if (
      parsed.isLocalActionCandidate ||
      parsed.verb === semanticVerb ||
      parsed.entity === semanticEntity
    ) {
      return parsed;
    }

    return buildGenericIntent(clean, semanticVerb, semanticEntity, 'MEDIUM');
  }

  // Ambiguous lexical evidence: let the deterministic parser resolve context.
  return classifyIntent(clean, context, isSubQuery);
}

export function getIntentDiagnostics(query: string): {
  normalizedQuery: string;
  verbCandidates: Array<{ verb: SemanticVerb; score: number }>;
  entityCandidates: Array<{ entity: SemanticEntity; score: number }>;
} {
  const normalizedQuery = normalizeSemanticAliases(query);
  const verbScores = scoreLexicon(normalizedQuery, VERB_LEXICON);
  const entityScores = scoreLexicon(normalizedQuery, ENTITY_LEXICON);
  const operationalNote = query.match(/^memorizza\s+che\s+(.+)$/i);
  if (
    operationalNote &&
    /^(?:devo|dovrei|bisogna|comprare|compra|fare|da fare|non dimenticare di|ricordarmi di)\b/i.test(operationalNote[1].trim()) &&
    !entityScores.has('NOTE')
  ) {
    entityScores.set('NOTE', 2);
  }
  return {
    normalizedQuery,
    verbCandidates: [...verbScores.entries()]
      .map(([verb, score]) => ({ verb: verb as SemanticVerb, score }))
      .sort((a, b) => b.score - a.score),
    entityCandidates: [...entityScores.entries()]
      .map(([entity, score]) => ({ entity: entity as SemanticEntity, score }))
      .sort((a, b) => b.score - a.score),
  };
}
