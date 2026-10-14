import { FreshnessType, SessionContext } from '../../types/context';

/**
 * Information Freshness Classifier (Phase 6G Web Search Hardening)
 *
 * Distinguishes:
 * - EXPLICIT_WEB: User explicitly requests an online/web search.
 * - CURRENT: Requires today's/recent/real-time external information.
 * - HISTORICAL: Historical dates, past figures, encyclopedic past events.
 * - GENERAL: Universal knowledge, mathematics, definitions, logic.
 */
export function classifyFreshness(raw: string): FreshnessType {
  const lower = raw.toLowerCase().trim();

  // 1. Explicit Web Search request
  if (
    /\b(?:online|sul\s+web|su\s+internet|su\s+google|motore\s+di\s+ricerca)\b/i.test(lower) ||
    /^(?:cerca(?:re)?\s+(?:online|sul\s+web|su\s+internet|su\s+google)|guarda(?:re)?\s+(?:un\s+po['’]\s+)?sul\s+web|controlla(?:re)?\s+online|trova(?:re)?\s+(?:informazioni\s+)?online|cosa\s+dice\s+internet|cosa\s+si\s+trova\s+online|vorrei\s+sapere\s+cosa\s+si\s+trova\s+online|verific(?:a|are)\s+(?:online|sul\s+web))\b/i.test(lower)
  ) {
    return 'EXPLICIT_WEB';
  }

  // 2. Real-time / Current indicators
  if (
    /\b(?:oggi|adesso|ora|attuale|attualmente|ultim[ei]|recent[ei]|ultimamente|in\s+questo\s+momento|stasera|questa\s+settimana|questo\s+mese|quest['’]anno|di\s+oggi|novit[àa]|breaking\s+news|meteo|previsioni\s+meteo|prezzo\s+attuale|quanto\s+costa\s+(?:oggi|ora|attualmente)|quando\s+esce\s+(?:il|la|il\s+nuovo|la\s+nuova))\b/i.test(lower) ||
    /^(?:che\s+tempo\s+fa|com['’]è\s+il\s+tempo|cosa\s+[eè]\s+successo\s+oggi|qual\s+[eè]\s+l['’]ultimo\s+modello)\b/i.test(lower)
  ) {
    return 'CURRENT';
  }

  // 3. Historical figures / past events
  if (
    /\b(?:chi\s+era|storia\s+di|nel\s+(?:1\d{3}|20[01]\d)|secolo\s+scorso|antica\s+roma|medioevo|rinascimento|prima\s+guerra|seconda\s+guerra|battaglia\s+di|impero\s+romano|quando\s+[eè]\s+(?:nato|morto)|invenzione\s+della|chi\s+ha\s+inventato)\b/i.test(lower)
  ) {
    return 'HISTORICAL';
  }

  // 4. Default: General knowledge / reasoning
  return 'GENERAL';
}

/**
 * Strips common polite wrappers from an utterance for clean classification.
 */
function stripPrefixForWeb(text: string): string {
  let cur = text.trim();
  const pattern = /^(?:(?:ehi\s+|ciao\s+|buongiorno\s+|buonasera\s+|oh\s+)?maia|(?:no[,\s]+)?aspetta(?:\s+un\s+(?:attimo|momento))?|senti(?:\s+un\s+po['’])?|ascolta(?:mi)?|guarda(?:\s+un\s+po['’])?|ok(?:ay)?|va\s+bene|d['’]accordo|allora|quindi|dunque|ora|adesso|per\s+favore|per\s+cortesia|per\s+piacere|oh|(?:mi\s+)?puoi(?:\s+per\s+favore)?|(?:mi\s+)?potresti(?:\s+per\s+favore)?)[,\s:]+/i;
  let prev = '';
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(pattern, '').replace(/^[:\s\-–—,]+/, '').trim();
  }
  return cur;
}

/**
 * Checks whether an utterance should be routed to MAIA's Web Search capability.
 */
export function isWebSearchCandidate(query: string, context?: SessionContext): boolean {
  const clean = query.trim();
  const stripped = stripPrefixForWeb(clean);
  const lower = clean.toLowerCase();
  const strippedLower = stripped.toLowerCase();

  // Guard 0: Local storage actions MUST NEVER be routed to Web Search!
  // e.g. "Cerca tra le mie note", "Mostra i miei promemoria", "Cancella quella nota", "Cosa ricordi di me?"
  if (
    /\b(?:tra\s+le\s+(?:mie\s+)?note|nelle\s+(?:mie\s+)?note|nei\s+(?:miei\s+)?promemoria|tra\s+i\s+(?:miei\s+)?promemoria|nella\s+(?:mia\s+)?memoria)\b/i.test(lower) ||
    (/^(?:crea|prendi|segna|aggiungi|cancella|elimina|rimuovi|mostra|elenca|visualizza|leggi|modifica|sposta|posticipa|completa|spunta|ricordami|ricordati|memorizza|dimentica)\b/i.test(strippedLower) &&
      /\b(?:nota|note|promemoria|memo|reminder|memoria|ricordo)\b/i.test(strippedLower))
  ) {
    return false;
  }

  // Guard 1: Pure cognitive inquiries without explicit search verbs are NOT web search
  // e.g. "Chi era Napoleone?", "Cos'è la fotosintesi?", "Spiegami la relatività", "Quanto fa 25 * 4?"
  const isEpistemicWithoutWeb =
    /^(?:(?:(?:mi\s+)?(?:puoi|potresti)\s+)?spiega(?:mi|re)?|perch[eé]|(?:che|cosa)\s+significa|cos['’][eè]|chi\s+[eè]|chi\s+era|raccontami|parlami\s+di|come\s+(?:funziona|si)|definizione\s+di)\b/i.test(strippedLower) &&
    !/\b(?:online|sul\s+web|su\s+internet|su\s+google|ultime\s+notizie|oggi|attuale)\b/i.test(lower);

  if (isEpistemicWithoutWeb) {
    return false;
  }

  // Guard 2: Pure math calculations
  if (
    /^(?:quanto\s+fa|calcola|somma|moltiplica|dividi|sottrai|\d+\s*[\+\-\*\/x×÷]\s*\d+)/i.test(strippedLower) ||
    /\bnumero\s+primo\b/i.test(strippedLower)
  ) {
    return false;
  }

  // 1. Follow-up query in active WEB context
  if (context?.activeEntity === 'WEB' && context?.lastWebSearch) {
    // e.g. "E per Gozo?", "E a Parigi?", "E invece a Roma?", "Quanto costa quello da 256 GB?", "E la versione Pro?"
    if (
      /^(?:e\s+(?:invece\s+)?(?:per|a|di|su|in|riguardo\s+a|per\s+quanto\s+riguarda)?|e\s+invece)\s+.+$/i.test(lower) ||
      /\b(?:quello|quella|questo|questa|versione|modello)\b/i.test(lower)
    ) {
      return true;
    }
  }

  // 2. Explicit web search triggers (anywhere in stripped utterance)
  if (
    /\b(?:cerca(?:re|mi)?|trova(?:re)?|controlla(?:re)?|guarda(?:re)?)\b/i.test(lower) &&
    /\b(?:online|sul\s+web|su\s+internet|su\s+google|in\s+rete)\b/i.test(lower)
  ) {
    return true;
  }

  if (
    /^(?:cerca(?:re|mi)?\s+(?:online|sul\s+web|su\s+internet|su\s+google|le\s+recensioni|notizie|info|informazioni)?|fai\s+una\s+ricerca|trova(?:re)?\s+(?:informazioni|info|notizie)?\s*(?:online|sul\s+web|su\s+internet)?|controlla(?:re)?\s+(?:online|sul\s+web|su\s+internet)?|guarda(?:re)?\s+(?:un\s+po['’]\s+)?(?:sul\s+web|online)|cosa\s+dice\s+internet|vorrei\s+sapere\s+cosa\s+si\s+trova\s+online|puoi\s+verificare\s+(?:online|sul\s+web)|verific(?:a|are)\s+(?:online|sul\s+web))\b/i.test(strippedLower) ||
    /\b(?:cosa\s+dice\s+internet|cosa\s+si\s+trova\s+online|vorrei\s+sapere\s+cosa\s+si\s+trova\s+online)\b/i.test(lower)
  ) {
    return true;
  }

  // 3. Real-time Weather
  if (
    /^(?:che\s+tempo\s+(?:fa|far[àa]|è\s+previsto)|com['’]è\s+il\s+tempo|previsioni\s+meteo|meteo)\b/i.test(strippedLower) ||
    /\b(?:previsioni\s+meteo|tempo\s+a|piove\s+a|temperatura\s+a)\b/i.test(lower)
  ) {
    return true;
  }

  // 4. Current prices, releases, breaking news
  if (
    /^(?:quanto\s+costa\s+(?:attualmente|oggi|adesso)|qual\s+[eè]\s+il\s+prezzo\s+attuale|cosa\s+[eè]\s+successo\s+oggi|quando\s+esce\s+(?:il|la|il\s+nuovo|la\s+nuova)|qual\s+[eè]\s+l['’]ultimo\s+modello|ultime\s+notizie\s+su|che\s+si\s+dice\s+ultimamente\s+di)\b/i.test(strippedLower) ||
    /\b(?:prezzo\s+attuale|quanto\s+costa\s+attualmente|ultime\s+notizie\s+su|cosa\s+[eè]\s+successo\s+oggi)\b/i.test(lower)
  ) {
    return true;
  }

  // 5. Explicit "verifica se..." / "controlla se..." requesting real-time factual check (e.g. "Verifica se c'è sciopero oggi")
  if (
    /\b(?:verific(?:a|are)|controll(?:a|are))\s+se\b/i.test(lower) &&
    /\b(?:oggi|domani|adesso|in\s+corso|aperto|chiuso|sciopero|meteo|pioggia|neve)\b/i.test(lower)
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts category from query context.
 */
function detectCategory(lower: string): 'weather' | 'news' | 'technology' | 'general' {
  if (/\b(?:meteo|previsioni|tempo\s+fa|piove|pioggia|temperatura|clima|gradi)\b/i.test(lower)) {
    return 'weather';
  }
  if (/\b(?:notizi[ae]|cosa\s+[eè]\s+successo|ultim[eo]\s+ora|novit[àa]|guerra|elezioni|politica|sciopero|governo)\b/i.test(lower)) {
    return 'news';
  }
  if (/\b(?:iphone|xiaomi|samsung|pixel|smartphone|nvidia|apple|google|openai|chatgpt|modello|gb|ram|processore|scheda\s+video)\b/i.test(lower)) {
    return 'technology';
  }
  return 'general';
}

export interface CleanSearchExtraction {
  cleanQuery: string;
  category: 'weather' | 'news' | 'technology' | 'general';
  freshness: FreshnessType;
  isFollowUp: boolean;
}

/**
 * Extracts a clean, high-precision search query from a conversational SemanticIntent.
 *
 * Strips conversational fluff ("Senti, mi puoi controllare online quanto costa oggi lo Xiaomi X?")
 * -> "quanto costa oggi lo Xiaomi X".
 *
 * Resolves follow-ups against active SessionContext.
 */
export function extractCleanSearchQuery(
  rawQuery: string,
  context?: SessionContext
): CleanSearchExtraction {
  const raw = rawQuery.trim();
  const freshness = classifyFreshness(raw);
  const category = detectCategory(raw.toLowerCase());

  // 1. Check for follow-up in active WEB context
  if (context?.activeEntity === 'WEB' && context?.lastWebSearch) {
    const prevSearch = context.lastWebSearch;
    const lower = raw.toLowerCase();

    // Pattern A: "E per Gozo?", "E invece Gozo?", "E a Parigi?"
    const followUpMatch = raw.match(
      /^(?:e\s+(?:invece\s+)?(?:per|a|di|su|in|riguardo\s+a|per\s+quanto\s+riguarda)?|e\s+invece)\s+(.+)$/i
    );
    if (followUpMatch) {
      const topic = followUpMatch[1].replace(/[.?!;:]+$/, '').trim();
      let followUpQuery = topic;

      if (prevSearch.category === 'weather' || category === 'weather') {
        followUpQuery = `${topic} previsioni meteo`;
      } else if (/\binformazioni\b/i.test(prevSearch.searchQuery)) {
        followUpQuery = `${topic} informazioni`;
      } else if (/\bprezzo\b/i.test(prevSearch.searchQuery) || /\bcosta\b/i.test(prevSearch.searchQuery)) {
        followUpQuery = `${topic} prezzo attuale`;
      } else {
        followUpQuery = `${topic} informazioni`;
      }

      return {
        cleanQuery: followUpQuery,
        category: (prevSearch.category as any) || category,
        freshness: 'CURRENT',
        isFollowUp: true,
      };
    }

    // Pattern B: "Quanto costa quello da 256 GB?", "E il modello da 256 GB?", "E quella da 128 GB?"
    if (/\b(?:quello|quella|questo|questa)\b/i.test(lower)) {
      // Extract clean subject from previous search (e.g. "Xiaomi 14")
      let prevSubject = prevSearch.searchQuery
        .replace(/\b(?:cerca|online|sul\s+web|su\s+internet|prezzo|attuale|quanto\s+costa|informazioni|notizie|recensioni)\b/gi, '')
        .trim();

      // Strip articles & prepositions like "il", "lo", "dello", "della"
      prevSubject = prevSubject
        .replace(/^(?:(?:il|lo|la|i|gli|le)\s+)?(?:dello|della|del|dei|degli|delle|di)\s+/i, '')
        .replace(/^(?:il|lo|la|l['’]|i|gli|le)\s+/i, '')
        .trim();

      const details = raw
        .replace(/^(?:quanto\s+costa|qual\s+[eè]\s+il\s+prezzo\s+di|e\s+invece|e)\s+/i, '')
        .replace(/\b(?:quello|quella|questo|questa)\b/i, '')
        .replace(/[.?!;:]+$/, '')
        .trim();

      const combined = `${prevSubject} ${details}`.trim();
      return {
        cleanQuery: `${combined} prezzo attuale`.replace(/\s+/g, ' ').trim(),
        category: 'technology',
        freshness: 'CURRENT',
        isFollowUp: true,
      };
    }
  }

  // 2. Regular non-follow-up query cleaning
  let clean = raw
    .replace(/[.?!;:]+$/, '')
    .trim();

  // Strip conversational wrappers & polite greetings
  clean = clean
    .replace(/^(?:(?:ehi\s+|ciao\s+|buongiorno\s+|buonasera\s+)?maia[,\s:]+)+/i, '')
    .replace(/^(?:senti(?:\s+un\s+po['’])?|ascolta(?:mi)?|guarda(?:\s+un\s+po['’])?|ok(?:ay)?|allora|dunque)[,\s:]+/i, '')
    .replace(/^(?:(?:mi\s+)?(?:puoi|potresti|sapresti|vorresti)\s+(?:per\s+favore\s+)?(?:dirmi|cercare|controllare|verificare|trovare|vedere)[,\s:]+)+/i, '')
    .replace(/^(?:vorrei\s+(?:sapere|vedere|capire)|fammi\s+sapere|dimmi)[,\s:]+/i, '')
    .replace(/[,\s]+(?:per\s+favore|per\s+cortesia|grazie)$/i, '')
    .trim();

  // Strip leading search action boilerplate
  clean = clean
    .replace(
      /^(?:cerca(?:re|mi)?\s+(?:online|sul\s+web|su\s+internet|su\s+google|le\s+ultime\s+notizie\s+su|ultime\s+notizie\s+su|notizie\s+su|informazioni\s+su|info\s+su|il\s+prezzo\s+di|prezzo\s+di|quanto\s+costa)?|fai\s+una\s+ricerca|trova(?:re)?\s+(?:informazioni\s+su|info\s+su|online|sul\s+web|su\s+internet)?|controlla(?:re)?\s+(?:online|sul\s+web|su\s+internet)?|guarda(?:re)?\s+(?:un\s+po['’]\s+)?(?:sul\s+web|online)?|verific(?:a|are)\s+(?:online|sul\s+web|se)?)[,\s:]*/i,
      ''
    )
    .replace(
      /^(?:cosa\s+dice\s+internet\s+(?:su(?:lla|llo|ll['’]|l|i|gli|lle)?|di)?|cosa\s+si\s+dice\s+(?:online|sul\s+web)\s+(?:su|di)?|cosa\s+si\s+trova\s+online\s+(?:su|di)?|che\s+si\s+dice\s+ultimamente\s+di|vorrei\s+sapere\s+cosa\s+si\s+trova\s+online\s+(?:su|di)?)[,\s:]*/i,
      ''
    )
    .replace(/^(?:online|sul\s+web|su\s+internet|su\s+google)\s+/i, '')
    .replace(/^(?:su|sul|sulla|sullo|sui|sugli|sulle|di|del|della|dello|dei|degli|delle|riguardo\s+a)\s+/i, '')
    .trim();

  // If query is empty after stripping (e.g. user just said "Cerca online"), fallback to raw
  if (!clean) {
    clean = raw;
  }

  // Handle weather specific formatting
  if (category === 'weather' && !/meteo|previsioni/i.test(clean)) {
    clean = `${clean} previsioni meteo`;
  }

  return {
    cleanQuery: clean.trim(),
    category,
    freshness,
    isFollowUp: false,
  };
}
