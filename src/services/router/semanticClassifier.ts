import {
  FreshnessType,
  SemanticEntity,
  SemanticIntent,
  SemanticScopeType,
  SemanticVerb,
  SessionContext,
  TargetDescriptor,
} from '../../types/context';
import {
  classifyFreshness,
  extractCleanSearchQuery,
  isWebSearchCandidate,
} from './searchQueryExtractor';
import {
  isPreferenceQuery,
  isPreferenceReset,
  parsePreferenceStatement,
  parsePersonalFactStatement,
} from '../learning/preferenceManager';

export interface ClassificationResult {
  intent: SemanticIntent;
  diagnostic?: {
    matchedRule?: string;
    lexicalEntity?: SemanticEntity;
    contextEntityApplied?: boolean;
  };
}

/**
 * Normalizes input text by removing excessive whitespace and trailing punctuation.
 */
function cleanQuery(str: string): string {
  return str
    .trim()
    .replace(/[.?!;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips polite conversational prefixes, interjections, and introductory wrappers.
 * e.g. "Senti, ", "Ok, allora, ", "No, aspetta, ", "Per favore, ", "Maia, ".
 */
function stripPolitePrefix(query: string): string {
  let prev = '';
  let current = query.trim();

  // Pattern for introductory conversational markers (case-insensitive)
  const wrapperPattern = /^(?:(?:ehi\s+|ciao\s+|buongiorno\s+|buonasera\s+|oh\s+)?maia|(?:no[,\s]+)?aspetta(?:\s+un\s+(?:attimo|momento))?|senti(?:\s+un\s+po['’])?|ascolta(?:mi)?|guarda(?:\s+un\s+po['’])?|ok(?:ay)?|va\s+bene|d['’]accordo|allora|quindi|dunque|ora|adesso|per\s+favore|per\s+cortesia|per\s+piacere|oh|(?:mi\s+)?puoi(?:\s+per\s+favore)?|(?:mi\s+)?potresti(?:\s+per\s+favore)?)[,\s:]+/i;

  // Repeatedly strip leading wrappers while matching
  while (current !== prev) {
    prev = current;
    current = current.replace(wrapperPattern, '').replace(/^[:\s\-–—,]+/, '').trim();
  }

  return current;
}

/**
 * Extracts ordinal index and reference from text (e.g. "il primo" -> index 1).
 */
function extractOrdinal(text: string): { ordinalIndex: number; rawReference: string } | null {
  const ordinalMap: Record<string, number> = {
    'primo': 1, 'prima': 1, '1°': 1, '1a': 1,
    'secondo': 2, 'seconda': 2, '2°': 2, '2a': 2,
    'terzo': 3, 'terza': 3, '3°': 3, '3a': 3,
    'quarto': 4, 'quarta': 4, '4°': 4, '4a': 4,
    'quinto': 5, 'quinta': 5, '5°': 5, '5a': 5,
    'sesto': 6, 'sesta': 6, '6°': 6, '6a': 6,
    'settimo': 7, 'settima': 7, '7°': 7, '7a': 7,
    'ottavo': 8, 'ottava': 8, '8°': 8, '8a': 8,
    'nono': 9, 'nona': 9, '9°': 9, '9a': 9,
    'decimo': 10, 'decima': 10, '10°': 10, '10a': 10,
    'ultimo': -1, 'ultima': -1,
  };

  const regex = /\b(?:(?:il|la|l['’])\s+)?(primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta|sesto|sesta|settimo|settima|ottavo|ottava|nono|nona|decimo|decima|ultimo|ultima|1°|2°|3°|4°|5°)\b/i;
  const match = text.match(regex);
  if (match) {
    const key = match[1].toLowerCase();
    const idx = ordinalMap[key];
    if (idx !== undefined) {
      return { ordinalIndex: idx, rawReference: match[0].trim() };
    }
  }
  return null;
}

/**
 * Extracts relative time shift in minutes (e.g. "di due ore" -> 120).
 */
export function extractRelativeTimeShift(text: string): number | undefined {
  // "di mezz'ora" / "tra mezz'ora" / "tra mezzora"
  if (/\b(?:di|tra)\s+(?:mezz['’]\s*ora|mezzora)\b/i.test(text)) {
    return 30;
  }
  // "di un'ora e mezza" / "tra un'ora e mezza"
  if (/\b(?:di|tra)\s+un['’]\s*ora\s+e\s+(?:mezza|mezz['’]\s*ora|mezzora)\b/i.test(text)) {
    return 90;
  }
  // "di un'ora" / "tra un'ora"
  if (/\b(?:di|tra)\s+un['’]\s*ora\b/i.test(text)) {
    return 60;
  }

  // "di X ore" / "tra X ore"
  const hoursMatch = text.match(/\b(?:di|tra|per)\s+(\d+|due|tre|quattro|cinque|sei)\s+ore\b/i);
  if (hoursMatch) {
    const wordNumbers: Record<string, number> = {
      'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5, 'sei': 6,
    };
    const num = wordNumbers[hoursMatch[1].toLowerCase()] || parseInt(hoursMatch[1], 10);
    if (!isNaN(num)) return num * 60;
  }

  // "di X minuti" / "tra X minuti" / "rimanda di X minuti"
  const minutesMatch = text.match(/\b(?:di|tra|per)\s+(\d+)\s+minut[ie]\b/i);
  if (minutesMatch) {
    const num = parseInt(minutesMatch[1], 10);
    if (!isNaN(num)) return num;
  }

  return undefined;
}

/**
 * Extracts absolute date/time string from natural language.
 */
const CALENDAR_MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

export function parseExplicitCalendarDate(
  text: string,
  baseDate: Date = new Date(),
): { found: boolean; valid: boolean; dueAt?: string; raw?: string } {
  const match = text.match(
    /\b(?:il\s+)?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?(?:\s+(?:alle|per\s+le)\s*(\d{1,2})(?::(\d{2}))?)?\b/i
  );
  if (!match) {
    const numeric = text.match(/\b(?:il\s+)?(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(?:alle|per\s+le)\s*(\d{1,2})(?::(\d{2}))?)?\b/i);
    if (!numeric) return { found: false, valid: true };
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = Number(numeric[3]);
    const hour = numeric[4] ? Number(numeric[4]) : 9;
    const minute = numeric[5] ? Number(numeric[5]) : 0;
    const d = new Date(year, month - 1, day, hour, minute, 0, 0);
    const valid = month >= 1 && month <= 12 && day >= 1 && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    return { found: true, valid, dueAt: valid ? d.toISOString() : undefined, raw: numeric[0] };
  }
  const day = Number(match[1]);
  const month = CALENDAR_MONTHS[match[2].toLowerCase()];
  const year = match[3] ? Number(match[3]) : baseDate.getFullYear();
  const hour = match[4] ? Number(match[4]) : 9;
  const minute = match[5] ? Number(match[5]) : 0;
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  const valid = day >= 1 && month >= 1 && month <= 12 && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  return { found: true, valid, dueAt: valid ? d.toISOString() : undefined, raw: match[0] };
}

export function extractTargetDateTime(text: string, baseDate: Date = new Date()): string | undefined {
  const lower = text.toLowerCase().trim();

  const explicitDate = parseExplicitCalendarDate(lower, baseDate);
  if (explicitDate.found) return explicitDate.dueAt;

  // Pattern: "stasera" / "questa sera". Default evening time is 20:00.
  if (/\b(?:stasera|questa\s+sera)\b/i.test(lower)) {
    const timeMatch = lower.match(/\b(?:stasera|questa\s+sera)(?:\s+(?:alle|per\s+le)\s*(\d{1,2})(?::(\d{2}))?)?/i);
    const hour = timeMatch?.[1] ? parseInt(timeMatch[1], 10) : 20;
    const minute = timeMatch?.[2] ? parseInt(timeMatch[2], 10) : 0;
    const d = new Date(baseDate);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= baseDate.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  // Pattern: "tra X ore/minuti". This is kept here as an absolute timestamp
  // extractor so callers that only inspect dueAt cannot silently lose the time.
  const relativeTimeMatch = lower.match(/\btra\s+(\d+)\s+(ore?|minut[oi])\b/i);
  if (relativeTimeMatch) {
    const amount = parseInt(relativeTimeMatch[1], 10);
    if (!Number.isNaN(amount)) {
      const multiplier = /^ore?/i.test(relativeTimeMatch[2]) ? 60 * 60 * 1000 : 60 * 1000;
      return new Date(baseDate.getTime() + amount * multiplier).toISOString();
    }
  }

  // Pattern: "dopodomani (alle 15(:00)?)?"
  const dopodomaniMatch = lower.match(/\bdopodomani(?:\s+(?:alle|per\s+le)?\s*(\d{1,2})(?::(\d{2}))?)?\b/i);
  if (dopodomaniMatch) {
    const hour = dopodomaniMatch[1] ? parseInt(dopodomaniMatch[1], 10) : 9;
    const minute = dopodomaniMatch[2] ? parseInt(dopodomaniMatch[2], 10) : 0;
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 2);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  }

  // Pattern: "a domani alle 15(:00)?" or "domani alle 15" or "a domani"
  const domaniMatch = lower.match(/\bdomani(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+(?:alle|per\s+le)?\s*(\d{1,2})(?::(\d{2}))?)?\b/i);
  if (domaniMatch) {
    const defaultHour = lower.includes('pomeriggio') ? 15 : lower.includes('sera') ? 20 : 9;
    const hour = domaniMatch[1] ? parseInt(domaniMatch[1], 10) : defaultHour;
    const minute = domaniMatch[2] ? parseInt(domaniMatch[2], 10) : 0;
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  }

  // Pattern: "venerdì alle 18" or "a venerdì"
  const days = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const dayMatch = lower.match(/(?:^|\b)(luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?:\s+(?:alle|per\s+le)?\s*(\d{1,2})(?::(\d{2}))?)?(?:\s|$|[.,;:?!])/i);
  if (dayMatch) {
    const targetDayName = dayMatch[1].toLowerCase().replace(/i$/, 'ì');
    const targetDayIndex = days.indexOf(targetDayName);
    const hour = dayMatch[2] ? parseInt(dayMatch[2], 10) : 9;
    const minute = dayMatch[3] ? parseInt(dayMatch[3], 10) : 0;
    if (targetDayIndex !== -1) {
      const d = new Date(baseDate);
      let diff = targetDayIndex - d.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      d.setHours(hour, minute, 0, 0);
      return d.toISOString();
    }
  }

  // Pattern: "alle 17(:00)?" / "alle ore 17"
  const hourOnlyMatch = lower.match(/\b(?:alle|per\s+le|alle\s+ore)\s*(\d{1,2})(?::(\d{2}))?\b/i);
  if (hourOnlyMatch) {
    const hour = parseInt(hourOnlyMatch[1], 10);
    const minute = hourOnlyMatch[2] ? parseInt(hourOnlyMatch[2], 10) : 0;
    const d = new Date(baseDate);
    d.setHours(hour, minute, 0, 0);
    // If the time today has already passed, move to tomorrow
    if (d.getTime() <= baseDate.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return d.toISOString();
  }

  return undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts new text payload from note or reminder update commands.
 */
function extractUpdateNewText(query: string): string | undefined {
  // Explicit append-to-content phrasing must not be mistaken for a title replacement.
  const appendContentMatch = query.match(/\b(?:aggiungendo|aggiungi|inserendo|inserisci)\s+(?:al|nel)\s+contenuto\s*:\s*(.+)$/i);
  if (appendContentMatch) return appendContentMatch[1].trim().replace(/^['"`«»]|['"`«»]$/g, '').trim();
  // Pattern 0: Explicit colon / "in:" / "con:" / ", scrivi:" / "e scrivi:" after entity / pronoun
  // e.g. "Modifica quella nota: <newText>", "Modifica la nota: <newText>", "Cambia quella nota in: <newText>", "Modifica quella nota, scrivi: <newText>", "Modifica quella nota e scrivi: <newText>"
  const colonMatch = query.match(
    /(?:(?:\b(?:quella|questa|la|il|quello|questo|quel)?\s*(?:nota|promemoria)\s*:\s*)|(?:\b(?:in|con)\s*:\s*)|(?:,\s*scrivi:?\s*)|\b(?:e\s+scrivi:?\s*))([\"\'\`«»]?)(.+?)\1$/i
  );
  if (colonMatch) {
    return colonMatch[2].trim();
  }

  // Pattern 1: "... e scrivi <newText>"
  const scriviMatch = query.match(/\b(?:e\s+scrivi|scrivi)\s+([\"\'\`«»]?)(.+?)\1$/i);
  if (scriviMatch) {
    return scriviMatch[2].trim();
  }

  // Pattern 1b: "... e aggiungi <newText>" / "... aggiungi <newText>".
  const aggiungiMatch = query.match(/\b(?:e\s+)?aggiungi\s+(?:anche\s+)?(["'`«»]?)(.+?)\1$/i);
  if (aggiungiMatch) {
    return aggiungiMatch[2].trim();
  }

  // Pattern 2: "... cambia il testo (della nota / del promemoria)? in/con <newText>"
  const testoInMatch = query.match(
    /\bcambia(?:\s+il)?\s+testo(?:\s+(?:della\s+|del\s+)?(?:prima\s+|seconda\s+|terza\s+|quarta\s+|quinta\s+|ultima\s+)?(?:nota|promemoria))?\s+(?:in|con)\s+([\"\'\`«»]?)(.+?)\1$/i
  );
  if (testoInMatch) {
    return testoInMatch[2].trim();
  }

  // Pattern 3: "... in/con <newText>" (where <newText> is not purely a temporal indicator)
  const inMatch = query.match(/\s+(?:in|con)\s+([\"\'\`«»]?)(.+?)\1$/i);
  if (inMatch) {
    const candidate = inMatch[2].trim();
    // Guard against temporal expressions: "in 2 ore", "in venerdì", "in anticipo"
    if (
      !/^(?:\d+\s+(?:ore|minuti|giorni)|venerd[ìi]|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|sabato|domenica|domani|dopodomani|oggi|anticipo|ritardo)\b/i.test(
        candidate
      )
    ) {
      return candidate;
    }
  }

  // Pattern 4: General trailing colon after command/target (e.g. "Modifica quella nota: testo", "Cambiala in: testo")
  const generalColonMatch = query.match(/:\s*([\"\'\`«»]?)(.+?)\1$/);
  if (generalColonMatch) {
    return generalColonMatch[2].trim();
  }

  return undefined;
}

/**
 * Extracts destination date/time when specified with preposition "a", "per", or "alle" at the end of a command.
 */
function extractDestinationDateTime(
  query: string,
  baseDate: Date = new Date()
): {
  dueAt?: string;
  cleanedQuery: string;
} {
  // Pattern 1: "... a/per venerdì alle 10", "... a/per domani alle 15", "... a/per dopodomani", "... a/per venerdì"
  const prepDateMatch = query.match(
    /\s+(?:a|per)\s+(domani|dopodomani|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+(?:alle|per\s+le)?\s*(\d{1,2})(?::(\d{2}))?)?$/i
  );
  if (prepDateMatch) {
    const fullDatePart = prepDateMatch[0].trim().replace(/^(?:a|per)\s+/i, '');
    const dueAt = extractTargetDateTime(fullDatePart, baseDate);
    if (dueAt) {
      const cleaned = query.slice(0, prepDateMatch.index).trim();
      return { dueAt, cleanedQuery: cleaned };
    }
  }

  // Pattern 2: "... alle 18" / "... alle ore 18:30" / "... per le 18"
  const prepTimeMatch = query.match(
    /\s+(?:alle|per\s+le|alle\s+ore)\s*(\d{1,2})(?::(\d{2}))?$/i
  );
  if (prepTimeMatch) {
    const timePart = prepTimeMatch[0].trim();
    const dueAt = extractTargetDateTime(timePart, baseDate);
    if (dueAt) {
      const cleaned = query.slice(0, prepTimeMatch.index).trim();
      return { dueAt, cleanedQuery: cleaned };
    }
  }

  // Also accept the destination in the middle of the sentence, e.g.
  // "sposta a domani alle 12:00 il promemoria di comprare il pane".
  // Removing the temporal phrase before parsing the target prevents the
  // trailing ":00" from being mistaken for replacement text.
  const timeFirstDateMatch = query.match(
    /\b(?:alle|per\s+le|alle\s+ore)\s*(\d{1,2})(?::(\d{2}))?\s+(?:di\s+)?(domani|dopodomani|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)\b/i
  );
  if (timeFirstDateMatch) {
    const normalizedDate = `${timeFirstDateMatch[3]} alle ${timeFirstDateMatch[1]}:${timeFirstDateMatch[2] || '00'}`;
    const dueAt = extractTargetDateTime(normalizedDate, baseDate);
    if (dueAt) {
      return {
        dueAt,
        cleanedQuery: query.replace(timeFirstDateMatch[0], ' ').replace(/\s{2,}/g, ' ').trim(),
      };
    }
  }

  const embeddedDateMatch = query.match(
    /\b(?:a|per)\s+(domani|dopodomani|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+(?:alle|per\s+le)?\s*(\d{1,2})(?::(\d{2}))?)?/i
  );
  if (embeddedDateMatch) {
    const dueAt = extractTargetDateTime(embeddedDateMatch[0].trim(), baseDate);
    if (dueAt) {
      return {
        dueAt,
        cleanedQuery: query.replace(embeddedDateMatch[0], ' ').replace(/\s{2,}/g, ' ').trim(),
      };
    }
  }

  return { cleanedQuery: query };
}

/**
 * Decomposes an update query into target descriptor and destination parameters
 * (newText, dueAt, timeShiftMinutes).
 */
function parseUpdateCommand(
  rawQuery: string,
  baseDate: Date = new Date()
): {
  target: TargetDescriptor;
  parameters: {
    newText?: string;
    dueAt?: string;
    timeShiftMinutes?: number;
    updateMode?: 'REPLACE' | 'APPEND';
  };
} {
  let query = rawQuery;

  // 1. Relative shift (e.g. "di due ore", "di 30 minuti")
  const shift = extractRelativeTimeShift(query);
  if (shift !== undefined) {
    query = query
      .replace(
        /\b(?:di|tra|per)\s+(?:mezz['’]\s*ora|mezzora|un['’]\s*ora\s+e\s+(?:mezza|mezz['’]\s*ora|mezzora)|un['’]\s*ora|\d+\s+ore|\d+\s+minut[ie]|due\s+ore|tre\s+ore|quattro\s+ore|cinque\s+ore|sei\s+ore)\b/i,
        ''
      )
      .trim();
  }

  // 2. Destination date/time FIRST. This prevents the colon in times such as
  // "11:00" from being mistaken for a new-text delimiter and returning "00".
  const { dueAt, cleanedQuery } = extractDestinationDateTime(query, baseDate);
  query = cleanedQuery;

  // 3. New text (e.g. "e scrivi...", "in...", "con...", ":...")
  const newText = extractUpdateNewText(query);
  if (newText) query = query.replace(/\s+(?:aggiungendo|aggiungi|inserendo|inserisci)\s+(?:al|nel)\s+contenuto\s*:\s*["'`«»]?.+?["'`«»]?$/i, '').trim();
  const updateMode: 'REPLACE' | 'APPEND' = /\b(?:e\s+)?(?:aggiungi|aggiungendo|inserisci|inserendo)\b/i.test(query) ? 'APPEND' : 'REPLACE';
  if (newText) {
    query = query
      .replace(new RegExp(`(?:(?::\\s*|,\\s*scrivi:?\\s*|\\s+e\\s+scrivi:?\\s*|\\s+in:?\\s*|\\s+con:?\\s*))[\"\'\`«»]?${escapeRegex(newText)}[\"\'\`«»]?$`, 'i'), '')
      .replace(/\s+e\s+scrivi:?\s+([\"\'\`«»]?)(.+?)\1$/i, '')
      .replace(/\s+(?:e\s+)?aggiungi\s+(?:anche\s+)?([\"\'\`«»]?)(.+?)\1$/i, '')
      .replace(
        /\bcambia(?:\s+il)?\s+testo(?:\s+(?:della\s+|del\s+)?(?:prima\s+|seconda\s+|terza\s+|quarta\s+|quinta\s+|ultima\s+)?(?:nota|promemoria))?\s+(?:in|con)\s+([\"\'\`«»]?)(.+?)\1$/i,
        ''
      )
      .replace(/\s+(?:in|con)\s+([\"\'\`«»]?)(.+?)\1$/i, '')
      .replace(/:\s*([\"\'\`«»]?)(.+?)\1$/, '')
      .trim();
  }

  // 4. Strip update verbs and entity mentions from target query
  let rawTarget = query
    .replace(
      /^(?:sposta(?:mi)?|posticipa|rimanda|rinvia|cambia(?:\s+l['’]orario)?|modifica(?:\s+l['’]orario)?|ritarda|porta|aggiorna|correggi|riscrivi|mettilo|mettila|spostalo|spostala|rimandalo|rimandala|posticipalo|posticipala)\s*/i,
      ''
    )
    .replace(/^(?:il\s+testo\s+(?:della\s+nota|del\s+promemoria)?\s*)?/i, '')
    .trim();

  // Generic references such as "la mia nota" / "il mio promemoria" do not
  // identify a literal title. Leave the target unresolved so the resolver can
  // use the active selection or ask the user to choose from local candidates.
  if (/^(?:(?:(?:il|quel|quello|questo|mio)\s+)?promemoria|(?:(?:la|quella|questa|mia)\s+)?nota|(?:il\s+mio\s+promemoria)|(?:la\s+mia\s+nota))\s*$/i.test(rawTarget)) {
    rawTarget = '';
  } else {
    rawTarget = rawTarget
      .replace(
        /^(?:(?:il|quel|quello|questo)\s+promemoria|(?:la|quella|questa)\s+nota)\s+(?:del|dello|della|dei|degli|delle|di|sul|sulla|sullo|sui|sugli|sulle|su|che\s+parla\s+del?l?[aoei']?)\s+/i,
        ''
      )
      .replace(/^(?:(?:il|quel|quello|questo)\s+promemoria|(?:la|quella|questa)\s+nota)\s+/i, '')
      .trim();
  }

  // 5. Target extraction from rawTarget
  const ordinal = extractOrdinal(rawTarget);
  const pronounMatch = rawQuery
    .toLowerCase()
    .match(
      /\b(quello|quella|questo|questa|quel|spostalo|spostala|mettilo|mettila|rimandalo|rimandala|posticipalo|posticipala)\b/i
    );
  const textMatch = rawTarget.match(
    /(?:quella\s+)?(?:che\s+parla\s+del?l?[aoei']?|sulla|sul|sui|sulle|della|del|di)\s+([a-zà-ÿ0-9\s]+)$/i
  );

  let target: TargetDescriptor = { type: 'UNRESOLVED' };
  if (ordinal) {
    target = { type: 'ORDINAL', ...ordinal };
  } else if (/^(?:spostalo|spostala|mettilo|mettila|rimandalo|rimandala|posticipalo|posticipala|cancellalo|cancellala|eliminalo|eliminala)$/i.test(rawQuery.trim())) {
    target = { type: 'PRONOUN', rawReference: rawQuery.trim() };
  } else if (/^(?:quell[aoei']?|quel|quest[aoei']?)(?:\s+(?:nota|promemoria))?$/i.test(rawTarget) || (!rawTarget && pronounMatch)) {
    target = { type: 'PRONOUN', rawReference: rawTarget || pronounMatch?.[0] };
  } else if (textMatch) {
    target = {
      type: 'TEXT_MATCH',
      rawReference: rawTarget,
      matchedText: textMatch[1].trim(),
    };
  } else if (rawTarget) {
    target = {
      type: 'TEXT_MATCH',
      rawReference: rawTarget,
      matchedText: rawTarget,
    };
  } else if (pronounMatch) {
    target = { type: 'PRONOUN', rawReference: pronounMatch[0] };
  }

  return {
    target,
    parameters: {
      newText,
      dueAt,
      timeShiftMinutes: shift,
      ...(newText ? { updateMode } : {}),
    },
  };
}

/**
 * Leading self-correction / cancellation markers.
 * e.g. "Lascia perdere la nota, ...", "Mi correggo: ...", "Rettifico: ...", "Ho cambiato idea: ...", "Anzi, ..."
 */
const LEADING_CORRECTION_PATTERN =
  /^(?:(?:lascia\s+(?:perdere|stare)(?:\s+(?:la\s+nota|le\s+note|il\s+promemoria|i\s+promemoria|quello\s+che\s+ho\s+detto|quello|tutto))?|mi\s+correggo|rettifico|ho\s+cambiato\s+idea|cambia\s+idea|anzi(?:\s+no)?|no[,\s]+in\s+realt[aà]|in\s+realt[aà])[,:\s]+)/i;

/**
 * Mid-sentence self-correction / override delimiters.
 * e.g. "... , no aspetta, ...", "... , anzi ...", "... , mi correggo ...", "... , ma invece ..."
 */
const MID_SENTENCE_CORRECTION_REGEX =
  /(?:[,;]\s*|\s+)(?:no[,\s]+aspetta(?:\s+un\s+(?:attimo|momento))?|aspetta(?:\s+un\s+(?:attimo|momento))?|anzi(?:\s+no)?|no[,\s]+in\s+realt[aà]|in\s+realt[aà]|lascia\s+perdere(?:\s+(?:la\s+nota|le\s+note|il\s+promemoria|i\s+promemoria|quello|tutto))?|lascia\s+stare(?:\s+(?:la\s+nota|le\s+note|il\s+promemoria|i\s+promemoria|quello|tutto))?|ho\s+cambiato\s+idea|cambia\s+idea|mi\s+correggo|rettifico|piuttosto|o\s+meglio|meglio|bens[ìi]|ma\s+invece|invece)(?:[,;:\s]+)/i;

const CONTRAST_MA_REGEX = /(?:[,;]\s*|\s+)ma\s+/i;

/**
 * Identifies whether a user utterance contains an explicit self-correction or intention override.
 * Returns the final authoritative clause if a correction is detected, or null otherwise.
 */
function findLastCorrectionClause(text: string): { prefix: string; suffix: string } | null {
  let current = text.trim();
  let accumulatedPrefix = '';
  let foundCorrection = false;

  // 1. Check for leading correction marker
  const leadingMatch = current.match(LEADING_CORRECTION_PATTERN);
  if (leadingMatch) {
    foundCorrection = true;
    accumulatedPrefix += leadingMatch[0];
    current = current.slice(leadingMatch[0].length).trim();
  }

  // 2. Loop to find mid-sentence corrections from left to right, reaching the final replacement clause
  while (true) {
    const strippedCurrent = stripPolitePrefix(current);
    const midMatch = strippedCurrent.match(MID_SENTENCE_CORRECTION_REGEX);
    let splitIdx = -1;
    let delimiterLen = 0;

    if (midMatch && midMatch.index !== undefined) {
      splitIdx = midMatch.index;
      delimiterLen = midMatch[0].length;
    } else {
      // Check for contrastive "non ... , ma ..."
      const maMatch = strippedCurrent.match(CONTRAST_MA_REGEX);
      if (maMatch && maMatch.index !== undefined) {
        const potentialPrefix = strippedCurrent.slice(0, maMatch.index);
        if (/\bnon\b/i.test(potentialPrefix)) {
          splitIdx = maMatch.index;
          delimiterLen = maMatch[0].length;
        }
      }
    }

    if (splitIdx !== -1) {
      foundCorrection = true;
      const prefixPart = strippedCurrent.slice(0, splitIdx);
      const suffixPart = strippedCurrent.slice(splitIdx + delimiterLen).trim();
      accumulatedPrefix += (accumulatedPrefix ? ' ' : '') + prefixPart;
      current = suffixPart;
    } else {
      break;
    }
  }

  if (foundCorrection && current.length > 0) {
    return { prefix: accumulatedPrefix, suffix: current };
  }
  return null;
}

/**
 * Resolve a spoken/written self-correction before semantic aliases or lexical
 * scoring can be influenced by the abandoned clause.
 */
export function resolveSelfCorrection(text: string): { prefix: string; suffix: string } | null {
  return findLastCorrectionClause(cleanQuery(text));
}

/**
 * Pure, deterministic semantic intent classifier for MAIA (Phase 6B).
 *
 * RULES:
 * - Pure function (NO side effects, NO storage mutations, NO LLM calls).
 * - Distinguishes local action candidates from cognitive requests.
 * - Extracts verbs, entities, raw targets, and temporal parameters.
 * - Uses SessionContext strictly as contextual evidence without mutating it.
 */
/**
 * Language bridge for common local intents. This is semantic vocabulary, not a
 * phrase-by-phrase command list: the normalized concepts are consumed by the
 * same Italian intent/target pipeline below.
 */
function normalizePersonalFactLanguage(text: string): string {
  return text
    .replace(/\bmy\s+favorite\s+color\b/gi, 'il mio colore preferito')
    .replace(/\bfavorite\s+color\b/gi, 'colore preferito')
    .replace(/\bmy\s+favorite\s+team\b/gi, 'la mia squadra preferita')
    .replace(/\bfavorite\s+team\b/gi, 'squadra preferita')
    .replace(/\bmy\s+favorite\s+food\b/gi, 'il mio cibo preferito')
    .replace(/\bfavorite\s+food\b/gi, 'cibo preferito')
    .replace(/\bmy\s+favorite\s+pizza\b/gi, 'la mia pizza preferita')
    .replace(/\bmy\s+favorite\s+animal\b/gi, 'il mio animale preferito')
    .replace(/\bmi\s+color\s+favorito\b/gi, 'il mio colore preferito')
    .replace(/\bmi\s+equipo\s+favorito\b/gi, 'la mia squadra preferita')
    .replace(/\bmi\s+comida\s+favorita\b/gi, 'il mio cibo preferito')
    .replace(/\bes\b/gi, 'è')
    .replace(/\bis\b/gi, 'è');
}

function normalizeMultilingualLocalIntent(query: string, context?: SessionContext): { query: string; negated: boolean } {
  let q = query.trim();
  let negated = false;
  q = q.replace(/^segnati\s+una\s+cosa\s*:\s*(.+)$/i, 'prendi nota che $1');
  q = q.replace(/^segnati\s+(?:che\s+)?(.+)$/i, 'prendi nota che $1');
  q = q.replace(/^mi\s+devo\s+ricordare\s+di\s+(.+?)(?:,\s*(?:segnalo|annotalo|appuntalo))?$/i, 'ricordami di $1');
  q = q.replace(/^non\s+voglio\s+dimenticarmi\s+di\s+(.+)$/i, 'ricordami di $1');
  q = q.replace(/^which\s+reminders\s+do\s+i\s+have\??$/i, 'quali promemoria ho');
  q = q.replace(/^what\s+reminders\s+do\s+i\s+have\??$/i, 'quali promemoria ho');
  q = q.replace(/^show\s+me\s+my\s+reminders\s*$/i, 'mostrami i promemoria');
  q = q.replace(/^what\s+notes\s+do\s+i\s+have\??$/i, 'quali note ho');
  q = q.replace(/^show\s+me\s+my\s+notes\s*$/i, 'mostrami le note');
  q = q.replace(/^what\s+do\s+i\s+prefer\??$/i, 'quali sono le mie preferenze');
  q = q.replace(/^remember\s+that\s+(.+)$/i, 'ricordati che $1');
  q = q.replace(/^remember\s+(.+)$/i, 'ricordati che $1');
  q = q.replace(/^remind\s+me\s+(?:to\s+)?(.+)$/i, 'ricordami di $1');
  q = q.replace(/\btomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\b/gi, (_match, hour: string, minute?: string) =>
    minute ? `domani alle ${hour}:${minute}` : `domani alle ${hour}`,
  );
  q = q.replace(/\btomorrow\b/gi, 'domani');
  q = q.replace(/\bday\s+after\s+tomorrow\b/gi, 'dopodomani');
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
  q = q.replace(/^create\s+a\s+note\s+called\s+(.+?)\s+with\s+["“”]?(.+?)["“”]?$/i, 'crea una nota chiamata $1 con scritto $2');
  q = q.replace(/^make\s+a\s+note\s+called\s+(.+?)\s+with\s+["“”]?(.+?)["“”]?$/i, 'crea una nota chiamata $1 con scritto $2');
  q = q.replace(/^add\s+(.+?)\s+to\s+(?:the\s+)?note\s+["“”]?(.+?)["“”]?$/i, 'aggiungi $1 alla nota $2');
  q = q.replace(/^delete\s+the\s+reminder\s*(.*)$/i, 'cancella il promemoria $1');
  q = q.replace(/^delete\s+the\s+note\s*(.*)$/i, 'cancella la nota $1');
  if (context?.activeEntity === 'REMINDER' || context?.activeCollectionType === 'REMINDER') {
    q = q.replace(/^move\s+(?:it|that)\s+to\s+(.+)$/i, 'spostalo a $1');
  }
  if (context?.activeEntity === 'NOTE' || context?.activeCollectionType === 'NOTE') {
    q = q.replace(/^add\s+(.+)$/i, 'aggiungi anche $1');
  }
  const neg = q.match(/^(?:non|do\s+not|don't)\s+(.+)$/i);
  if (neg && /(?:cancell\w*|elimin\w*|rimuov\w*|aggiung\w*|inserisc\w*|mett\w*|crea(?:re)?|modific\w*|aggiorn\w*|spost\w*|posticip\w*|rimand\w*|ricordami|ricordare|delete|cancel|remove|add|create|update|change|move)\b/i.test(neg[1])) {
    negated = true;
    q = neg[1].trim();
    q = q.replace(/^delete\s+the\s+reminder/i, 'cancella il promemoria');
    q = q.replace(/^delete\s+the\s+note/i, 'cancella la nota');
    q = q.replace(/^cancellare\s+/i, 'cancella ');
    q = q.replace(/^eliminare\s+/i, 'elimina ');
    q = q.replace(/^rimuovere\s+/i, 'rimuovi ');
    q = q.replace(/^aggiungere\s+/i, 'aggiungi ');
    q = q.replace(/^inserire\s+/i, 'inserisci ');
    q = q.replace(/^mettere\s+/i, 'metti ');
    q = q.replace(/^modificare\s+/i, 'modifica ');
    q = q.replace(/^aggiornare\s+/i, 'aggiorna ');
    q = q.replace(/^spostare\s+/i, 'sposta ');
    q = q.replace(/^posticipare\s+/i, 'posticipa ');
    q = q.replace(/^rimandare\s+/i, 'rimanda ');
    q = q.replace(/^add\s+/i, 'aggiungi ');
    q = q.replace(/^create\s+/i, 'crea ');
    q = q.replace(/^update\s+/i, 'aggiorna ');
    q = q.replace(/^change\s+/i, 'modifica ');
    q = q.replace(/^move\s+/i, 'sposta ');
  }
  return { query: q, negated };
}

function classifyIntentInternal(
  query: string,
  context?: SessionContext,
  isSubQuery: boolean = false
): SemanticIntent {
  const clean = cleanQuery(query);

  // Resolve explicit self-corrections against the original utterance before any
  // normalization can alter the boundary between the cancelled and final clause.
  if (!isSubQuery) {
    const correction = findLastCorrectionClause(clean);
    if (correction) {
      const suffixIntent = classifyIntentInternal(correction.suffix, context, true);
      return { ...suffixIntent, rawQuery: clean };
    }
  }

  let stripped = stripPolitePrefix(clean);
// Conversational connector: "E ..." should not change the underlying intent.
// Keep the original rawQuery intact for context/logging.
stripped = stripped.replace(/^(?:e|ed)[,\s:]+(?=\S)/i, '').trim();
const normalizedLocal = normalizeMultilingualLocalIntent(stripped, context);
stripped = normalizedLocal.query;
const localNegated = normalizedLocal.negated;
const lower = stripped.toLowerCase();

  // Project workspace commands are local operations backed by maia_projects_v1.
  const createProjectMatch = stripped.match(/^(?:crea|aggiungi|avvia|inizia)\s+(?:un\s+)?progetto(?:\s+(?:chiamato|denominato|con\s+nome))?\s*(?::|-)?\s*(.+)$/i);
  if (createProjectMatch) {
    const projectRemainder = createProjectMatch[1].trim();
    const objectiveMatch = projectRemainder.match(/^(.*?)\s+(?:con\s+l['’]obiettivo\s+(?:di\s+)?|obiettivo\s*:\s*)(.+)$/i);
    const projectName = (objectiveMatch ? objectiveMatch[1] : projectRemainder).trim().replace(/[.,;:]+$/, '');
    const projectObjective = (objectiveMatch?.[2] || '').trim().replace(/[.,;:]+$/, '');
    return {
      verb: 'CREATE', entity: 'PROJECT', target: { type: 'UNRESOLVED' },
      parameters: { projectName, projectObjective }, confidence: 'HIGH', rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }
  if (/^(?:mostra(?:mi)?|elenca(?:mi)?|fammi\s+vedere|quali\s+sono|quali)\s+(?:i\s+)?(?:miei\s+)?progetti(?:\s+salvati)?$/i.test(stripped) || /^(?:i\s+miei\s+progetti|progetti\s+salvati)$/i.test(stripped)) {
    return {
      verb: 'READ', entity: 'PROJECT', target: { type: 'ALL', rawReference: 'progetti' },
      parameters: {}, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true,
    };
  }

  // ==========================================================================
  // 1. COGNITIVE / EXPLANATION / GENERAL GUARDS (Negative Filter)
  // ==========================================================================

  // 1a. Math Questions with Ordinals or Calculations
  // e.g. "Il primo numero primo maggiore di 100?", "Quanto fa 837 × 46?", "Calcola 1450 diviso 12"
  if (
    /\b(?:numero\s+primo|numeri\s+primi)\b/i.test(lower) ||
    /^(?:quanto\s+fa|calcola|risolvi|fai\s+il\s+calcolo)\b/i.test(lower) ||
    /^\d+\s*[\+\-\*\/×÷]\s*\d+/.test(lower)
  ) {
    return {
      verb: 'EXPLAIN',
      entity: 'UNKNOWN',
      target: { type: 'UNRESOLVED' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: false,
    };
  }

  // 1b. Explanations & Epistemic Inquiries
  // e.g. "Spiegami perché devo ricordarmi di una cosa", "Perché il cielo è blu?", "Spiegami la relatività", "Puoi spiegarmi come funzionano le note?"
  if (
    !isWebSearchCandidate(clean, context) &&
    /^(?:(?:(?:mi\s+)?(?:puoi|potresti)\s+)?spiega(?:mi|re)?|perch[eé]|(?:che|cosa)\s+significa|cos['’][eè]|chi\s+[eè]|chi\s+era|raccontami|parlami\s+di|come\s+(?:funziona|si)|definizione\s+di)\b/i.test(lower)
  ) {
    return {
      verb: 'EXPLAIN',
      entity: 'UNKNOWN',
      target: { type: 'UNRESOLVED' },
      parameters: {
        freshness: classifyFreshness(clean),
      },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: false,
    };
  }

  // 1c. Generative & Language Coprocessor Requests
  // e.g. "Scrivimi una mail per il capo", "Traduci questo in inglese", "Componi una poesia"
  if (
    /^(?:scrivi(?:mi)?\s+(?:una|un)?|traduci(?:mi)?|componi(?:mi)?|crea\s+un\s+testo|riassumi(?:mi)?)\b/i.test(lower) &&
    !/^(?:scrivi(?:mi)?|crea)\s+(?:una\s+)?nota\b/i.test(lower)
  ) {
    return {
      verb: 'EXPLAIN',
      entity: 'UNKNOWN',
      target: { type: 'UNRESOLVED' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: false,
    };
  }

  // 1d. DIRECT PROFILE STATEMENTS. These are local memory writes, not chat prompts.
  const combinedProfileStatement = stripped.match(/^(?:mi\s+chiamo|il\s+mio\s+nome\s+è|sono)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’-]*?)\s+(?:e|ed)\s+(?:vivo\s+a|abito\s+a|risiedo\s+a)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’-]*)$/i);
  if (combinedProfileStatement) {
    const name = combinedProfileStatement[1].trim();
    const city = combinedProfileStatement[2].trim();
    return { verb: 'CREATE', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: name }, parameters: { profileName: name, profileCity: city, text: `Mi chiamo ${name} e vivo a ${city}` }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const directNameStatement = stripped.match(/^(?:mi\s+chiamo|il\s+mio\s+nome\s+è|chiamami)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’-]*)$/i);
  if (directNameStatement) {
    const value = directNameStatement[1].trim();
    return { verb: 'CREATE', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: value }, parameters: { profileField: 'userName', profileValue: value, text: value }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const directCityStatement = stripped.match(/^(?:vivo\s+a|abito\s+a|risiedo\s+a|la\s+mia\s+città\s+è)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’-]*)$/i);
  if (directCityStatement) {
    const value = directCityStatement[1].trim();
    return { verb: 'CREATE', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: value }, parameters: { profileField: 'userCity', profileValue: value, text: value }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  // 1e. Generic personal facts: semantic memory, not provider chat.
  // The parser relies on grammatical structure (possessive + copula + value),
  // not a vocabulary of specific attributes such as color/food/animal.
  const bilingualPersonalFact = normalizePersonalFactLanguage(stripped);
  const personalFact = parsePersonalFactStatement(bilingualPersonalFact);
  if (personalFact.isPersonalFact) {
    return {
      verb: 'CREATE',
      entity: 'MEMORY',
      target: { type: 'TEXT_MATCH', rawReference: personalFact.key },
      parameters: {
        personalFactKey: personalFact.key,
        personalFactValue: personalFact.value,
        text: personalFact.rawText || stripped,
        subcategory: 'personal_facts',
      },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 1d. Passive / Casual Statements (NOT explicit memory commands or MAIA behavioral preferences)
  // e.g. "Mi piace molto la fotografia", "Oggi fa freddo"
  if (
    /^(?:mi\s+piace|adoro|amo|preferisco|trovo\s+che|penso\s+che|oggi\s+fa|ieri\s+ho)\b/i.test(lower) &&
    !/^(?:ricordati|ricorda|tieni\s+a\s+mente|memorizza)\b/i.test(lower) &&
    !parsePreferenceStatement(stripped).isPreference
  ) {
    return {
      verb: 'EXPLAIN',
      entity: 'UNKNOWN',
      target: { type: 'UNRESOLVED' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: false,
    };
  }

  // ==========================================================================
  if (/^(?:cosa|che\s+cosa)\s+(?:ricordi|sai)\s+(?:di|su)\s+me$/i.test(stripped)) {
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'ALL', rawReference: 'memoria' }, parameters: {}, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  // 1e. DIRECT PERSONAL-MEMORY QUERIES
  // These must be resolved by MAIA MemoryCapability, never by the LLM provider.
  // ==========================================================================
  if (/^(?:come\s+mi\s+chiamo|qual(?:e| è|e\s+è)\s+il\s+mio\s+nome|chi\s+sono\s+io)$/i.test(stripped)) {
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: 'nome' }, parameters: { profileField: 'userName' }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  if (/^(?:dove\s+vivo|qual(?:e| è|e\s+è)\s+la\s+mia\s+città|in\s+che\s+città\s+vivo)$/i.test(stripped)) {
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: 'città' }, parameters: { profileField: 'userCity' }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const naturalMemoryQuery = stripped.match(/^(?:cosa\s+sai\s+del\s+mio|cosa\s+sai\s+della\s+mia|che\s+cosa\s+sai\s+del\s+mio|che\s+cosa\s+sai\s+della\s+mia)\s+(.+)$/i);
  if (naturalMemoryQuery) {
    const requestedFact = normalizePersonalFactLanguage(naturalMemoryQuery[1].trim());
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: requestedFact }, parameters: { personalFactQuery: requestedFact }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const storedNameQuery = stripped.match(/^che\s+nome\s+hai\s+memorizzat[oa]\s+per\s+me\??$/i);
  if (storedNameQuery) {
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: 'nome' }, parameters: { profileField: 'userName' }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const preferenceNaturalQuery = stripped.match(/^cosa\s+(?:preferisco|mi\s+piace\s+di\s+più)(?:\s+(?:mangiare|bere))?\??$/i);
  if (preferenceNaturalQuery) {
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'ALL', rawReference: 'preferenze' }, parameters: { subcategory: 'preferences' }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const personalFactQuery = stripped.match(/^(?:qual(?:e| è|e\s+è)\s+il\s+mio\s+|qual(?:e| è|e\s+è)\s+la\s+mia\s+|che\s+cosa\s+mi\s+piace\s+di\s+più\s+)(.+)$/i);
  if (personalFactQuery) {
    const requestedFact = normalizePersonalFactLanguage(personalFactQuery[1].trim().replace(/[?!.]+$/, '').trim());
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'TEXT_MATCH', rawReference: requestedFact }, parameters: { personalFactQuery: requestedFact }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  if (/^(?:e\s+)?qual(?:e| è|e\s+è)\s+il\s+mio\s*\??$/i.test(stripped) && context?.lastSuccessfulAction?.entity === 'MEMORY' && context.lastSuccessfulAction.verb === 'CREATE') {
    return { verb: 'READ', entity: 'MEMORY', target: { type: 'PRONOUN', rawReference: 'il mio' }, parameters: { personalFactQuery: '__LAST_MEMORY__' }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  // Explicit note lookups are local archive operations, not web searches.
  // Handles the previously misrouted forms "cerca la nota X" and "apri la nota X".
  const localNoteLookup = stripped.match(/^(?:cerca|trova|ricerca|apri|leggi|mostra(?:mi)?)\s+(?:la\s+)?nota\s+["'“”«»]?(.+?)["'“”«»]?$/i);
  if (localNoteLookup) {
    const noteReference = localNoteLookup[1].trim().replace(/[?!.]+$/, '').trim();
    if (noteReference) {
      return {
        verb: 'READ',
        entity: 'NOTE',
        target: { type: 'TEXT_MATCH', rawReference: noteReference, matchedText: noteReference },
        parameters: { text: noteReference },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // ==========================================================================
  // 2. WEB SEARCH CAPABILITY (Phase 6G Web Search Hardening)
  // ==========================================================================
  if (isWebSearchCandidate(clean, context)) {
    const { cleanQuery, category, freshness, isFollowUp } = extractCleanSearchQuery(clean, context);
    return {
      verb: 'SEARCH',
      entity: 'WEB',
      target: { type: 'UNRESOLVED', rawReference: cleanQuery },
      parameters: {
        category,
        searchQuery: cleanQuery,
        freshness,
        isFollowUp,
      },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: false,
    };
  }

  // ==========================================================================
  // 3. EXPLICIT MEMORY & PREFERENCE COMMANDS (CREATE / READ / DELETE)
  // ==========================================================================

  // 3a. RESET / DELETE ALL PREFERENCES: "Resetta le mie preferenze", "Cancella tutte le mie preferenze", etc.
  if (isPreferenceReset(stripped)) {
    return {
      verb: 'DELETE',
      entity: 'MEMORY',
      target: { type: 'ALL', rawReference: 'tutte le preferenze' },
      parameters: { text: 'preferenze', subcategory: 'preferences' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 3b. READ PREFERENCES: "Mostrami le mie preferenze", "Quali sono le mie preferenze?", etc.
  if (isPreferenceQuery(stripped)) {
    return {
      verb: 'READ',
      entity: 'MEMORY',
      target: { type: 'ALL', rawReference: 'preferenze' },
      parameters: { subcategory: 'preferences' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 3c. DELETE / FORGET SPECIFIC PREFERENCE: "Dimentica che preferisco...", "Cancella la preferenza di..."
  const deletePrefMatch = stripped.match(
    /^(?:dimentica(?:ti)?\s+(?:la\s+preferenza\s+(?:di|su|per)\s+|che\s+preferisco\s+|la\s+preferenza\s+)|rimuovi\s+(?:dalla\s+memoria\s+)?(?:la\s+preferenza\s+(?:di|su|per)\s+|che\s+preferisco\s+)|cancella\s+(?:dalla\s+memoria\s+)?(?:la\s+preferenza\s+(?:di|su|per)\s+|che\s+preferisco\s+))\s*(.+)$/i
  );
  if (deletePrefMatch) {
    const rawTarget = deletePrefMatch[1].trim();
    return {
      verb: 'DELETE',
      entity: 'MEMORY',
      target: { type: 'TEXT_MATCH', rawReference: rawTarget },
      parameters: { text: rawTarget, subcategory: 'preferences' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 3d. CREATE MEMORY: "Ricordati che...", "Tieni a mente che...", "Memorizza che..."
  const saveMemoryMatch = stripped.match(
    /^(?:ricordati\s+che|ricorda\s+che|tieni\s+a\s+mente\s+che|memorizza\s+che)\s+(.+)$/i
  );
  if (saveMemoryMatch) {
    const memoryText = saveMemoryMatch[1].trim().replace(/^[:\s\-–—]+/, '').trim();
    const normalizedMemoryText = normalizePersonalFactLanguage(memoryText);
    const personalFact = parsePersonalFactStatement(normalizedMemoryText);
    if (personalFact.isPersonalFact) {
      return {
        verb: 'CREATE',
        entity: 'MEMORY',
        target: { type: 'TEXT_MATCH', rawReference: personalFact.key },
        parameters: {
          personalFactKey: personalFact.key,
          personalFactValue: personalFact.value,
          text: personalFact.rawText || memoryText,
          subcategory: 'personal_facts',
        },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
    return {
      verb: 'CREATE',
      entity: 'MEMORY',
      target: { type: 'TEXT_MATCH', rawReference: memoryText },
      parameters: { text: memoryText },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 3e. READ MEMORY: "Cosa ricordi di me?", "Che cosa ricordi di me?", "Mostrami la memoria"
  if (
    /^(?:(?:che\s+)?cosa\s+(?:ricordi|sai)\s+(?:di|su)\s+me|mostra(?:mi)?\s+(?:la\s+)?memoria|elenca\s+(?:la\s+)?memoria)\b/i.test(lower)
  ) {
    return {
      verb: 'READ',
      entity: 'MEMORY',
      target: { type: 'ALL', rawReference: 'memoria' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 3f. DELETE ALL MEMORY: "Cancella tutta la memoria", "Dimentica tutto", etc.
  const isDeleteAllMemory =
    /^(?:cancella|elimina|rimuovi|svuota)\s+(?:(?:tutta|tutto)\s+(?:la\s+)?(?:mia\s+)?memoria|la\s+memoria|(?:tutti\s+i\s+)?(?:miei\s+)?ricordi|ogni\s+ricordo|ogni\s+informazione)$/i.test(stripped) ||
    /^(?:dimentica|scorda)\s+(?:tutto|ogni cosa|tutti i miei ricordi)$/i.test(stripped);
  if (isDeleteAllMemory) {
    return {
      verb: 'DELETE',
      entity: 'MEMORY',
      target: { type: 'ALL', rawReference: 'tutta la memoria' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  const deleteProfileMatch = stripped.match(/^(?:dimentica(?:ti)?|scorda|rimuovi|cancella|elimina)(?:\s+(?:dalla\s+memoria|dalla\s+memoria\s+personale))?\s+(?:(?:il|la)\s+(?:(?:mio|mia)\s+)?)?(nome|città|citta)$/i);
  if (deleteProfileMatch) {
    const fieldName = deleteProfileMatch[1].toLowerCase();
    const profileField = fieldName === 'nome' ? 'userName' : 'userCity';
    return {
      verb: 'DELETE',
      entity: 'MEMORY',
      target: { type: 'TEXT_MATCH', rawReference: fieldName },
      parameters: { profileField, text: fieldName, subcategory: 'profile' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // Specific personal-fact deletion: "Dimentica il mio colore preferito".
  const deletePersonalFactMatch = stripped.match(
    /^(?:dimentica(?:ti)?|scorda|rimuovi|cancella|elimina)(?:\s+dalla\s+memoria)?\s+(?:il\s+mio|la\s+mia|i\s+miei|le\s+mie)\s+(.+)$/i
  );
  if (deletePersonalFactMatch) {
    const rawTarget = deletePersonalFactMatch[1].trim().replace(/[?!.]+$/, '').trim();
    return {
      verb: 'DELETE',
      entity: 'MEMORY',
      target: { type: 'TEXT_MATCH', rawReference: rawTarget },
      parameters: { text: rawTarget, subcategory: 'personal_facts' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  const deleteMemoryMatch = stripped.match(
    /^(?:dimentica(?:ti)?\s+che|rimuovi\s+dalla\s+memoria\s+che|cancella\s+dalla\s+memoria\s+che|elimina\s+dalla\s+memoria\s+che|scorda\s+che)\s+(.+)$/i
  );
  if (deleteMemoryMatch) {
    return {
      verb: 'DELETE',
      entity: 'MEMORY',
      target: { type: 'TEXT_MATCH', rawReference: deleteMemoryMatch[1].trim() },
      parameters: { text: deleteMemoryMatch[1].trim() },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 3g. EXPLICIT PREFERENCE STATEMENTS & BEHAVIORAL CUES (Phase 6H Learning & Preferences)
  const isNoteOrReminderCommand =
    /^(?:prendi\s+nota|annota|appunta|nuova\s+nota|segn(?:a|ami)\s+(?:una\s+)?nota|crea\s+(?:una\s+)?nota|aggiungi\s+(?:una\s+)?nota|ricordami\s+di|crea\s+(?:un\s+)?promemoria|nuovo\s+promemoria)\b/i.test(
      stripped
    );

  if (!isNoteOrReminderCommand) {
    // Accept a natural preference statement followed by an explicit save cue,
    // e.g. "Preferisco risposte dirette... Memorizza questa preferenza".
    const preferenceCandidate = stripped
      .replace(/[.!?;,:\s]+(?:memorizza|salva|ricorda)\s+(?:questa|la)\s+preferenza[.!?]*$/i, '')
      .trim();
    const prefStmt = parsePreferenceStatement(preferenceCandidate);
    if (prefStmt.isPreference) {
      if (prefStmt.isTemporary) {
        return {
          verb: 'CREATE',
          entity: 'MEMORY',
          target: { type: 'TEXT_MATCH', rawReference: prefStmt.rawText || stripped },
          parameters: {
            text: prefStmt.rawText || stripped,
            key: prefStmt.key,
            value: prefStmt.value,
            category: prefStmt.category,
            isTemporary: true,
            subcategory: 'temporary_preference',
          },
          confidence: 'HIGH',
          rawQuery: clean,
          isLocalActionCandidate: true,
        };
      }

      return {
        verb: 'CREATE',
        entity: 'MEMORY',
        target: { type: 'TEXT_MATCH', rawReference: prefStmt.standardizedText || stripped },
        parameters: {
          text: prefStmt.standardizedText || stripped,
          key: prefStmt.key,
          value: prefStmt.value,
          category: prefStmt.category,
          scope: prefStmt.scope,
          subcategory: 'preferences',
        },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    if (prefStmt.isBehavioralEvidence) {
      return {
        verb: 'CREATE',
        entity: 'MEMORY',
        target: { type: 'TEXT_MATCH', rawReference: prefStmt.rawText || stripped },
        parameters: {
          text: prefStmt.rawText || stripped,
          key: prefStmt.key,
          value: prefStmt.value,
          category: prefStmt.category,
          isBehavioralEvidence: true,
          subcategory: 'behavioral_evidence',
        },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // ==========================================================================
  // 4. EXPLICIT NOTE COMMANDS (CREATE / READ / UPDATE / DELETE)
  // ==========================================================================

  // 4a. CREATE NOTE: named natural form. The note model stores text only,
  // so persist only the content after "con scritto".
  const titledNoteColonMatch = stripped.match(/^(?:crea|creare|aggiungi|aggiungere)\s+(?:(?:una|la)\s+)?nota\s+(.+?)\s*:\s*(.+)$/i);
  if (titledNoteColonMatch) {
    const title = titledNoteColonMatch[1].trim();
    const noteText = titledNoteColonMatch[2].trim();
    if (title && noteText) {
      return { verb: 'CREATE', entity: 'NOTE', target: { type: 'UNRESOLVED' }, parameters: { text: noteText, title }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
    }
  }

  const titledNoteInsideMatch = stripped.match(/^(?:crea|creare|aggiungi|aggiungere)\s+(?:(?:una|la)\s+)?nota\s+(?:chiamata|intitolata)?\s*(.+?)\s+(?:con\s+dentro|e\s+scrivi\s+dentro|scrivi\s+dentro)\s+(.+)$/i);
  if (titledNoteInsideMatch) {
    const title = titledNoteInsideMatch[1].trim().replace(/^[:\s\-–—]+|[:\s\-–—]+$/g, '');
    const noteText = titledNoteInsideMatch[2].trim();
    if (title && noteText) {
      return { verb: 'CREATE', entity: 'NOTE', target: { type: 'UNRESOLVED' }, parameters: { text: noteText, title }, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
    }
  }

  const namedNoteMatch = stripped.match(/^(?:crea|creare|aggiungi|aggiungere)\s+(?:una\s+)?nota\s+(?:chiamata|intitolata)\s+(.+?)\s+con\s+scritto\s+(.+)$/i);
  if (namedNoteMatch) {
    const title = namedNoteMatch[1].trim().replace(/^[:\s\-–—]+|[:\s\-–—]+$/g, '');
    const noteText = namedNoteMatch[2].trim().replace(/^[:\s\-–—]+/, '').trim();
    if (title && noteText) {
      return {
        verb: 'CREATE',
        entity: 'NOTE',
        target: { type: 'UNRESOLVED' },
        parameters: { text: noteText, title },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // 4a. CREATE NOTE: "Prendi nota che...", "Annota che...", "Nuova nota...", "Appunta: ...", "Segna una nota: ...", polite/interrogative forms
  if (/^(?:crea|creare)\s+(?:una\s+)?nota$/i.test(stripped)) {
    return { verb: 'CREATE', entity: 'NOTE', target: { type: 'UNRESOLVED' }, parameters: {}, confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true };
  }

  const createNoteMatch = stripped.match(
    /^(?:(?:\b(?:mi\s+)?(?:puoi|potresti|fai\s+il\s+favore\s+di|faresti\s+il\s+favore\s+di)\s+)?(?:prend(?:ere|i)\s+nota|annot(?:are|armi|a|ami|i)|appunt(?:are|armi|a|ami|i)|segn(?:are|armi|a|ami|i)\s+(?:una\s+)?nota|cre(?:are|a)\s+(?:una\s+)?nota|aggiung(?:ere|i)\s+(?:una\s+)?nota|nuova\s+nota)|(?:mi\s+)?(?:annoti|appunti|segni\s+(?:una\s+)?nota))\s*(?::|\s+con|\s+che|\s+di|\s+per|\s+)\s*(.*)$/i
  );
  if (createNoteMatch) {
    const noteText = (createNoteMatch[1]?.trim() || '')
      .replace(/^[:\s\-–—]+/, '')
      .replace(/^(?:che|di|a)\s+/i, '')
      .trim();
    if (noteText.length > 0) {
      return {
        verb: 'CREATE',
        entity: 'NOTE',
        target: { type: 'UNRESOLVED' },
        parameters: { text: noteText },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // 4b. READ NOTES:
  // - General/List: "Mostrami le note", "Fammi vedere le note", "Quali sono le mie note", "Voglio vedere le mie note", "Cerca tra le mie note..."
  // - Contextual/Specific: "Qual è il contenuto dell'ultima nota che ho modificato?", "qual è l'ultima nota che ho modificato?",
  //   "fammi vedere l'ultima nota che ho aggiornato", "cosa c'è nell'ultima nota che ho cambiato?", "qual era l'ultima nota che ho modificato?",
  //   "cosa c'è scritto nella prima nota?", "fammi vedere quella nota", "qual è il testo della seconda nota?"
  const searchInNotesMatch = stripped.match(
    /^(?:cerca|trova)\s+(?:tra|nelle)\s+(?:le\s+)?(?:mie\s+)?note\b\s*(.*)$/i
  );
  if (searchInNotesMatch) {
    const rawTarget = searchInNotesMatch[1]?.trim() || '';
    return {
      verb: 'READ',
      entity: 'NOTE',
      target: rawTarget
        ? { type: 'TEXT_MATCH', rawReference: rawTarget }
        : { type: 'ALL', rawReference: 'le mie note' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  const isNoteInquiry =
    /\b(?:nota|note)\b/i.test(stripped) &&
    (
      /^(?:qual\s+[eè]|qual\s+era|quali\s+sono|che|cosa|cos['’][eè]|dimmi)\b/i.test(lower) ||
      /^(?:mostra(?:mi)?|fammi\s+vedere|fai\s+vedere|voglio\s+vedere|vorrei\s+vedere|posso\s+vedere|fammi\s+leggere|leggi(?:mi)?|apri|visualizza(?:mi)?|elenca(?:mi)?|vedi)\b/i.test(lower) ||
      /^(?:le\s+mie\s+note|la\s+mia\s+nota)$/i.test(lower)
    );

  const readNoteAction =
    /^(?:mostra(?:mi)?|fammi\s+vedere|fai\s+vedere|voglio\s+vedere|vorrei\s+vedere|posso\s+vedere|elenca(?:mi)?|leggimi|leggi|vedi|apri|quali\s+sono(?:\s+tutte)?(?:\s+le|\s+la)?|quali\s+note\s+ho|che\s+note\s+ho)\s+(?:tutte\s+le\s+(?:mie\s+)?note|le\s+(?:mie\s+)?note|la\s+(?:mia\s+)?nota|note|nota)\b/i;

  const standaloneReadNote =
    /^(?:quali\s+note\s+(?:ho|ci\s+sono)|che\s+note\s+(?:ho|ci\s+sono)|quali\s+sono\s+le\s+(?:mie\s+)?note|le\s+mie\s+note|la\s+mia\s+nota)\b/i;

  if (isNoteInquiry || readNoteAction.test(lower) || standaloneReadNote.test(lower)) {
    // 1. Contextual Relative Reference (e.g. "l'ultima nota che ho modificato / aggiornato / cambiato / salvato")
    const isModifiedRef =
      /\b(?:modificat[aoei]|aggiornat[aoei]|cambiat[aoei]|corrett[aoei]|riscritt[aoei]|che\s+ho\s+(?:modificato|aggiornato|cambiato|corretto|riscritto))\b/i.test(lower);
    const isCreatedRef =
      /\b(?:creat[aoei]|salvat[aoei]|aggiunt[aoei]|pres[aoei]|che\s+ho\s+(?:creato|salvato|aggiunto|preso))\b/i.test(lower);
    const isLastOrRecent =
      /\b(?:l['’]ultima|ultima|recent[ei]|appena)\b/i.test(lower);

    if (isModifiedRef && (isLastOrRecent || /\b(?:quella|la)\s+nota\b/i.test(lower))) {
      return {
        verb: 'READ',
        entity: 'NOTE',
        target: {
          type: 'RELATIVE_TIME',
          rawReference: "l'ultima nota che ho modificato",
          relativeAction: 'UPDATE',
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    if (isCreatedRef && isLastOrRecent) {
      return {
        verb: 'READ',
        entity: 'NOTE',
        target: {
          type: 'RELATIVE_TIME',
          rawReference: "l'ultima nota che ho creato",
          relativeAction: 'CREATE',
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    // 2. Ordinal Reference ("la prima nota", "la seconda nota", "l'ultima nota")
    const ordinal = extractOrdinal(lower);
    if (ordinal) {
      return {
        verb: 'READ',
        entity: 'NOTE',
        target: {
          type: 'ORDINAL',
          ...ordinal,
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    // 3. Pronoun Reference ("quella nota", "questa nota")
    if (/\b(?:quella|questa|quell['’])\s+nota\b/i.test(lower)) {
      return {
        verb: 'READ',
        entity: 'NOTE',
        target: {
          type: 'PRONOUN',
          rawReference: 'quella nota',
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    // 4. Topic / Text Match ("la nota sulla spesa", "la nota del pane")
    const topicMatch = lower.match(
      /\bnota\s+(?:sul?l?[aoei']?|d[eio][l']?|che\s+parla\s+d[eio][l']?)\s+([a-zà-ÿ0-9\s]+?)$/i
    );
    if (topicMatch) {
      return {
        verb: 'READ',
        entity: 'NOTE',
        target: {
          type: 'TEXT_MATCH',
          rawReference: topicMatch[0].trim(),
          matchedText: topicMatch[1].trim(),
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    // 5. Default: All or Single Unresolved
    const isPlural = /\b(?:tutte\s+le\s+note|le\s+note|quali\s+note)\b/i.test(lower);
    return {
      verb: 'READ',
      entity: 'NOTE',
      target: {
        type: isPlural ? 'ALL' : 'UNRESOLVED',
        rawReference: isPlural ? 'le mie note' : 'la mia nota',
      },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 4c. UPDATE NOTE: "Modifica la nota", "Cambia la prima nota", "Modifica quella nota: ...", "Quella nota cambiala in: ..."
  const updateNoteMatch = stripped.match(
    /^(?:(?:modifica|aggiorna|cambia|correggi|riscrivi)\s+(?:(?:quella|questa|la|le)\s+)?(?:il\s+testo\s+(?:della\s+)?(?:prima\s+|seconda\s+|terza\s+|quarta\s+|quinta\s+|ultima\s+)?nota\s+(?:in|con)\s+(.+)|(?:prima\s+|seconda\s+|terza\s+|quarta\s+|quinta\s+|ultima\s+)?nota\b\s*(.*)|quella\s+(?:che\s+parla\s+del?l?[aoei']?|sulla|su)\s+(.*)|.*nota\b.*)|(?:quella|questa)\s+nota\s+(?:cambiala|modificala|aggiornala)\b.*)$/i
  );
  if (updateNoteMatch) {
    const { target, parameters } = parseUpdateCommand(stripped);
    return {
      verb: 'UPDATE',
      entity: 'NOTE',
      target,
      parameters,
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 4d. DELETE NOTES: "Cancella tutte le note", "Elimina le note", "Cancella la prima nota", "Cancella la nota", "Cancella quella nota", "Svuota le note"
  const isDeleteAllNotes =
    /^(?:cancella|eliminami|elimina|rimuovimi|rimuovi|svuota)\s+(?:tutte\s+le\s+note|le\s+(?:mie\s+)?note|note|tutto\s+quello\s+che\s+ho\s+nelle\s+note|ogni\s+nota)$/i.test(stripped);
  if (isDeleteAllNotes) {
    return {
      verb: 'DELETE',
      entity: 'NOTE',
      target: { type: 'ALL', rawReference: 'tutte le note' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  const deleteNoteMatch = stripped.match(
   /^(?:cancella|eliminami|elimina|rimuovimi|rimuovi)\s+(?:tutte\s+le\s+note|le\s+note|(?:la|quella|questa|quell['’])\s+(?:(?:prima|seconda|terza|quarta|quinta|ultima|penultima)\s+)?nota|nota)\b\s*(.*)$/i
  );
  if (deleteNoteMatch) {
    const rawTarget = deleteNoteMatch[1]?.trim() || '';
    const isAll = /\b(?:tutte|le\s+note|note)\b/i.test(lower);
    const isPronoun = /\b(?:quella|questa)\s+nota\b/i.test(stripped) && !rawTarget;
    const ordinal = extractOrdinal(rawTarget);
    return {
      verb: 'DELETE',
      entity: 'NOTE',
      target: isAll && !rawTarget
        ? { type: 'ALL', rawReference: 'tutte le note' }
        : isPronoun
        ? { type: 'PRONOUN', rawReference: 'quella' }
        : ordinal
        ? { type: 'ORDINAL', ...ordinal }
        : rawTarget
        ? { type: 'TEXT_MATCH', rawReference: rawTarget }
        : { type: 'UNRESOLVED' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // ==========================================================================
  // 5. EXPLICIT REMINDER COMMANDS (CREATE / READ / UPDATE / COMPLETE / DELETE)
  // ==========================================================================

  // 5a. CREATE REMINDER: "Ricordami di...", "Imposta un promemoria per...", "promemoria: chiamare Roberto", "promemoria chiamare Roberto"
  const createReminderMatch = stripped.match(
    /^(?:ricordami\s+(?:di\s+|a\s+|che\s+)?|metti\s+(?:un\s+)?promemoria\s*(?::|\s+per|\s+di)?|imposta\s+(?:un\s+)?promemoria\s*(?::|\s+per|\s+di)?|crea\s+(?:un\s+)?promemoria\s*(?::|\s+per|\s+di)?|aggiungi\s+(?:un\s+)?promemoria\s*(?::|\s+per|\s+di)?|nuovo\s+promemoria\s*:?|(?:promemoria|memo|reminder)\s*(?::|\s+per|\s+di|\s+a|\s+che|\s+))\s*(.*)$/i
  );
  if (createReminderMatch) {
    const rawContent = (createReminderMatch[1]?.trim() || '')
      .replace(/^[:\s\-–—]+/, '')
      .replace(/^(?:per|di|a|che)\s+/i, '')
      .trim();

    // Guard: ignore if empty, or if rawContent is an inquiry or another command verb
    const isQuestionOrAction =
      rawContent.length === 0 ||
      /^(?:cosa|cos['’][eè]|come|perch[eé]|chi|qual[eè]|quando|quanto)\b/i.test(rawContent) ||
      /^(?:mostra|fammi\s+vedere|fai\s+vedere|voglio\s+vedere|elenca|leggimi|leggi|cancella|elimina|modifica|rimuovi)\b/i.test(rawContent);

    if (!isQuestionOrAction) {
      const explicitDate = parseExplicitCalendarDate(rawContent);
      const hasExplicitClockTime = /\b(?:alle|per\s+le|alle\s+ore|ore|h)\s*\d{1,2}(?::\d{2})?\b/i.test(rawContent);
      const hasExplicitRelativeDuration = /\b(?:tra|fra)\s+(?:\d+|mezz|un['’]?)\s*(?:ore?|ora|minut[oi]|giorn[oi])\b/i.test(rawContent);
      // Calendar parsers historically defaulted date-only requests to 09:00.
      // For reminders, that is an unsafe guess: the capability must ask the user.
      const dueAt = (explicitDate.found && !hasExplicitClockTime)
        ? undefined
        : explicitDate.found ? explicitDate.dueAt : (hasExplicitClockTime || hasExplicitRelativeDuration ? extractTargetDateTime(rawContent) : undefined);
      const shift = extractRelativeTimeShift(rawContent);

      // Remove leading date/time clauses before extracting the task. Natural Italian
      // commonly places the time between the date and the task connector:
      // "domani alle 15:00 di chiamare il dentista". Strip the whole scheduling
      // prefix first; otherwise the saved reminder text becomes "domani alle 15:00...".
      const dateWord = '(?:oggi|domani|dopodomani|stasera|questa\\s+sera|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)';
      const clockPhrase = '(?:\\s+(?:alle|per\\s+le|alle\\s+ore|ore|h)\\s*\\d{1,2}(?::\\d{2})?)?';
      const textWithoutTime = rawContent
        .replace(new RegExp('^' + dateWord + clockPhrase + '\\s+(?:di|che|per|a)\\s+', 'i'), '')
        .replace(new RegExp('^' + dateWord + clockPhrase + '\\s+', 'i'), '')
        // Strip complete trailing date/time clauses BEFORE removing clock phrases.
        // Removing "alle 20" first leaves trailing whitespace after "domani", which
        // made the end-anchored date regex miss and polluted the saved task text.
        .replace(/\s+(?:a|per)\s+(?:domani|dopodomani|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+(?:alle\s+ore|alle|per\s+le|ore|h)?\s*\d{1,2}(?::\d{2})?)?\s*$/i, '')
        .replace(/\s+(?:oggi|domani|dopodomani|stasera|questa\s+sera|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+(?:alle\s+ore|alle|per\s+le|ore|h)?\s*\d{1,2}(?::\d{2})?)?\s*$/i, '')
        .replace(/\s+(?:il\s+)?\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+\d{4})?(?:\s+(?:alle\s+ore|alle|per\s+le|ore|h)\s*\d{1,2}(?::\d{2})?)?\s*$/i, '')
        .replace(/\s+(?:il\s+)?\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s+(?:alle\s+ore|alle|per\s+le|ore|h)\s*\d{1,2}(?::\d{2})?)?\s*$/i, '')
        .replace(/\b(?:alle\s+ore|alle|per\s+le|ore|h)\s*\d{1,2}(?::\d{2})?\b/gi, ' ')
        .replace(/^(?:oggi|domani|dopodomani|stasera|questa\s+sera)\s+/i, '')
        .replace(/\s+(?:tra)\s+\d+\s+giorni\s*$/i, '')
        .replace(/\s+(?:alle|per\s+le|alle\s+ore)\s*\d{1,2}(?::\d{2})?\s*$/i, '')
        .replace(/\s+(?:di|tra)\s+(?:\d+|due|tre|quattro|cinque|sei|mezz['’]\s*ora|mezzora|un['’]\s*ora).*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        verb: 'CREATE',
        entity: 'REMINDER',
        target: { type: 'UNRESOLVED' },
        parameters: {
          text: textWithoutTime || rawContent,
          dueAt,
          timeShiftMinutes: shift,
          ...(explicitDate.found && !explicitDate.valid ? { invalidDate: true, invalidDateText: explicitDate.raw } : {}),
        },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // 5b. READ A SPECIFIC REMINDER: "Mostrami i dettagli del promemoria per comprare il pane".
  // Do this before the generic list handler so a detail request never falls back to listing everything.
  const reminderDetailMatch = stripped.match(
    /^(?:mostra(?:mi)?|fammi\s+vedere|visualizza(?:mi)?|dimmi)\s+(?:tutti\s+)?(?:i\s+)?dettagli\s+(?:del|dello|della)\s+(?:mio\s+)?(?:promemoria|reminder|memo)(?:\s+(?:per|di|che\s+devo)\s+(.+))?$/i
  );
  if (reminderDetailMatch) {
    const requestedTask = (reminderDetailMatch[1] || '').trim().replace(/[?!.]+$/, '').trim();
    return {
      verb: 'READ',
      entity: 'REMINDER',
      target: requestedTask
        ? { type: 'TEXT_MATCH', rawReference: requestedTask, matchedText: requestedTask }
        : { type: 'UNRESOLVED', rawReference: 'promemoria' },
      parameters: requestedTask ? { reminderQuery: requestedTask } : {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 5b. READ REMINDERS: "Mostrami i promemoria", "Fammi vedere i miei promemoria", "Fammi vedere il mio promemoria", "Voglio vedere i miei promemoria", "Che promemoria ho?"
  const isReminderInquiry =
    /\b(?:promemoria|reminder|memo)\b/i.test(stripped) &&
    (
      /^(?:qual\s+[eè]|qual\s+era|quali\s+sono|che|cosa|cos['’][eè]|dimmi)\b/i.test(lower) ||
      /^(?:mostra(?:mi)?|fammi\s+vedere|fai\s+vedere|voglio\s+vedere|vorrei\s+vedere|posso\s+vedere|fammi\s+leggere|leggi(?:mi)?|apri|visualizza(?:mi)?|elenca(?:mi)?|vedi)\b/i.test(lower) ||
      /^(?:i\s+miei\s+promemoria|il\s+mio\s+promemoria)$/i.test(lower)
    );

  const readReminderAction =
    /^(?:mostra(?:mi)?|fammi\s+vedere|fai\s+vedere|voglio\s+vedere|vorrei\s+vedere|posso\s+vedere|elenca(?:mi)?|leggimi|leggi|vedi|apri|quali\s+sono(?:\s+tutti)?(?:\s+i|\s+il)?|quali\s+promemoria\s+ho|che\s+promemoria\s+ho|quali\s+promemoria\s+ci\s+sono|che\s+promemoria\s+ci\s+sono)\s+(?:tutti\s+i\s+(?:miei\s+)?promemoria|i\s+(?:miei\s+)?promemoria|il\s+(?:mio\s+)?promemoria|promemoria|tutti\s+i\s+(?:miei\s+)?memo|i\s+(?:miei\s+)?memo|il\s+(?:mio\s+)?memo|memo|tutti\s+i\s+(?:miei\s+)?reminder|i\s+(?:miei\s+)?reminder|il\s+(?:mio\s+)?reminder|reminder)\b/i;

  const standaloneReadReminder =
    /^(?:che\s+promemoria\s+(?:ho|ci\s+sono)|quali\s+promemoria\s+(?:ho|ci\s+sono)|quali\s+sono\s+i\s+(?:miei\s+)?promemoria|i\s+miei\s+promemoria|il\s+mio\s+promemoria)\b/i;

  if (isReminderInquiry || readReminderAction.test(lower) || standaloneReadReminder.test(lower)) {
    const isModifiedRef =
      /\b(?:modificat[aoei]|aggiornat[aoei]|cambiat[aoei]|spostat[aoei]|posticipat[aoei]|che\s+ho\s+(?:modificato|aggiornato|cambiato|spostato|posticipato))\b/i.test(lower);
    const isLastOrRecent =
      /\b(?:l['’]ultimo|ultimo|recent[ei]|appena)\b/i.test(lower);

    if (isModifiedRef && (isLastOrRecent || /\b(?:quello|il)\s+(?:promemoria|memo|reminder)\b/i.test(lower))) {
      return {
        verb: 'READ',
        entity: 'REMINDER',
        target: {
          type: 'RELATIVE_TIME',
          rawReference: "l'ultimo promemoria che ho modificato",
          relativeAction: 'UPDATE',
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    const ordinal = extractOrdinal(lower);
    if (ordinal) {
      return {
        verb: 'READ',
        entity: 'REMINDER',
        target: {
          type: 'ORDINAL',
          ...ordinal,
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    if (/\b(?:quello|questo|quell['’])\s+(?:promemoria|memo|reminder)\b/i.test(lower)) {
      return {
        verb: 'READ',
        entity: 'REMINDER',
        target: {
          type: 'PRONOUN',
          rawReference: 'quello',
        },
        parameters: {},
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }

    const isSingular = /\b(?:il\s+(?:mio\s+)?promemoria|il\s+(?:mio\s+)?memo|il\s+(?:mio\s+)?reminder)\b/i.test(lower);
    return {
      verb: 'READ',
      entity: 'REMINDER',
      target: {
        type: isSingular ? 'UNRESOLVED' : 'ALL',
        rawReference: isSingular ? 'il mio promemoria' : 'i miei promemoria',
      },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 5c. CONTEXTUAL REMINDER READ: natural questions about a specific reminder.
  // Examples: "A che ora devo pagare la bolletta?" / "Quando devo comprare il pane?"
  // If the active context is a reminder collection, keep this local and let TargetResolver
  // match the task text instead of sending the question to the provider.
  if (
    (context?.activeCollectionType === 'REMINDER' || context?.activeEntity === 'REMINDER') &&
    /^(?:a\s+che\s+ora|quando)\s+(?:devo\s+)?(?:fare\s+)?(.+?)[?]?$/i.test(stripped)
  ) {
    const match = stripped.match(/^(?:a\s+che\s+ora|quando)\s+(?:devo\s+)?(?:fare\s+)?(.+?)[?]?$/i);
    const requestedTask = match?.[1]?.trim().replace(/[?!.]+$/, '').trim();
    if (requestedTask) {
      return {
        verb: 'READ',
        entity: 'REMINDER',
        target: { type: 'TEXT_MATCH', rawReference: requestedTask, matchedText: requestedTask },
        parameters: { reminderField: 'dueAt', reminderQuery: requestedTask },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // 5c. COMPLETE REMINDER: "Segna il promemoria come fatto", "Completa il promemoria"
  if (
    /^(?:segna\s+(?:il\s+)?promemoria\s+(?:come\s+)?(?:fatto|completato)|completa\s+(?:il\s+)?promemoria|promemoria\s+fatto)\b/i.test(lower)
  ) {
    return {
      verb: 'COMPLETE',
      entity: 'REMINDER',
      target: { type: 'UNRESOLVED' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 5d. UPDATE REMINDER: "Sposta il promemoria a domani", "Posticipa il promemoria di due ore", "Cambia il promemoria della macchina in...", "Cambia l'orario del promemoria alle 18", "Modifica quel promemoria"
  const updateReminderMatch = stripped.match(
    /^(?:(?:sposta|posticipa|rimanda|rinvia|cambia(?:\s+l['’]orario)?|modifica(?:\s+l['’]orario)?|ritarda|porta)\s+(?:(?:quel|quello|questo|il)\s+)?(?:prima\s+|seconda\s+|terza\s+|quarta\s+|quinta\s+|ultima\s+|primo\s+|secondo\s+|terzo\s+|quarto\s+|quinto\s+|ultimo\s+)?(?:promemoria|memo|reminder)\b\s*(.*)|(?:quel|quello|questo)\s+(?:promemoria|memo|reminder)\s+(?:modificalo|cambialo|spostalo|aggiornalo)\b.*)$/i
  );
  if (updateReminderMatch) {
    const { target, parameters } = parseUpdateCommand(stripped);
    return {
      verb: 'UPDATE',
      entity: 'REMINDER',
      target,
      parameters,
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 5e. DELETE REMINDERS: "Cancella tutti i promemoria", "Cancella tutti i reminder", "Cancella il promemoria"
  const isDeleteAllReminders =
    /^(?:cancella|eliminami|elimina|rimuovimi|rimuovi|svuota)\s+(?:tutti\s+i\s+promemoria|tutti\s+i\s+reminder|ogni\s+promemoria|tutti)$/i.test(stripped);
  if (isDeleteAllReminders) {
    return {
      verb: 'DELETE',
      entity: 'REMINDER',
      target: { type: 'ALL', rawReference: 'tutti i promemoria' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  const deleteReminderMatch = stripped.match(
    /^(?:cancella|eliminami|elimina|rimuovimi|rimuovi)\s+(?:tutti\s+i\s+promemoria|i\s+promemoria|il\s+promemoria|promemoria)\b\s*(.*)$/i
  );
  if (deleteReminderMatch) {
    const rawTarget = deleteReminderMatch[1]?.trim() || '';
    const isAll = /^(?:cancella|eliminami|elimina|rimuovimi|rimuovi|svuota)\s+(?:tutti\s+i\s+promemoria|tutti\s+i\s+reminder|ogni\s+promemoria|tutti)$/i.test(stripped);
    const ordinal = extractOrdinal(rawTarget);
    return {
      verb: 'DELETE',
      entity: 'REMINDER',
      target: isAll && !rawTarget
        ? { type: 'ALL', rawReference: 'tutti i promemoria' }
        : ordinal
        ? { type: 'ORDINAL', ...ordinal }
        : rawTarget
        ? { type: 'TEXT_MATCH', rawReference: rawTarget }
        : { type: 'UNRESOLVED' },
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // ==========================================================================
  // 6. CONTEXTUAL / ANAPHORIC / INCOMPLETE LOCAL ACTIONS
  // ==========================================================================

  // Determine active entity from context if available
  const contextEntity: SemanticEntity =
    context?.activeCollectionType || context?.activeEntity || 'UNKNOWN';

  // 6a. Standalone "CANCELLA TUTTO" / "ELIMINA TUTTO"
  if (/^(?:cancella|elimina|rimuovi|svuota)\s+tutto\b/i.test(lower)) {
    return {
      verb: 'DELETE',
      entity: contextEntity !== 'UNKNOWN' ? contextEntity : 'UNKNOWN',
      target: { type: 'ALL', rawReference: 'tutto' },
      parameters: {},
      confidence: contextEntity !== 'UNKNOWN' ? 'MEDIUM' : 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 6b. Contextual COMPLETE: "Segna il primo come fatto", "Completa quello", "Ho finito il primo"
  if (
    /^(?:segna\s+come\s+fatto|segna\s+fatto|completa|fatto|ho\s+finito|spunta)\b/i.test(lower) ||
    /\b(?:come\s+fatto|fatto)$/i.test(lower)
  ) {
    const ordinal = extractOrdinal(lower);
    const pronounMatch = lower.match(/\b(quello|quella|questo|questa|completalo|completala|segnalo)\b/i);
    const target: TargetDescriptor = ordinal
      ? { type: 'ORDINAL', ...ordinal }
      : pronounMatch
      ? { type: 'PRONOUN', rawReference: pronounMatch[0] }
      : { type: 'UNRESOLVED' };

    return {
      verb: 'COMPLETE',
      entity: contextEntity !== 'UNKNOWN' ? contextEntity : 'REMINDER',
      target,
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 6c. Contextual READ: allow natural follow-ups such as "mostra quello",
  // "fammi vedere questa", "apri la seconda" or "leggimi il primo".
  // These are intentionally resolved against SessionContext/TargetResolver rather
  // than requiring the user to repeat "nota" or "promemoria".
  if (
    /^(?:mostra(?:mi)?|fammi\s+vedere|fammi\s+leggere|fai\s+vedere|leggi(?:mi)?|apri|vedi|visualizza(?:mi)?)\b/i.test(lower) &&
    (extractOrdinal(lower) !== null || /\b(?:quello|quella|questo|questa|quel|spostalo|spostala|mettilo|mettila)\b/i.test(lower))
  ) {
    const ordinal = extractOrdinal(lower);
    const pronounMatch = lower.match(/\b(quello|quella|questo|questa|quel|spostalo|spostala|mettilo|mettila)\b/i);
    const entity: SemanticEntity =
      /\b(?:promemoria|memo|reminder)\b/i.test(stripped)
        ? 'REMINDER'
        : /\b(?:nota|note)\b/i.test(stripped)
        ? 'NOTE'
        : contextEntity !== 'UNKNOWN'
        ? contextEntity
        : 'UNKNOWN';

    return {
      verb: 'READ',
      entity,
      target: ordinal
        ? { type: 'ORDINAL', ...ordinal }
        : { type: 'PRONOUN', rawReference: pronounMatch?.[0] || 'quello' },
      parameters: {},
      confidence: entity !== 'UNKNOWN' ? 'HIGH' : 'MEDIUM',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 6c. Natural append/update: "Aggiungi alla nota ...", "Aggiungi al promemoria ...".
  // This expresses the same semantic operation as UPDATE + APPEND without
  // requiring the user to repeat the item's title or exact command template.
  // Explicit append with payload first: "Aggiungi il pane alla nota Spesa2".
  const explicitAppendTargetMatch = stripped.match(/^(?:aggiungi|inserisci|metti)\s+(?:anche\s+)?(?:alla|nella)\s+(nota|promemoria)\s+["'`«»]?([^"'`«»]+?)["'`«»]?\s+(.+)$/i);
  if (explicitAppendTargetMatch) {
    const entity: SemanticEntity = explicitAppendTargetMatch[1].toLowerCase() === 'nota' ? 'NOTE' : 'REMINDER';
    return {
      verb: 'UPDATE',
      entity,
      target: { type: 'TEXT_MATCH', rawReference: explicitAppendTargetMatch[2].trim() },
      parameters: { newText: explicitAppendTargetMatch[3].trim(), updateMode: 'APPEND' },
      confidence: 'HIGH', rawQuery: clean, isLocalActionCandidate: true,
    };
  }

  const explicitAppendMatch = stripped.match(
    /^(?:aggiungi|inserisci|metti)\s+(?:anche\s+)?[\"'`«»]?(.+?)[\"'`«»]?\s+(?:alla|nella|al|nel)\s+(nota|promemoria)\s+[\"'`«»]?(.+?)[\"'`«»]?$/i
  );
  if (explicitAppendMatch) {
    const entity: SemanticEntity = explicitAppendMatch[2].toLowerCase() === 'nota' ? 'NOTE' : 'REMINDER';
    return {
      verb: 'UPDATE',
      entity,
      target: { type: 'TEXT_MATCH', rawReference: explicitAppendMatch[3].trim() },
      parameters: { newText: explicitAppendMatch[1].trim(), updateMode: 'APPEND' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // Contextual append: "Aggiungi anche il pane" after a note/reminder is active.
  if (contextEntity === 'NOTE' || contextEntity === 'REMINDER') {
    const contextualAppend = stripped.match(/^(?:aggiungi|inserisci|metti)\s+(?:anche\s+)?(.+)$/i);
    if (contextualAppend && !/\b(?:alla|nella|al|nel)\s+(?:nota|promemoria)\b/i.test(contextualAppend[1])) {
      return {
        verb: 'UPDATE',
        entity: contextEntity,
        target: { type: 'PRONOUN', rawReference: 'quello' },
        parameters: { newText: contextualAppend[1].trim(), updateMode: 'APPEND' },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  const appendMatch = lower.match(
    /^(?:aggiungi|inserisci|metti)\s+(?:anche\s+)?(?:alla|nella|al|nel)\s+(nota|promemoria)\b\s*(.+)$/i
  );
  if (appendMatch) {
    const entity: SemanticEntity = appendMatch[1].toLowerCase() === 'nota' ? 'NOTE' : 'REMINDER';
    const newText = appendMatch[2].trim().replace(/^[:\s\-–—]+/, '').trim();
    return {
      verb: 'UPDATE',
      entity,
      target: { type: 'PRONOUN', rawReference: appendMatch[0].match(/\b(?:alla|nella|al|nel)\s+(?:nota|promemoria)\b/i)?.[0] || 'quello' },
      parameters: { newText, updateMode: 'APPEND' },
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 6c. Contextual UPDATE: "Sposta il primo a domani alle 15", "Posticipa di due ore", "Cambia l'orario del primo promemoria alle 18", "Sposta quello di domani a venerdì alle 10"
  if (
    /^(?:sposta(?:mi)?|posticipa|rimanda|rinvia|cambia(?:\s+l['’]orario)?|modifica(?:\s+l['’]orario)?|ritarda|spostalo|spostala|rimandalo|rimandala|posticipalo|posticipala)\b/i.test(lower) ||
    /^(?:anzi[,\s]+)?(?:mettilo|metti|spostalo|spostala)\s+alle\b/i.test(lower)
  ) {
    const { target, parameters } = parseUpdateCommand(stripped);
    const entity: SemanticEntity =
      /\b(?:promemoria|memo|reminder)\b/i.test(stripped)
        ? 'REMINDER'
        : /\b(?:nota|note)\b/i.test(stripped)
        ? 'NOTE'
        : parameters.dueAt || parameters.timeShiftMinutes !== undefined
        ? 'REMINDER'
        : contextEntity !== 'UNKNOWN'
        ? contextEntity
        : 'REMINDER';

    return {
      verb: 'UPDATE',
      entity,
      target,
      parameters,
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // 6d. Contextual DELETE: "Cancella il primo", "Cancella quello della macchina", "Cancellalo", "Eliminalo"
  if (
    /^(?:cancella|eliminami|elimina|rimuovimi|rimuovi|cancellalo|cancellala|eliminalo|eliminala)\b/i.test(lower)
  ) {
    const ordinal = extractOrdinal(lower);
    const pronounMatch = lower.match(/\b(quello|quella|questo|questa|cancellalo|cancellala|eliminalo|eliminala)\b/i);
    const textMatch = lower.match(
      /\b(?:quello|quella|questo|questa)\s+(?:del|dello|della|dei|degli|delle|di|sul|sulla|sullo|sui|sugli|sulle|su)\s+([a-zà-ÿ0-9\s]+?)$/i
    );

    let target: TargetDescriptor = { type: 'UNRESOLVED' };
    if (ordinal) {
      target = { type: 'ORDINAL', ...ordinal };
    } else if (textMatch) {
      target = { type: 'TEXT_MATCH', rawReference: textMatch[0].trim(), matchedText: textMatch[1].trim() };
    } else if (pronounMatch) {
      target = { type: 'PRONOUN', rawReference: pronounMatch[0] };
    }

    return {
      verb: 'DELETE',
      entity: contextEntity !== 'UNKNOWN' ? contextEntity : 'UNKNOWN',
      target,
      parameters: {},
      confidence: 'HIGH',
      rawQuery: clean,
      isLocalActionCandidate: true,
    };
  }

  // ==========================================================================
  // 7. COGNITIVE / GEMINI FALLBACK (Default for general questions)
  // ==========================================================================
  return {
    verb: 'EXPLAIN',
    entity: 'UNKNOWN',
    target: { type: 'UNRESOLVED' },
    parameters: {},
    confidence: 'HIGH',
    rawQuery: clean,
    isLocalActionCandidate: false,
  };
}


export function classifyIntent(
  query: string,
  context?: SessionContext,
  isSubQuery: boolean = false
): SemanticIntent {
  const clean = cleanQuery(query);

  // Self-correction must be resolved on the original utterance, before
  // multilingual normalization can change its clause boundaries.
  if (!isSubQuery) {
    const correction = resolveSelfCorrection(clean);
    if (correction) {
      const correctedIntent = classifyIntent(correction.suffix, context, true);
      return { ...correctedIntent, rawQuery: clean };
    }
  }

  const normalized = normalizeMultilingualLocalIntent(query, context);
  // Pass the original query: classifyIntentInternal performs its own
  // normalization after its correction handling, preserving the original text.
  const intent = classifyIntentInternal(query, context, isSubQuery);
  if (normalized.negated) intent.parameters.negated = true;
  return intent;
}
