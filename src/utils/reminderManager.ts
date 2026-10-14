import { MaiaReminder } from '../types';

export const REMINDERS_STORAGE_KEY = 'maia_reminders_v1';

const ITALIAN_STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
  'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
  'che', 'devo', 'deve', 'dobbiamo', 'ho', 'ha', 'abbiamo',
  'del', 'dello', 'della', 'dei', 'degli', 'delle',
  'al', 'allo', 'alla', 'ai', 'agli', 'alle',
  'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
  'nel', 'nello', 'nella', 'nei', 'negli', 'nelle',
  'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
  'promemoria', 'reminder', 'relativo', 'relativa',
]);

/**
 * Loads reminders safely from localStorage.
 */
export function loadReminders(): MaiaReminder[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(REMINDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter(
        (r) =>
          r &&
          typeof r.id === 'string' &&
          typeof r.text === 'string' &&
          r.text.trim().length > 0 &&
          typeof r.dueAt === 'string' &&
          !Number.isNaN(new Date(r.dueAt).getTime())
      )
      .map((r) => ({
        ...r,
        text: r.text.trim(),
        completed: Boolean(r.completed),
        notified: Boolean(r.notified),
      }))
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
  } catch (err) {
    console.error('[MAIA Reminders] Error loading reminders:', err);
    return [];
  }
}

/**
 * Saves reminders safely to localStorage.
 */
export function saveReminders(reminders: MaiaReminder[]): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  try {
    localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
    return true;
  } catch (err) {
    console.error('[MAIA Reminders] Error saving reminders:', err);
    return false;
  }
}

/**
 * Creates and persists a new reminder.
 */
export function createReminder(
  text: string,
  dueAt: Date | string,
  originalInput?: string
): { success: boolean; reminder?: MaiaReminder; error?: string; duplicate?: boolean } {
  const cleanText = text.trim();
  if (!cleanText) {
    return { success: false, error: 'Il testo del promemoria non può essere vuoto.' };
  }

  const dueDate = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (isNaN(dueDate.getTime())) {
    return { success: false, error: 'Data e ora del promemoria non valide.' };
  }

  // A reminder that is already in the past is almost always an extraction bug.
  // Refuse it here as a final safety net even if the parser was bypassed.
  if (dueDate.getTime() <= Date.now()) {
    return { success: false, error: "L'orario del promemoria è già passato. Specifica un momento futuro." };
  }

  const current = loadReminders();
  const normalizedText = cleanText.toLocaleLowerCase().replace(/\s+/g, ' ');
  const duplicate = current.find((r) =>
    !r.completed &&
    r.text.toLocaleLowerCase().replace(/\s+/g, ' ') === normalizedText &&
    new Date(r.dueAt).getTime() === dueDate.getTime()
  );
  if (duplicate) {
    return { success: true, reminder: duplicate, duplicate: true };
  }

  const newReminder: MaiaReminder = {
    id: `rem-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    text: cleanText,
    dueAt: dueDate.toISOString(),
    createdAt: new Date().toISOString(),
    completed: false,
    notified: false,
    originalInput,
  };

  const updated = [...current, newReminder];
  const saved = saveReminders(updated);
  if (!saved) {
    return { success: false, error: 'Errore nel salvataggio del promemoria in memoria locale.' };
  }

  return { success: true, reminder: newReminder };
}

/**
 * Deletes a reminder by ID.
 */
export function deleteReminder(id: string): boolean {
  const current = loadReminders();
  const filtered = current.filter((r) => r.id !== id);
  if (filtered.length === current.length) return false;
  return saveReminders(filtered);
}

/**
 * Marks a reminder as completed (or incomplete).
 */
export function completeReminder(id: string, completed = true): boolean {
  const current = loadReminders();
  let found = false;
  const updated = current.map((r) => {
    if (r.id === id) {
      found = true;
      return { ...r, completed };
    }
    return r;
  });
  if (!found) return false;
  return saveReminders(updated);
}

/**
 * Checks for due reminders (pending, not yet notified, dueAt <= now).
 */
export function checkDueReminders(): MaiaReminder[] {
  const current = loadReminders();
  const now = Date.now();
  return current.filter((r) => !r.completed && !r.notified && new Date(r.dueAt).getTime() <= now);
}

/**
 * Marks a reminder as notified so it does not trigger duplicate notifications.
 */
export function markAsNotified(id: string): boolean {
  const current = loadReminders();
  const updated = current.map((r) => {
    if (r.id === id) {
      return { ...r, notified: true };
    }
    return r;
  });
  return saveReminders(updated);
}

/**
 * Formats a reminder due date in friendly Italian, device-local time.
 */
export function formatFriendlyDueTime(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear();

  const timeStr = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `oggi alle ${timeStr}`;
  }
  if (isTomorrow) {
    return `domani alle ${timeStr}`;
  }

  const dateStr = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  return `${dateStr} alle ${timeStr}`;
}

/**
 * Extracts searchable keywords from target string.
 */
function extractKeywords(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[^\wÀ-ÿ\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !ITALIAN_STOPWORDS.has(w));
}

/**
 * Finds candidate reminder matches for deletion or completion with strict precision.
 */
export function findMatchingReminders(
  targetQuery: string,
  reminders: MaiaReminder[]
): { exactMatch: MaiaReminder | null; candidates: MaiaReminder[]; outOfBounds?: boolean } {
  const cleanTarget = targetQuery
    .toLowerCase()
    .trim()
    .replace(/^[:\s\-–—\"\'\`«»]+|[:\s\-–—\"\'\`«»]+$/g, '')
    .trim();

  if (!cleanTarget || reminders.length === 0) {
    return { exactMatch: null, candidates: [] };
  }

  // 1. Positional ordinals: primo, secondo, ..., ultimo
  const posRegex = /^(?:(?:il|l['’])\s+)?(primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|ultimo)(?:\s+promemoria)?$/i;
  const posM = cleanTarget.match(posRegex);
  if (posM) {
    const word = posM[1].toLowerCase();
    const ordinals: Record<string, number> = {
      primo: 0,
      secondo: 1,
      terzo: 2,
      quarto: 3,
      quinto: 4,
      sesto: 5,
      settimo: 6,
      ottavo: 7,
      nono: 8,
      decimo: 9,
    };
    let idx = ordinals[word];
    if (word === 'ultimo') idx = reminders.length - 1;
    if (idx !== undefined) {
      if (idx >= 0 && idx < reminders.length) {
        return { exactMatch: reminders[idx], candidates: [reminders[idx]] };
      }
      return { exactMatch: null, candidates: [], outOfBounds: true };
    }
  }

  // 2. Numeric index: promemoria 1, numero 1, #1, 1
  const numRegex = /^(?:(?:il\s+)?promemoria\s+(?:numero\s+)?|(?:il\s+)?numero\s+|#\s*)?([0-9]+)(?:\s+promemoria)?$/i;
  const numM = cleanTarget.match(numRegex);
  if (numM) {
    const idx = parseInt(numM[1], 10) - 1;
    if (idx >= 0 && idx < reminders.length) {
      return { exactMatch: reminders[idx], candidates: [reminders[idx]] };
    }
    return { exactMatch: null, candidates: [], outOfBounds: true };
  }

  // 3. Exact full text match (case-insensitive)
  const exact = reminders.find((r) => r.text.toLowerCase().trim() === cleanTarget);
  if (exact) {
    return { exactMatch: exact, candidates: [exact] };
  }

  // 4. Substring containment
  const subMatches = reminders.filter((r) => r.text.toLowerCase().includes(cleanTarget));
  if (subMatches.length === 1) {
    return { exactMatch: subMatches[0], candidates: subMatches };
  }
  if (subMatches.length > 1) {
    return { exactMatch: null, candidates: subMatches };
  }

  // 5. Keyword token matching (ALL target keywords must be present)
  const targetKws = extractKeywords(cleanTarget);
  if (targetKws.length === 0) {
    return { exactMatch: null, candidates: [] };
  }

  const matchedCandidates: Array<{ reminder: MaiaReminder; score: number }> = [];

  for (const r of reminders) {
    const textLower = r.text.toLowerCase();
    let kwHits = 0;
    for (const kw of targetKws) {
      if (textLower.includes(kw)) {
        kwHits++;
      }
    }
    if (kwHits === targetKws.length) {
      matchedCandidates.push({ reminder: r, score: kwHits });
    }
  }

  if (matchedCandidates.length === 1) {
    return { exactMatch: matchedCandidates[0].reminder, candidates: [matchedCandidates[0].reminder] };
  }
  if (matchedCandidates.length > 1) {
    return { exactMatch: null, candidates: matchedCandidates.map((c) => c.reminder) };
  }

  return { exactMatch: null, candidates: [] };
}

function isValidCalendarDate(year: number, month: number, day: number, hour: number, minute: number): boolean {
  if (![year, month, day, hour, minute].every(Number.isFinite)) return false;
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  const d = new Date(year, month, day, hour, minute, 0, 0);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day && d.getHours() === hour && d.getMinutes() === minute;
}

export interface ParseReminderResult {
  dueAt?: Date;
  reminderText?: string;
  isReminderIntent: boolean;
  ambiguous?: boolean;
  clarification?: string;
  isPast?: boolean;
}

/**
 * Parses Italian natural language input for reminder creation.
 */
export function parseItalianReminder(query: string, now: Date = new Date()): ParseReminderResult {
  const clean = query.trim().replace(/[.?!;:]+$/, '').trim();

  // Creation intent prefix regex
  const intentRegex = /^(?:(?:senti(?:\s+un\s+po['’])?|ascolta(?:mi)?|ok(?:ay)?|va\s+bene|d['’]accordo|allora|no[,\s]+aspetta|aspetta|maia|per\s+favore|per\s+cortesia|puoi\s+(?:per\s+favore\s+)?|potresti\s+(?:per\s+favore\s+)?)[,\s:]+)*(?:ricordami|ricordati|ricorda a me|metti\s+(?:un\s+)?promemoria|imposta\s+(?:un\s+)?promemoria|crea\s+(?:un\s+)?promemoria|aggiungi\s+(?:un\s+)?promemoria|nuovo\s+promemoria|promemoria)\b/i;

  if (!intentRegex.test(clean)) {
    return { isReminderIntent: false };
  }

  let stripped = clean.replace(intentRegex, '').trim();
  stripped = stripped.replace(/^[:\s\-–—]+/, '').trim();

  // Generic ambiguous time markers without exact hours: e.g. "stasera", "oggi pomeriggio", "dopo"
  const ambiguousTimeRegex = /\b(stasera|questa\s+sera|questo\s+pomeriggio|oggi\s+pomeriggio|stamattina|domani\s+mattina|domani\s+sera|in\s+serata|più\s+tardi|dopo)\b/i;
  const dateOnlyRegex = /\b(?:oggi|domani|dopodomani|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica|il\s+\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/i;
  const hasExactHour = /\b(?:alle|per\s+le|ore|h)\s*\d{1,2}(?::\d{2})?\b/i;
  const hasRelative = /\b(?:tra|fra)\s+(?:\d+|mezz|un['’])/i;

  // A date is not a time. Never let the legacy date parser's 09:00 default
  // turn a date-only reminder into a scheduled reminder without confirmation.
  if ((ambiguousTimeRegex.test(stripped) || dateOnlyRegex.test(stripped)) && !hasExactHour.test(stripped) && !hasRelative.test(stripped)) {
    return {
      isReminderIntent: true,
      ambiguous: true,
      clarification: "A che ora vorresti che te lo ricordi? Specifica un orario esatto (ad esempio: 'alle 20:00' o 'tra mezz'ora').",
    };
  }

  let dueAt: Date | undefined;
  let timeStrMatched = '';

  // Validate explicit calendar dates before generic time patterns such as
  // "alle 10" can consume the time and bypass the date-validation branch.
  const explicitCalendarDate = stripped.match(
    /\bil\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\s+(?:alle|per\s+le)\s+(\d{1,2})(?::(\d{2}))?\b/i,
  );
  if (explicitCalendarDate) {
    const day = Number(explicitCalendarDate[1]);
    const monthNames = [
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
    ];
    const month = monthNames.indexOf(explicitCalendarDate[2].toLowerCase());
    const year = explicitCalendarDate[3] ? Number(explicitCalendarDate[3]) : now.getFullYear();
    const hour = Number(explicitCalendarDate[4]);
    const minute = explicitCalendarDate[5] ? Number(explicitCalendarDate[5]) : 0;
    if (!isValidCalendarDate(year, month, day, hour, minute)) {
      return {
        isReminderIntent: true,
        ambiguous: true,
        clarification: "La data o l'orario indicato non è valido. Controlla giorno, mese e ora e riprova.",
      };
    }
    dueAt = new Date(year, month, day, hour, minute, 0, 0);
    if (dueAt.getTime() <= now.getTime() && !explicitCalendarDate[3]) {
      dueAt.setFullYear(year + 1);
    }
    timeStrMatched = explicitCalendarDate[0];
  }

  // 1. Relative times
  // 1a. "tra mezz'ora" / "tra mezzora"
  const mezzoraM = stripped.match(/\b(?:tra|fra)\s+(?:mezz['’]\s*ora|mezzora)\b/i);
  if (mezzoraM) {
    dueAt = new Date(now.getTime() + 30 * 60 * 1000);
    timeStrMatched = mezzoraM[0];
  }

  // 1b. "tra un'ora e mezza"
  if (!dueAt) {
    const unOraEMezzaM = stripped.match(/\b(?:tra|fra)\s+un['’]\s*ora\s+e\s+(?:mezza|mezz['’]\s*ora|mezzora)\b/i);
    if (unOraEMezzaM) {
      dueAt = new Date(now.getTime() + 90 * 60 * 1000);
      timeStrMatched = unOraEMezzaM[0];
    }
  }

  // 1c. "tra un'ora"
  if (!dueAt) {
    const unOraM = stripped.match(/\b(?:tra|fra)\s+un['’]\s*ora\b/i);
    if (unOraM) {
      dueAt = new Date(now.getTime() + 60 * 60 * 1000);
      timeStrMatched = unOraM[0];
    }
  }

  // 1d. "tra X ore e Y minuti"
  if (!dueAt) {
    const oreMinM = stripped.match(/\b(?:tra|fra)\s+(\d+)\s*(?:ore|ora|h)\s+e\s+(\d+)\s*(?:minuti|minuto|min)\b/i);
    if (oreMinM) {
      const h = parseInt(oreMinM[1], 10);
      const m = parseInt(oreMinM[2], 10);
      dueAt = new Date(now.getTime() + (h * 60 + m) * 60 * 1000);
      timeStrMatched = oreMinM[0];
    }
  }

  // 1e. "tra X minuti"
  if (!dueAt) {
    const minM = stripped.match(/\b(?:tra|fra)\s+(\d+)\s*(?:minuti|minuto|min)\b/i);
    if (minM) {
      const m = parseInt(minM[1], 10);
      dueAt = new Date(now.getTime() + m * 60 * 1000);
      timeStrMatched = minM[0];
    }
  }

  // 1f. "tra X ore"
  if (!dueAt) {
    const oreM = stripped.match(/\b(?:tra|fra)\s+(\d+)\s*(?:ore|ora|h)\b/i);
    if (oreM) {
      const h = parseInt(oreM[1], 10);
      dueAt = new Date(now.getTime() + h * 60 * 60 * 1000);
      timeStrMatched = oreM[0];
    }
  }

  // 1g. "tra/fra X giorni"
  if (!dueAt) {
    const giorniM = stripped.match(/\b(?:tra|fra)\s+(\d+)\s+giorn[oi]\b/i);
    if (giorniM) {
      const days = parseInt(giorniM[1], 10);
      if (days > 0) {
        dueAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        timeStrMatched = giorniM[0];
      }
    }
  }

  // 2. Calendar times
  // 2a. "domani alle HH(:MM)?" or "domani per le HH(:MM)?"
  if (!dueAt) {
    const domaniAlleM = stripped.match(/\bdomani\s+(?:alle|per\s+le)\s+(\d{1,2})(?::(\d{2}))?\b/i);
    if (domaniAlleM) {
      const h = parseInt(domaniAlleM[1], 10);
      const m = domaniAlleM[2] ? parseInt(domaniAlleM[2], 10) : 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m, 0, 0);
        timeStrMatched = domaniAlleM[0];
      }
    }
  }

  // 2b. "oggi alle HH(:MM)?"
  if (!dueAt) {
    const oggiAlleM = stripped.match(/\boggi\s+(?:alle|per\s+le)\s+(\d{1,2})(?::(\d{2}))?\b/i);
    if (oggiAlleM) {
      const h = parseInt(oggiAlleM[1], 10);
      const m = oggiAlleM[2] ? parseInt(oggiAlleM[2], 10) : 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
        if (d.getTime() <= now.getTime()) {
          const hStr = h.toString().padStart(2, '0');
          const mStr = m.toString().padStart(2, '0');
          return {
            isReminderIntent: true,
            isPast: true,
            clarification: `L'orario indicato (${hStr}:${mStr}) è già passato per oggi. Intendevi impostarlo per domani alle ${hStr}:${mStr}?`,
          };
        }
        dueAt = d;
        timeStrMatched = oggiAlleM[0];
      }
    }
  }

  // 2c. "per le HH(:MM)?" or "alle HH(:MM)?"
  if (!dueAt) {
    const alleM = stripped.match(/\b(?:alle|per\s+le)\s+(\d{1,2})(?::(\d{2}))?\b/i);
    if (alleM) {
      const h = parseInt(alleM[1], 10);
      const m = alleM[2] ? parseInt(alleM[2], 10) : 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
        if (d.getTime() <= now.getTime()) {
          const hStr = h.toString().padStart(2, '0');
          const mStr = m.toString().padStart(2, '0');
          return {
            isReminderIntent: true,
            isPast: true,
            clarification: `L'orario specificato (${hStr}:${mStr}) è già trascorso oggi. Intendevi programmarlo per domani alle ${hStr}:${mStr}?`,
          };
        }
        dueAt = d;
        timeStrMatched = alleM[0];
      }
    }
  }

  // 2d. "il DD mese (YYYY)? alle HH(:MM)?"
  if (!dueAt) {
    const dateM = stripped.match(/\bil\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\s+(?:alle|per\s+le)\s+(\d{1,2})(?::(\d{2}))?\b/i);
    if (dateM) {
      const day = parseInt(dateM[1], 10);
      const monthNames = [
        'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
        'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
      ];
      const month = monthNames.indexOf(dateM[2].toLowerCase());
      const year = dateM[3] ? parseInt(dateM[3], 10) : now.getFullYear();
      const h = parseInt(dateM[4], 10);
      const m = dateM[5] ? parseInt(dateM[5], 10) : 0;

      if (!isValidCalendarDate(year, month, day, h, m)) {
        return {
          isReminderIntent: true,
          ambiguous: true,
          clarification: "La data o l'orario indicato non è valido. Controlla giorno, mese e ora e riprova.",
        };
      }
      const d = new Date(year, month, day, h, m, 0, 0);
      if (d.getTime() <= now.getTime() && !dateM[3]) {
        d.setFullYear(year + 1);
      }
      dueAt = d;
      timeStrMatched = dateM[0];
    }
  }

  if (!dueAt) {
    return {
      isReminderIntent: true,
      ambiguous: true,
      clarification: "A che ora vorresti che te lo ricordi? Specifica quando deve suonare il promemoria (es. 'tra 10 minuti', 'domani alle 18:00', 'alle 15:30').",
    };
  }

  // Extract reminder content text
  let content = stripped.replace(timeStrMatched, ' ').trim();
  content = content
    .replace(/^[:\s\-–—]*(?:\bdi\b|\bche\b|\bper\b|\ba\b)?[:\s\-–—]*/i, '')
    .replace(/[:\s\-–—]*(?:\bdi\b|\bche\b|\bper\b|\ba\b)?[:\s\-–—]*$/i, '')
    .trim();

  if (!content) {
    content = 'Promemoria';
  }

  return {
    isReminderIntent: true,
    dueAt,
    reminderText: content,
  };
}

export interface ReminderCommandResult {
  isReminderCommand: boolean;
  action?: 'create' | 'list' | 'delete' | 'complete';
  reminder?: MaiaReminder;
  reminders?: MaiaReminder[];
  reply?: string;
  success?: boolean;
}

/**
 * Main entry point for deterministic reminder intent recognition and execution.
 */
export function handleReminderCommand(query: string): ReminderCommandResult {
  const clean = query.trim().replace(/[.?!;:]+$/, '').trim();

  // ==========================================
  // 1. LIST COMMANDS
  // ==========================================
  // "Cosa ho nei promemoria?", "Quali promemoria ho?", "Mostrami i promemoria",
  // "Che promemoria ho?", "Cosa devo ricordare?", "Lista promemoria"
  const listPattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cosa\s+ho\s+nei\s+promemoria|quali\s+promemoria\s+ho|mostrami\s+i\s+promemoria|mostra\s+i\s+promemoria|che\s+promemoria\s+ho|cosa\s+devo\s+ricordare|lista\s+promemoria|elenco\s+promemoria|leggi\s+i\s+promemoria|ho\s+promemoria|i\s+miei\s+promemoria|quali\s+sono\s+i\s+miei\s+promemoria)$/i;

  if (listPattern.test(clean)) {
    const all = loadReminders();
    const active = all.filter((r) => !r.completed);

    if (active.length === 0) {
      return {
        isReminderCommand: true,
        action: 'list',
        reminders: all,
        reply: 'Non hai nessun promemoria attivo al momento.',
        success: true,
      };
    }

    const formattedList = active
      .map((r, i) => `${i + 1}. "${r.text}" (${formatFriendlyDueTime(r.dueAt)})`)
      .join('\n');

    return {
      isReminderCommand: true,
      action: 'list',
      reminders: all,
      reply: `Ecco i tuoi promemoria attivi:\n${formattedList}`,
      success: true,
    };
  }

  // ==========================================
  // 2. DELETE ALL REMINDERS
  // ==========================================
  // "Cancella tutti i promemoria", "Elimina tutti i promemoria", "Svuota i promemoria"
  const deleteAllPattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancella|eliminare|elimina|rimuovere|rimuovi|svuotare|svuota)\s+(?:per favore\s+)?(?:tutti\s+i\s+promemoria|i\s+promemoria|ogni\s+promemoria)$/i;

  if (deleteAllPattern.test(clean)) {
    const reminders = loadReminders();
    if (reminders.length === 0) {
      return {
        isReminderCommand: true,
        action: 'delete',
        reminders: [],
        reply: 'Non hai nessun promemoria salvato da cancellare.',
        success: true,
      };
    }

    const saved = saveReminders([]);
    if (!saved) {
      return {
        isReminderCommand: true,
        action: 'delete',
        reply: 'Si è verificato un errore durante l\'eliminazione dei promemoria in memoria locale.',
        success: false,
      };
    }

    return {
      isReminderCommand: true,
      action: 'delete',
      reminders: [],
      reply: 'Ho eliminato tutti i promemoria.',
      success: true,
    };
  }

  // ==========================================
  // 3. DELETE SPECIFIC / POSITIONAL REMINDER
  // ==========================================
  // "Cancella il promemoria sul latte", "Elimina il primo promemoria", "Cancella il promemoria 1"
  const deletePattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancellami|cancella|eliminare|eliminami|elimina|rimuovere|rimuovimi|rimuovi)\s+(?:per favore\s+)?(?:(?:il|i)\s+|l['’])?(?:(primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|ultimo)\s+)?(?:promemoria|reminder)\s*(?:sullo|sulla|sulle|sugli|sui|sul|su|dello|della|delle|degli|dei|del|di|che|intitolato|relativo a|relativo al|:)?\s*(.*)$/i;
  const deleteMatch = clean.match(deletePattern);

  if (deleteMatch) {
    const posWord = deleteMatch[1]?.trim();
    const restTarget = deleteMatch[2]?.trim().replace(/^[:\s\-–—\"\'\`«»]+|[:\s\-–—\"\'\`«»]+$/g, '');
    const target = posWord || restTarget;

    const reminders = loadReminders();

    if (reminders.length === 0) {
      return {
        isReminderCommand: true,
        action: 'delete',
        reply: 'Non hai nessun promemoria salvato da cancellare.',
        success: false,
      };
    }

    if (!target) {
      return {
        isReminderCommand: true,
        action: 'delete',
        reply: 'Quale promemoria vorresti cancellare?',
        success: false,
      };
    }

    const { exactMatch, candidates, outOfBounds } = findMatchingReminders(target, reminders);

    if (outOfBounds) {
      return {
        isReminderCommand: true,
        action: 'delete',
        reply: `Non ho trovato nessun promemoria corrispondente a "${target}". Non è stato eliminato nulla.`,
        success: false,
      };
    }

    if (exactMatch) {
      const remaining = reminders.filter((r) => r.id !== exactMatch.id);
      const saved = saveReminders(remaining);
      if (!saved) {
        return {
          isReminderCommand: true,
          action: 'delete',
          reply: 'Si è verificato un errore durante l\'eliminazione del promemoria in memoria locale.',
          success: false,
        };
      }
      return {
        isReminderCommand: true,
        action: 'delete',
        reminder: exactMatch,
        reminders: remaining,
        reply: `Ho eliminato il promemoria: "${exactMatch.text}".`,
        success: true,
      };
    }

    if (candidates.length > 1) {
      const candidatesList = candidates.map((c) => `• "${c.text}"`).join('\n');
      return {
        isReminderCommand: true,
        action: 'delete',
        reply: `Ho trovato più promemoria che potrebbero corrispondere:\n${candidatesList}\nQuale intendi cancellare esattamente?`,
        success: false,
      };
    }

    return {
      isReminderCommand: true,
      action: 'delete',
      reply: `Non ho trovato nessun promemoria corrispondente a "${target}". Non è stato eliminato nulla.`,
      success: false,
    };
  }

  // ==========================================
  // 4. COMPLETE REMINDER COMMANDS
  // ==========================================
  // "Segna come fatto il promemoria sul latte", "Ho fatto il promemoria sul latte",
  // "Completa il primo promemoria", "Completa il promemoria 1"
  const completePattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:segna\s+come\s+(?:fatto|completato)|ho\s+fatto|completa)\s+(?:per favore\s+)?(?:(?:il|i)\s+|l['’])?(?:(primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|ultimo)\s+)?(?:promemoria|reminder)?\s*(?:sullo|sulla|sulle|sugli|sui|sul|su|dello|della|delle|degli|dei|del|di|che|intitolato|relativo a|relativo al|:)?\s*(.*)$/i;
  const completeMatch = clean.match(completePattern);

  if (completeMatch) {
    const posWord = completeMatch[1]?.trim();
    const restTarget = completeMatch[2]?.trim().replace(/^[:\s\-–—\"\'\`«»]+|[:\s\-–—\"\'\`«»]+$/g, '');
    const target = posWord || restTarget;

    const reminders = loadReminders();

    if (reminders.length === 0) {
      return {
        isReminderCommand: true,
        action: 'complete',
        reply: 'Non hai nessun promemoria salvato.',
        success: false,
      };
    }

    if (!target) {
      return {
        isReminderCommand: true,
        action: 'complete',
        reply: 'Quale promemoria vorresti segnare come completato?',
        success: false,
      };
    }

    const { exactMatch, candidates, outOfBounds } = findMatchingReminders(target, reminders);

    if (outOfBounds) {
      return {
        isReminderCommand: true,
        action: 'complete',
        reply: `Non ho trovato nessun promemoria corrispondente a "${target}".`,
        success: false,
      };
    }

    if (exactMatch) {
      if (exactMatch.completed) {
        return {
          isReminderCommand: true,
          action: 'complete',
          reminder: exactMatch,
          reminders,
          reply: `Il promemoria "${exactMatch.text}" era già segnato come completato.`,
          success: true,
        };
      }

      const updated = reminders.map((r) => (r.id === exactMatch.id ? { ...r, completed: true } : r));
      const saved = saveReminders(updated);
      if (!saved) {
        return {
          isReminderCommand: true,
          action: 'complete',
          reply: 'Si è verificato un errore durante l\'aggiornamento del promemoria in memoria locale.',
          success: false,
        };
      }
      return {
        isReminderCommand: true,
        action: 'complete',
        reminder: { ...exactMatch, completed: true },
        reminders: updated,
        reply: `Ho segnato come completato il promemoria: "${exactMatch.text}".`,
        success: true,
      };
    }

    if (candidates.length > 1) {
      const candidatesList = candidates.map((c) => `• "${c.text}"`).join('\n');
      return {
        isReminderCommand: true,
        action: 'complete',
        reply: `Ho trovato più promemoria che potrebbero corrispondere:\n${candidatesList}\nQuale intendi completare?`,
        success: false,
      };
    }

    return {
      isReminderCommand: true,
      action: 'complete',
      reply: `Non ho trovato nessun promemoria corrispondente a "${target}".`,
      success: false,
    };
  }

  // ==========================================
  // 5. CREATE REMINDER COMMANDS
  // ==========================================
  const parseRes = parseItalianReminder(clean);

  if (parseRes.isReminderIntent) {
    if (parseRes.ambiguous || parseRes.isPast) {
      return {
        isReminderCommand: true,
        action: 'create',
        reply: parseRes.clarification || "A che ora vorresti che te lo ricordi?",
        success: false,
      };
    }

    if (parseRes.dueAt && parseRes.reminderText) {
      const res = createReminder(parseRes.reminderText, parseRes.dueAt, clean);
      if (!res.success || !res.reminder) {
        return {
          isReminderCommand: true,
          action: 'create',
          reply: res.error || 'Non sono riuscita a salvare il promemoria.',
          success: false,
        };
      }

      const friendlyTime = formatFriendlyDueTime(res.reminder.dueAt);
      return {
        isReminderCommand: true,
        action: 'create',
        reminder: res.reminder,
        reminders: loadReminders(),
        reply: `Promemoria impostato per ${friendlyTime}: "${res.reminder.text}".`,
        success: true,
      };
    }
  }

  return { isReminderCommand: false };
}
