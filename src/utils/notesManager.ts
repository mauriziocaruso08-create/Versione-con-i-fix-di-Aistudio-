import { MaiaNote } from '../types';

export const NOTES_STORAGE_KEY = 'maia_notes_v1';

export interface NoteCommandResult {
  isNoteCommand: boolean;
  action?: 'create' | 'list' | 'delete';
  note?: MaiaNote;
  notes?: MaiaNote[];
  reply?: string;
  success?: boolean;
}

/**
 * Loads notes from localStorage safely.
 */
export function loadNotes(): MaiaNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const seen = new Set<string>();
      return parsed
        .filter(
          (n): n is MaiaNote =>
            Boolean(n) &&
            typeof n === 'object' &&
            typeof n.id === 'string' &&
            typeof n.text === 'string' &&
            n.text.trim().length > 0 &&
            typeof n.createdAt === 'string' &&
            !Number.isNaN(new Date(n.createdAt).getTime())
        )
        .map((n) => ({
          ...n,
          ...(typeof (n as any).title === 'string' && (n as any).title.trim()
            ? { title: (n as any).title.trim() }
            : {}),
          text: n.text.trim(),
        }))
        .filter((n) => {
          if (seen.has(n.id)) return false;
          seen.add(n.id);
          return true;
        });
    }
  } catch (err) {
    console.error('[MAIA Notes] Failed to load notes:', err);
  }
  return [];
}

/**
 * Saves notes to localStorage safely.
 * Returns true if successful, false if storage fails.
 */
export function saveNotes(notes: MaiaNote[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    return true;
  } catch (err) {
    console.error('[MAIA Notes] Failed to save notes to localStorage:', err);
    return false;
  }
}

/**
 * Cleans punctuation and whitespace.
 */
function cleanText(text: string): string {
  return text.trim().replace(/^[:\s\-–—]+/, '').replace(/[.!?;:]+$/, '').trim();
}

const ITALIAN_STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
  'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
  'che', 'devo', 'deve', 'dobbiamo', 'ho', 'ha', 'abbiamo',
  'del', 'dello', 'della', 'dei', 'degli', 'delle',
  'al', 'allo', 'alla', 'ai', 'agli', 'alle',
  'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
  'nel', 'nello', 'nella', 'nei', 'negli', 'nelle',
  'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
  'nota', 'note', 'relativa', 'relativo', 'intitolata', 'intitolato',
]);

/**
 * Extracts normalized search keywords from a query string.
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
 * Finds candidate note matches for deletion with high precision and safety.
 * Never deletes a note by loose or accidental token overlap.
 */
export function findMatchingNotes(
  targetQuery: string,
  existingNotes: MaiaNote[]
): { exactMatch: MaiaNote | null; candidates: MaiaNote[]; outOfBounds?: boolean } {
  const cleanTarget = targetQuery
    .toLowerCase()
    .trim()
    .replace(/^[:\s\-–—\"\'\`«»]+|[:\s\-–—\"\'\`«»]+$/g, '')
    .trim();

  if (!cleanTarget || existingNotes.length === 0) {
    return { exactMatch: null, candidates: [] };
  }

  // 1. Positional matching (e.g. "prima", "seconda", "terza", ..., "ultima")
  const posRegex = /^(?:(?:la|l['’])\s+)?(prima|seconda|terza|quarta|quinta|sesta|settima|ottava|nona|decima|ultima)(?:\s+nota)?$/i;
  const posM = cleanTarget.match(posRegex);
  if (posM) {
    const word = posM[1].toLowerCase();
    const ordinals: Record<string, number> = {
      prima: 0,
      seconda: 1,
      terza: 2,
      quarta: 3,
      quinta: 4,
      sesta: 5,
      settima: 6,
      ottava: 7,
      nona: 8,
      decima: 9,
    };
    let idx = ordinals[word];
    if (word === 'ultima') idx = existingNotes.length - 1;
    if (idx !== undefined) {
      if (idx >= 0 && idx < existingNotes.length) {
        return { exactMatch: existingNotes[idx], candidates: [existingNotes[idx]] };
      }
      return { exactMatch: null, candidates: [], outOfBounds: true };
    }
  }

  // 2. Numeric index matching (e.g. "nota 1", "nota numero 1", "numero 1", "1")
  const numRegex = /^(?:(?:la\s+)?nota\s+(?:numero\s+)?|(?:la\s+)?numero\s+|#\s*)?([0-9]+)(?:\s+nota)?$/i;
  const numM = cleanTarget.match(numRegex);
  if (numM) {
    const idx = parseInt(numM[1], 10) - 1;
    if (idx >= 0 && idx < existingNotes.length) {
      return { exactMatch: existingNotes[idx], candidates: [existingNotes[idx]] };
    }
    return { exactMatch: null, candidates: [], outOfBounds: true };
  }

  // 3. Full exact text match (case-insensitive)
  const exact = existingNotes.find((n) => n.text.toLowerCase().trim() === cleanTarget);
  if (exact) {
    return { exactMatch: exact, candidates: [exact] };
  }

  // 4. Substring containment: note contains cleanTarget
  const subMatches = existingNotes.filter((n) => n.text.toLowerCase().includes(cleanTarget));
  if (subMatches.length === 1) {
    return { exactMatch: subMatches[0], candidates: subMatches };
  }
  if (subMatches.length > 1) {
    return { exactMatch: null, candidates: subMatches };
  }

  // 5. Keyword token matching with STRICT subset validation
  const targetKws = extractKeywords(cleanTarget);
  if (targetKws.length === 0) {
    return { exactMatch: null, candidates: [] };
  }

  const matchedCandidates: Array<{ note: MaiaNote; score: number }> = [];

  for (const note of existingNotes) {
    const noteLower = note.text.toLowerCase();
    let kwHits = 0;
    for (const kw of targetKws) {
      if (noteLower.includes(kw)) {
        kwHits++;
      }
    }
    // Safety requirement: ALL target keywords must be present in the note.
    if (kwHits === targetKws.length) {
      matchedCandidates.push({ note, score: kwHits });
    }
  }

  if (matchedCandidates.length === 1) {
    return { exactMatch: matchedCandidates[0].note, candidates: [matchedCandidates[0].note] };
  }
  if (matchedCandidates.length > 1) {
    return { exactMatch: null, candidates: matchedCandidates.map((c) => c.note) };
  }

  return { exactMatch: null, candidates: [] };
}

/**
 * Checks whether the user intent is to retrieve/list stored notes.
 * Uses structured patterns that recognize natural Italian formulations while
 * strictly preventing false positives from informational or unrelated questions.
 */
export function isListNotesIntent(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[.?!;:,]+$/, '').trim();

  // Explicitly reject informational, definition, or how-to queries
  if (
    /^(?:cosa significa|cos['’]è|definizione di|come si|come posso|come fare per|perché|spiegami come)\b/i.test(
      text
    )
  ) {
    return false;
  }

  // Reject questions directed to a specific external subject (e.g. "Hai preso nota del problema?")
  if (
    /\b(?:preso nota|annotato|segnato)\s+(?:del|dello|della|dei|degli|delle|di un|di una|sul|sulla|sui|sulle)\s+[a-zà-ÿ]{3,}/i.test(
      text
    )
  ) {
    return false;
  }

  // 1. "Cosa [ho / hai / abbiamo] annotato / segnato / preso nota..."
  if (
    /^(?:maia[,\s]+)?(?:per favore[,\s]+)?cosa\s+(?:ho|hai|abbiamo)\s+(?:annotato|segnato|preso nota|appuntato)$/i.test(
      text
    )
  ) {
    return true;
  }

  // 2. "Cosa ti sei annotata / segnato..."
  if (
    /^(?:maia[,\s]+)?(?:per favore[,\s]+)?cosa\s+ti\s+sei\s+(?:annotata|annotato|segnata|segnato|appuntata|appuntato)$/i.test(
      text
    )
  ) {
    return true;
  }

  // 3. "Cosa c'è annotato / nelle note..."
  if (
    /^(?:maia[,\s]+)?cosa\s+c['’]è\s+(?:annotato|segnato|appuntato|(?:scritto\s+)?(?:nelle|tra le)\s+(?:mie\s+)?note)$/i.test(
      text
    )
  ) {
    return true;
  }

  // 4. "Mostrami / Fammi vedere / Leggi / Elenca..."
  if (
    /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:mostrami|fammi vedere|leggi|elenca|mostra)\s+(?:cosa\s+(?:ho|hai|abbiamo)\s+(?:annotato|segnato|preso nota|appuntato)|(?:tutte\s+)?(?:le\s+)?(?:mie\s+)?note)$/i.test(
      text
    )
  ) {
    return true;
  }

  // 5. "Quali sono le mie note / Quali note ci sono salvate..."
  if (
    /^(?:maia[,\s]+)?(?:quali\s+sono\s+(?:le\s+)?(?:mie\s+)?note|(?:quali|che)\s+note\s+(?:ho|hai|ci sono)(?:\s+(?:salvate|memorizzate))?)$/i.test(
      text
    )
  ) {
    return true;
  }

  // 6. Concise standalone requests
  if (
    /^(?:maia[,\s]+)?(?:elenco\s+(?:delle\s+)?(?:mie\s+)?note|le\s+mie\s+note|note\s+salvate)$/i.test(
      text
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Processes an input string to detect and execute deterministic note operations.
 * Returns { isNoteCommand: true, ... } if the input was a note command.
 */
export function handleNoteCommand(input: string): NoteCommandResult {
  const clean = input.trim();

  // ==========================================
  // 1. LIST NOTES COMMANDS
  // ==========================================
  if (isListNotesIntent(clean)) {
    const notes = loadNotes();
    if (notes.length === 0) {
      return {
        isNoteCommand: true,
        action: 'list',
        notes: [],
        reply: 'Non hai ancora nessuna nota salvata.',
        success: true,
      };
    }

    const formattedList = notes
      .map((note, index) => `${index + 1}. ${note.text}`)
      .join('\n');

    return {
      isNoteCommand: true,
      action: 'list',
      notes,
      reply: `Ecco le tue note:\n${formattedList}`,
      success: true,
    };
  }

  // ==========================================
  // 2. DELETE ALL NOTES COMMANDS
  // ==========================================
  // Examples:
  // "Cancella tutte le note"
  // "Elimina tutte le note"
  // "Cancella le note"
  // "Elimina le note"
  // "Svuota le note"
  // "Rimuovi tutte le note"
  const deleteAllPattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancella|eliminare|elimina|rimuovere|rimuovi|svuotare|svuota)\s+(?:per favore\s+)?(?:tutte\s+le\s+note|le\s+note|ogni\s+nota)$/i;
  if (deleteAllPattern.test(clean)) {
    const notes = loadNotes();
    if (notes.length === 0) {
      return {
        isNoteCommand: true,
        action: 'delete',
        notes: [],
        reply: 'Non hai nessuna nota salvata da cancellare.',
        success: true,
      };
    }

    const saved = saveNotes([]);
    if (!saved) {
      return {
        isNoteCommand: true,
        action: 'delete',
        reply: 'Si è verificato un errore durante l\'eliminazione delle note in memoria locale.',
        success: false,
      };
    }

    return {
      isNoteCommand: true,
      action: 'delete',
      notes: [],
      reply: 'Ho eliminato tutte le note.',
      success: true,
    };
  }

  // ==========================================
  // 3. DELETE SPECIFIC / POSITIONAL NOTE COMMANDS
  // ==========================================
  // Examples:
  // "Cancella la nota sul latte"
  // "Elimina la nota che devo comprare il latte"
  // "Cancella la prima nota"
  // "Elimina l'ultima nota"
  // "Cancella la nota numero 1"
  // "Elimina la nota 1"
  const deletePattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancellami|cancella|eliminare|eliminami|elimina|rimuovere|rimuovimi|rimuovi)\s+(?:per favore\s+)?(?:(?:la|le)\s+|l['’])?(?:(prima|seconda|terza|quarta|quinta|sesta|settima|ottava|nona|decima|ultima)\s+)?(?:nota|note)\s*(?:sullo|sulla|sulle|sugli|sui|sul|su|dello|della|delle|degli|dei|del|di|che|intitolata|relativa a|relativa al|:)?\s*(.*)$/i;
  const deleteMatch = clean.match(deletePattern);

  if (deleteMatch) {
    const posWord = deleteMatch[1]?.trim();
    const restTarget = cleanText(deleteMatch[2] || '');
    const target = posWord || restTarget;

    const notes = loadNotes();

    if (notes.length === 0) {
      return {
        isNoteCommand: true,
        action: 'delete',
        reply: 'Non hai nessuna nota salvata da cancellare.',
        success: false,
      };
    }

    if (!target) {
      return {
        isNoteCommand: true,
        action: 'delete',
        reply: 'Quale nota vorresti cancellare?',
        success: false,
      };
    }

    const { exactMatch, candidates, outOfBounds } = findMatchingNotes(target, notes);

    if (outOfBounds) {
      return {
        isNoteCommand: true,
        action: 'delete',
        reply: `Non ho trovato nessuna nota corrispondente a "${target}". Non è stato eliminato nulla.`,
        success: false,
      };
    }

    if (exactMatch) {
      const remaining = notes.filter((n) => n.id !== exactMatch.id);
      const saved = saveNotes(remaining);
      if (!saved) {
        return {
          isNoteCommand: true,
          action: 'delete',
          reply: 'Si è verificato un errore durante l\'aggiornamento delle note in memoria locale.',
          success: false,
        };
      }
      return {
        isNoteCommand: true,
        action: 'delete',
        note: exactMatch,
        notes: remaining,
        reply: `Ho eliminato la nota: "${exactMatch.text}".`,
        success: true,
      };
    }

    if (candidates.length > 1) {
      const candidateList = candidates.map((c) => `• "${c.text}"`).join('\n');
      return {
        isNoteCommand: true,
        action: 'delete',
        reply: `Ho trovato più note che potrebbero corrispondere:\n${candidateList}\nQuale intendi cancellare esattamente?`,
        success: false,
      };
    }

    return {
      isNoteCommand: true,
      action: 'delete',
      reply: `Non ho trovato nessuna nota corrispondente a "${target}". Non è stato eliminato nulla.`,
      success: false,
    };
  }

  // ==========================================
  // 3. CREATE NOTE COMMANDS
  // ==========================================
  // Examples:
  // “Annota che devo comprare il latte.”
  // “Prendi nota che devo chiamare Roberto.”
  // “Ricordami come nota che domani devo andare al supermercato.”
  // “Segna che devo pagare la bolletta.”
  const createPattern = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:annota che|annota di|annota:|annota|prendi nota che|prendi nota di|prendi nota:|prendi nota|ricordami come nota che|ricordami come nota di|ricordami come nota:|ricordami come nota|segna che|segna di|segna:|crea una nota che|crea una nota di|crea una nota:|crea una nota|nuova nota:|aggiungi una nota:|aggiungi nota:|salva come nota:|salva una nota:)\s+(.+)$/i;
  const createMatch = clean.match(createPattern);

  if (createMatch) {
    const noteText = cleanText(createMatch[1]);
    if (!noteText) {
      return {
        isNoteCommand: true,
        action: 'create',
        reply: 'Cosa vorresti che annotassi?',
        success: false,
      };
    }

    const currentNotes = loadNotes();
    const newNote: MaiaNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: noteText,
      createdAt: new Date().toISOString(),
    };

    const updated = [...currentNotes, newNote];
    const writeOk = saveNotes(updated);

    if (!writeOk) {
      return {
        isNoteCommand: true,
        action: 'create',
        reply: 'Impossibile salvare la nota: si è verificato un errore di archiviazione locale nel browser.',
        success: false,
      };
    }

    return {
      isNoteCommand: true,
      action: 'create',
      note: newNote,
      notes: updated,
      reply: `Annotato: "${noteText}".`,
      success: true,
    };
  }

  return { isNoteCommand: false };
}
