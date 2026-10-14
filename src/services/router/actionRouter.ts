import { MaiaActionType, RouterResolution, ActionStatus, WebSearchParams } from '../../types/actions';
import { MaiaNote, MaiaReminder, UserMemory } from '../../types';
import {
  parseItalianReminder,
  findMatchingReminders,
  loadReminders,
} from '../../utils/reminderManager';
import {
  isListNotesIntent,
  findMatchingNotes,
  loadNotes,
} from '../../utils/notesManager';

export interface RouterContext {
  reminders?: MaiaReminder[];
  notes?: MaiaNote[];
  memory?: UserMemory;
}

/**
 * Normalizes input text for intent analysis.
 */
function cleanInput(text: string): string {
  return text.trim().replace(/[.?!;:]+$/, '').trim();
}

/**
 * Extracts normalized content by removing punctuation and extra whitespace.
 */
function cleanText(text: string): string {
  return text.trim().replace(/^[:\s\-–—]+/, '').replace(/[.!?;:]+$/, '').trim();
}

/**
 * Resolves user query into a structured Action Resolution.
 *
 * This function is an intent-resolution layer ONLY:
 * - Does NOT execute operations
 * - Does NOT write to localStorage or state
 * - Does NOT call external APIs (Gemini)
 * - Conservative: falls back to Gemini when intent is ambiguous or conversational
 */
export function resolveAction(query: string, context?: RouterContext): RouterResolution {
  const clean = cleanInput(query);
  const lower = clean.toLowerCase();

  // 0. Explicit conversational/informational questions about actions or general topics
  // e.g. "Parlami dei promemoria", "Spiegami cosa sono le note", "Cosa significa promemoria?"
  const informationalRegex = /^(?:maia[,\s]+)?(?:parlami\s+(?:dei|delle|del|della|di|su)|spiegami\s+(?:cosa|come|chi|perché)|cosa\s+(?:sono|significa|vuol dire)|definizione\s+di|raccontami\s+(?:una|un|di)|come\s+(?:funziona|funzionano))\b/i;
  if (informationalRegex.test(lower)) {
    return {
      actionType: 'CHAT_FALLTHROUGH',
      status: 'FALLTHROUGH_GEMINI',
      payload: { rawText: clean },
    };
  }

  // ==========================================
  // 1. DESTRUCTIVE REMINDER COMMANDS
  // ==========================================
  // 1a. Delete all reminders
  const deleteAllRemindersRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancellami|cancella|eliminare|eliminami|elimina|rimuovere|rimuovimi|rimuovi|svuotare|svuota)\s+(?:per favore\s+)?(?:tutti\s+i\s+promemoria|i\s+promemoria|ogni\s+promemoria)$/i;
  if (deleteAllRemindersRegex.test(clean)) {
    return {
      actionType: 'REMINDER_DELETE',
      status: 'CONFIRMATION_REQUIRED',
      payload: {
        rawText: clean,
        isDestructive: true,
        parameters: {
          scope: 'all',
        },
      },
      confirmationPrompt: 'Sei sicuro di voler eliminare tutti i tuoi promemoria? L\'operazione è irreversibile.',
    };
  }

  // 1b. Delete specific or positional reminder
  const deleteSpecificReminderRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancellami|cancella|eliminare|eliminami|elimina|rimuovere|rimuovimi|rimuovi)\s+(?:per favore\s+)?(?:(?:il|i)\s+|l['’])?(?:(primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|ultimo)\s+)?(?:promemoria|reminder)\s*(?:sullo|sulla|sulle|sugli|sui|sul|su|dello|della|delle|degli|dei|del|di|che|intitolato|relativo a|relativo al|:)?\s*(.*)$/i;
  const deleteReminderMatch = clean.match(deleteSpecificReminderRegex);
  if (deleteReminderMatch) {
    const posWord = deleteReminderMatch[1]?.trim();
    const restTarget = deleteReminderMatch[2]?.trim().replace(/^[:\s\-–—\"\'\`«»]+|[:\s\-–—\"\'\`«»]+$/g, '');
    const target = posWord || restTarget;

    if (!target) {
      return {
        actionType: 'REMINDER_DELETE',
        status: 'AMBIGUOUS_INPUT',
        payload: {
          rawText: clean,
          isDestructive: true,
          parameters: { scope: 'specific' },
        },
        clarificationMessage: 'Quale promemoria vorresti cancellare?',
      };
    }

    const currentReminders = context?.reminders ?? loadReminders();
    const { exactMatch, candidates, outOfBounds } = findMatchingReminders(target, currentReminders);

    if (candidates.length > 1) {
      const candidateList = candidates.map((c) => `• "${c.text}"`).join('\n');
      return {
        actionType: 'REMINDER_DELETE',
        status: 'AMBIGUOUS_INPUT',
        payload: {
          rawText: clean,
          isDestructive: true,
          parameters: {
            scope: 'specific',
            targetQuery: target,
            candidateCount: candidates.length,
          },
        },
        clarificationMessage: `Ho trovato più promemoria che potrebbero corrispondere:\n${candidateList}\nQuale intendi cancellare esattamente?`,
      };
    }

    return {
      actionType: 'REMINDER_DELETE',
      status: 'CONFIRMATION_REQUIRED',
      payload: {
        rawText: clean,
        isDestructive: true,
        parameters: {
          scope: 'specific',
          targetQuery: target,
          matchedReminderId: exactMatch?.id,
          matchedText: exactMatch?.text,
          outOfBounds: Boolean(outOfBounds),
        },
      },
      confirmationPrompt: exactMatch
        ? `Vuoi davvero cancellare il promemoria: "${exactMatch.text}"?`
        : `Confermi l'eliminazione del promemoria "${target}"?`,
    };
  }

  // ==========================================
  // 2. LIST REMINDERS
  // ==========================================
  const listRemindersRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cosa\s+ho\s+nei\s+promemoria|quali\s+promemoria\s+ho|mostrami\s+i\s+promemoria|mostra\s+i\s+promemoria|che\s+promemoria\s+ho|cosa\s+devo\s+ricordare|lista\s+promemoria|elenco\s+promemoria|leggi\s+i\s+promemoria|ho\s+promemoria|ho\s+(?:un\s+|dei\s+|qualche\s+)?promemoria(?:\s+(?:per|oggi|domani|attivo|attivi|salvato|salvati).*)?|i\s+miei\s+promemoria|quali\s+sono\s+i\s+miei\s+promemoria)$/i;
  if (listRemindersRegex.test(clean)) {
    return {
      actionType: 'REMINDER_LIST',
      status: 'DETERMINISTIC_LOCAL',
      payload: {
        rawText: clean,
        parameters: {},
      },
    };
  }

  // ==========================================
  // 3. COMPLETE REMINDER
  // ==========================================
  const completeReminderRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:segna\s+come\s+(?:fatto|completato|eseguito)|spunta|completa)\s+(?:il\s+promemoria\s+)?(.*)$/i;
  const completeMatch = clean.match(completeReminderRegex);
  if (completeMatch) {
    const target = completeMatch[1]?.trim();
    return {
      actionType: 'REMINDER_COMPLETE',
      status: target ? 'DETERMINISTIC_LOCAL' : 'AMBIGUOUS_INPUT',
      payload: {
        rawText: clean,
        parameters: { targetQuery: target },
      },
      clarificationMessage: target ? undefined : 'Quale promemoria vuoi segnare come completato?',
    };
  }

  // ==========================================
  // 4. USER MEMORY COMMANDS (Explicit)
  // ==========================================
  // 4a. Memory Query ("Cosa ricordi di me?", etc.)
  const memoryQueryRegex = /^(?:maia[,\s]+)?(?:cosa ricordi di me|cosa ti ricordi di me|cosa hai nella tua memoria|cosa c['’]è nella tua memoria|quali informazioni hai memorizzato su di me|quali informazioni hai su di me|cosa sai di me|cosa hai memorizzato su di me|mostrami la tua memoria|cosa ricordi\??|cosa hai memorizzato\??)$/i;
  if (memoryQueryRegex.test(clean)) {
    return {
      actionType: 'MEMORY_QUERY',
      status: 'DETERMINISTIC_LOCAL',
      payload: { rawText: clean, parameters: {} },
    };
  }

  // 4b. Destructive Memory Delete (Forget) ("Dimentica che...", etc.)
  const memoryForgetRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:dimentica che|dimenticati che|rimuovi dalla memoria che|dimmi di dimenticare che|cancella dalla memoria che|elimina dalla memoria che|scorda che)\s+(.+)$/i;
  const memoryForgetMatch = clean.match(memoryForgetRegex);
  if (memoryForgetMatch) {
    const rawTarget = cleanText(memoryForgetMatch[1]);
    return {
      actionType: 'MEMORY_DELETE',
      status: 'CONFIRMATION_REQUIRED',
      payload: {
        rawText: clean,
        isDestructive: true,
        parameters: {
          scope: 'specific',
          targetQuery: rawTarget,
        },
      },
      confirmationPrompt: `Vuoi davvero rimuovere dalla mia memoria: "${rawTarget}"?`,
    };
  }

  // 4c. Explicit Memory Save ("Ricordati che...", "Ricorda che...", "Tieni a mente che...", "Memorizza che...")
  // Note: "Ricordati che [fatto]" is a declarative memory statement ("Remember that...").
  // Distinct from "Ricordami di [azione]" which is a reminder ("Remind me to...").
  const memorySaveRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:ricordati che|ricorda che|tieni a mente che|memorizza che)\s+(.+)$/i;
  const memorySaveMatch = clean.match(memorySaveRegex);
  if (memorySaveMatch) {
    const rawFact = cleanText(memorySaveMatch[1]);
    if (!rawFact) {
      return {
        actionType: 'MEMORY_SAVE',
        status: 'AMBIGUOUS_INPUT',
        payload: { rawText: clean },
        clarificationMessage: 'Cosa vorresti che tenessi a mente?',
      };
    }

    return {
      actionType: 'MEMORY_SAVE',
      status: 'DETERMINISTIC_LOCAL',
      payload: {
        rawText: clean,
        parameters: { fact: rawFact },
      },
    };
  }

  // ==========================================
  // 5. CREATE REMINDER
  // ==========================================
  const reminderParse = parseItalianReminder(clean);
  if (reminderParse.isReminderIntent) {
    if (reminderParse.ambiguous || reminderParse.isPast || !reminderParse.dueAt) {
      return {
        actionType: 'REMINDER_CREATE',
        status: 'AMBIGUOUS_INPUT',
        payload: {
          rawText: clean,
          parameters: {
            reminderText: reminderParse.reminderText,
            isPast: reminderParse.isPast,
          },
        },
        clarificationMessage:
          reminderParse.clarification ||
          "A che ora vorresti che te lo ricordi? Specifica un orario esatto (ad esempio: 'alle 20:00' o 'tra mezz'ora').",
      };
    }

    return {
      actionType: 'REMINDER_CREATE',
      status: 'DETERMINISTIC_LOCAL',
      payload: {
        rawText: clean,
        parameters: {
          reminderText: reminderParse.reminderText,
          dueAt: reminderParse.dueAt.toISOString(),
        },
      },
    };
  }

  // ==========================================
  // 5. DESTRUCTIVE NOTE COMMANDS
  // ==========================================
  // 5a. Delete all notes
  const deleteAllNotesRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancella|eliminare|elimina|rimuovere|rimuovi|svuotare|svuota)\s+(?:per favore\s+)?(?:tutte\s+le\s+note|le\s+note|ogni\s+nota)$/i;
  if (deleteAllNotesRegex.test(clean)) {
    return {
      actionType: 'NOTE_DELETE',
      status: 'CONFIRMATION_REQUIRED',
      payload: {
        rawText: clean,
        isDestructive: true,
        parameters: {
          scope: 'all',
        },
      },
      confirmationPrompt: 'Sei sicuro di voler eliminare tutte le tue note? L\'operazione è irreversibile.',
    };
  }

  // 5b. Delete specific note
  const deleteSpecificNoteRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:puoi\s+(?:per favore\s+)?)?(?:cancellare|cancellami|cancella|eliminare|eliminami|elimina|rimuovere|rimuovimi|rimuovi)\s+(?:per favore\s+)?(?:la\s+|l['’])?(?:(prima|seconda|terza|quarta|quinta|sesta|settima|ottava|nona|decima|ultima)\s+)?nota\s*(?:sullo|sulla|sulle|sugli|sui|sul|su|dello|della|delle|degli|dei|del|di|che|intitolata|relativa a|relativa al|:)?\s*(.*)$/i;
  const deleteNoteMatch = clean.match(deleteSpecificNoteRegex);
  if (deleteNoteMatch) {
    const posWord = deleteNoteMatch[1]?.trim();
    const restTarget = deleteNoteMatch[2]?.trim().replace(/^[:\s\-–—\"\'\`«»]+|[:\s\-–—\"\'\`«»]+$/g, '');
    const target = posWord || restTarget;

    if (!target) {
      return {
        actionType: 'NOTE_DELETE',
        status: 'AMBIGUOUS_INPUT',
        payload: {
          rawText: clean,
          isDestructive: true,
          parameters: { scope: 'specific' },
        },
        clarificationMessage: 'Quale nota vorresti cancellare?',
      };
    }

    const currentNotes = context?.notes ?? loadNotes();
    const { exactMatch, candidates } = findMatchingNotes(target, currentNotes);

    if (candidates.length > 1) {
      const candidateList = candidates.map((c) => `• "${c.text}"`).join('\n');
      return {
        actionType: 'NOTE_DELETE',
        status: 'AMBIGUOUS_INPUT',
        payload: {
          rawText: clean,
          isDestructive: true,
          parameters: {
            scope: 'specific',
            targetQuery: target,
            candidateCount: candidates.length,
          },
        },
        clarificationMessage: `Ho trovato più note che potrebbero corrispondere:\n${candidateList}\nQuale intendi cancellare esattamente?`,
      };
    }

    return {
      actionType: 'NOTE_DELETE',
      status: 'CONFIRMATION_REQUIRED',
      payload: {
        rawText: clean,
        isDestructive: true,
        parameters: {
          scope: 'specific',
          targetQuery: target,
          matchedNoteId: exactMatch?.id,
          matchedText: exactMatch?.text,
        },
      },
      confirmationPrompt: exactMatch
        ? `Vuoi davvero eliminare la nota: "${exactMatch.text}"?`
        : `Confermi l'eliminazione della nota "${target}"?`,
    };
  }

  // ==========================================
  // 6. LIST NOTES
  // ==========================================
  if (isListNotesIntent(clean)) {
    return {
      actionType: 'NOTE_LIST',
      status: 'DETERMINISTIC_LOCAL',
      payload: {
        rawText: clean,
        parameters: {},
      },
    };
  }

  // ==========================================
  // 7. CREATE NOTE
  // ==========================================
  const createNoteRegex = /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:annota che|annota di|annota:|annota|prendi nota che|prendi nota di|prendi nota:|prendi nota|ricordami come nota che|ricordami come nota di|ricordami come nota:|ricordami come nota|segna che|segna di|segna:|crea una nota che|crea una nota di|crea una nota:|crea una nota|nuova nota:|aggiungi una nota:|aggiungi nota:|salva come nota:|salva una nota:)\s+(.+)$/i;
  const createNoteMatch = clean.match(createNoteRegex);
  if (createNoteMatch) {
    const noteText = cleanText(createNoteMatch[1]);
    if (!noteText) {
      return {
        actionType: 'NOTE_CREATE',
        status: 'AMBIGUOUS_INPUT',
        payload: { rawText: clean },
        clarificationMessage: 'Cosa vorresti che annotassi?',
      };
    }

    return {
      actionType: 'NOTE_CREATE',
      status: 'DETERMINISTIC_LOCAL',
      payload: {
        rawText: clean,
        parameters: { noteText },
      },
    };
  }

  // ==========================================
  // 8. WEB SEARCH (Real-time external information)
  // ==========================================
  const searchParams = matchWebSearchCommand(clean);
  if (searchParams) {
    return {
      actionType: 'WEB_SEARCH',
      status: 'EXTERNAL_TOOL',
      payload: {
        rawText: clean,
        parameters: {
          searchQuery: searchParams.searchQuery,
          category: searchParams.category,
        },
      },
    };
  }

  // ==========================================
  // 9. DEFAULT / CONSERVATIVE FALLTHROUGH TO GEMINI
  // ==========================================
  // General requests, questions, mathematical calculations, casual chat, etc.
  return {
    actionType: 'CHAT_FALLTHROUGH',
    status: 'FALLTHROUGH_GEMINI',
    payload: { rawText: clean },
  };
}

/**
 * Conservative matcher for user intents requiring real-time web search.
 *
 * SAFETY RULES:
 * - Does NOT trigger on general conversation, math, coding, definitions, or science.
 * - Does NOT trigger on local actions (notes, reminders, memory).
 * - Only triggers on explicit web searches, current weather, latest releases/specs, and breaking news.
 */
export function matchWebSearchCommand(input: string): WebSearchParams | null {
  const clean = cleanInput(input);
  // Strip optional conversational vocatives like "maia, ..."
  const stripped = clean.replace(/^(?:ehi\s+|ciao\s+)?maia[,\s:]+/i, '').trim();

  // 1. Weather / Forecast intent
  // "che tempo farà domani a Malta?", "che tempo fa a Malta?", "previsioni meteo per Roma", "meteo domani a Milano"
  const weatherRegex = /^(?:che\s+tempo\s+(?:fa|far[àa]|è\s+previsto)|com['’]è\s+il\s+tempo|previsioni\s+meteo|meteo)\s+(?:oggi|domani|dopodomani|questo\s+weekend)?\s*(?:a|in|per|su)?\s*(.+)$/i;
  const weatherMatch = stripped.match(weatherRegex);
  if (weatherMatch) {
    return {
      searchQuery: stripped,
      category: 'weather',
    };
  }

  // 2. Explicit web search commands
  // "cerca le recensioni del Xiaomi 15 Ultra", "cerca online Xiaomi 15 Ultra", "cercami informazioni su...",
  // "fai una ricerca su...", "trovami informazioni su/del/sul...", "trovami recensioni di..."
  const explicitSearchRegex = /^(?:cerca\s+(?:su\s+internet|sul\s+web|online|le\s+recensioni|recensioni|notizie|info|informazioni)?|cercami\s+(?:su\s+internet|sul\s+web|online|informazioni|notizie|info)?|fai\s+una\s+ricerca\s+(?:su|per|online)?|trovami\s+(?:informazioni|info|notizie|recensioni)?\s*(?:su|sul|sulla|sui|del|della|di)?)\s+(.+)$/i;
  const explicitMatch = stripped.match(explicitSearchRegex);
  if (explicitMatch) {
    const rawTarget = explicitMatch[1].trim();
    if (rawTarget.length > 2) {
      return {
        searchQuery: stripped,
        category: 'general',
      };
    }
  }

  // Also standalone direct: "cerca online <term>" or "cerca su google <term>"
  const directCercaRegex = /^cerca\s+(?:online\s+|su\s+google\s+|sul\s+web\s+)(.+)$/i;
  const directCercaMatch = stripped.match(directCercaRegex);
  if (directCercaMatch) {
    const queryTerm = directCercaMatch[1].trim();
    if (queryTerm.length > 2) {
      return {
        searchQuery: stripped,
        category: 'general',
      };
    }
  }

  // 3. Latest releases, tech specs, product releases
  // "qual è l'ultimo modello Xiaomi?", "quando esce il nuovo iPhone?", "ultime novità su..."
  const latestReleaseRegex = /^(?:qual\s+[eè]\s+l['’]ultimo\s+modello(?:\s+di|\s+della|\s+del)?|quando\s+esce\s+(?:il\s+nuovo|la\s+nuova|l['’]ultimo)|ultime\s+novit[àa]\s+(?:su|sul|sulla|sui|di|del|della))\s+(.+)$/i;
  const latestMatch = stripped.match(latestReleaseRegex);
  if (latestMatch) {
    return {
      searchQuery: stripped,
      category: 'technology',
    };
  }

  // 4. Breaking news / Current world events
  // "ultime notizie su ...", "cosa è successo oggi?", "cosa sta succedendo nel mondo?"
  const newsRegex = /^(?:ultime\s+notizie(?:\s+su|\s+di|\s+del|\s+della)?\s*(.+)|cosa\s+[eè]\s+successo\s+oggi(?:\s+nel\s+mondo|\s+in\s+italia)?\??|cosa\s+sta\s+succedendo\s+(?:nel\s+mondo|in\s+italia|oggi)\??|notizie\s+(?:del\s+giorno|di\s+oggi)\??)$/i;
  const newsMatch = stripped.match(newsRegex);
  if (newsMatch) {
    return {
      searchQuery: stripped,
      category: 'news',
    };
  }

  return null;
}
