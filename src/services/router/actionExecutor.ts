import { ActionResult, RouterResolution } from '../../types/actions';
import { MaiaNote, MaiaReminder, UserMemory, DEFAULT_USER_MEMORY } from '../../types';
import {
  loadNotes,
  saveNotes,
  findMatchingNotes,
} from '../../utils/notesManager';
import {
  loadReminders,
  saveReminders,
  createReminder,
  deleteReminder,
  completeReminder,
  findMatchingReminders,
} from '../../utils/reminderManager';
import { handleMemoryCommand } from '../../utils/memoryManager';
import { executeWebSearch } from '../webSearchService';

export const MEMORY_STORAGE_KEY = 'maia_user_memory_v1';
export const PROFILE_STORAGE_KEY = 'maia_user_profile_v1';

export interface ActionExecutorContext {
  notes?: MaiaNote[];
  reminders?: MaiaReminder[];
  memory?: UserMemory;
}

/**
 * Loads UserMemory safely from localStorage using the established key.
 */
export function loadUserMemory(): UserMemory {
  const emptyMemory = (): UserMemory => ({
    userName: '', userCity: '', preferences: [], interests: [], projects: [], notes: [], structuredPreferences: [], personalFacts: [],
  });
  if (typeof window === 'undefined') return emptyMemory();
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    const profileRaw = localStorage.getItem(PROFILE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const profile = profileRaw ? JSON.parse(profileRaw) : {};
    if ((parsed && typeof parsed === 'object') || (profile && typeof profile === 'object')) {
      return {
        userName: typeof profile?.userName === 'string' && profile.userName.trim() ? profile.userName : typeof parsed?.userName === 'string' ? parsed.userName : '',
        userCity: typeof profile?.userCity === 'string' && profile.userCity.trim() ? profile.userCity : typeof parsed?.userCity === 'string' ? parsed.userCity : '',
        preferences: Array.isArray(parsed?.preferences) ? parsed.preferences : [],
        interests: Array.isArray(parsed?.interests) ? parsed.interests : [],
        projects: Array.isArray(parsed?.projects) ? parsed.projects : [],
        notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
        structuredPreferences: Array.isArray(parsed?.structuredPreferences) ? parsed.structuredPreferences : [],
        personalFacts: Array.isArray(parsed?.personalFacts) ? parsed.personalFacts : [],
      };
    }
  } catch (err) { console.error('[ActionExecutor] Failed to load UserMemory:', err); }
  return emptyMemory();
}

/** Saves UserMemory and mirrors profile identity into a dedicated persistent key. */
export function saveUserMemory(memory: UserMemory, clearProfileOnEmpty = false): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memory));

    // A transient empty identity must never erase a valid persistent profile.
    // Explicit memory deletion can opt into clearing the profile.
    const existingProfileRaw = localStorage.getItem(PROFILE_STORAGE_KEY);
    const existingProfile = existingProfileRaw ? JSON.parse(existingProfileRaw) : {};

    const profile = {
      userName:
        clearProfileOnEmpty
          ? (memory.userName || '')
          : (typeof memory.userName === 'string' && memory.userName.trim()
              ? memory.userName
              : typeof existingProfile?.userName === 'string'
                ? existingProfile.userName
                : ''),
      userCity:
        clearProfileOnEmpty
          ? (memory.userCity || '')
          : (typeof memory.userCity === 'string' && memory.userCity.trim()
              ? memory.userCity
              : typeof existingProfile?.userCity === 'string'
                ? existingProfile.userCity
                : ''),
    };

    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch (err) {
    console.error('[ActionExecutor] Failed to save UserMemory:', err);
    return false;
  }
}

/**
 * Executes a resolved action deterministically and strictly verifies the outcome.
 *
 * CRITICAL RULE - NEVER FALSE SUCCESS:
 * Returns success: true ONLY if the underlying storage/operation has been verified.
 * Returns success: false if execution fails, target does not exist, or verification fails.
 */
export function executeAction(
  resolution: RouterResolution,
  context?: ActionExecutorContext
): ActionResult {
  const { actionType, status, payload } = resolution;

  // 1. Safety Guard: Ambiguous input must never execute
  if (status === 'AMBIGUOUS_INPUT') {
    return {
      success: false,
      actionType,
      feedbackText: resolution.clarificationMessage || 'Richiesta ambigua. Specifica meglio i dettagli.',
      sourceLabel: 'router',
      dataAffected: false,
      error: 'AMBIGUOUS_INPUT: Refusing execution due to ambiguity',
    };
  }

  // 2. Safety Guard: Destructive actions requiring confirmation must not execute in this phase
  if (status === 'CONFIRMATION_REQUIRED') {
    return {
      success: false,
      actionType,
      feedbackText: resolution.confirmationPrompt || 'Azione distruttiva: conferma richiesta prima dell\'esecuzione.',
      sourceLabel: 'router',
      dataAffected: false,
      error: 'CONFIRMATION_REQUIRED: Action blocked until confirmed',
    };
  }

  // 3. Safety Guard: Fallthrough requests belong to Gemini/conversation layer
  if (actionType === 'CHAT_FALLTHROUGH' || status === 'FALLTHROUGH_GEMINI') {
    return {
      success: false,
      actionType: 'CHAT_FALLTHROUGH',
      feedbackText: 'Nessuna azione locale richiesta (destinato al layer conversazionale).',
      sourceLabel: 'router',
      dataAffected: false,
      error: 'FALLTHROUGH_GEMINI: Belongs to conversational layer',
    };
  }

  // =========================================================================
  // NOTES DOMAIN
  // =========================================================================
  switch (actionType) {
    case 'NOTE_CREATE': {
      const noteText = (payload?.parameters?.noteText as string | undefined)?.trim();
      if (!noteText) {
        return {
          success: false,
          actionType: 'NOTE_CREATE',
          feedbackText: 'Cosa vorresti che annotassi?',
          sourceLabel: 'notes',
          dataAffected: false,
          error: 'Missing noteText parameter',
        };
      }

      const currentNotes = loadNotes();
      const newNote: MaiaNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: noteText,
        createdAt: new Date().toISOString(),
      };

      const writeOk = saveNotes([...currentNotes, newNote]);
      if (!writeOk) {
        return {
          success: false,
          actionType: 'NOTE_CREATE',
          feedbackText: 'Impossibile salvare la nota in memoria locale.',
          sourceLabel: 'notes',
          dataAffected: false,
          error: 'saveNotes returned false',
        };
      }

      // VERIFICATION: Verify note actually exists in storage
      const reloadedNotes = loadNotes();
      const verified = reloadedNotes.some((n) => n.id === newNote.id && n.text === newNote.text);
      if (!verified) {
        return {
          success: false,
          actionType: 'NOTE_CREATE',
          feedbackText: 'Verifica fallita: la nota non risulta salvata.',
          sourceLabel: 'notes',
          dataAffected: false,
          error: 'Verification failed: Note not found in storage after write',
        };
      }

      return {
        success: true,
        actionType: 'NOTE_CREATE',
        feedbackText: `Annotato: "${newNote.text}".`,
        sourceLabel: 'notes',
        dataAffected: true,
      };
    }

    case 'NOTE_LIST': {
      const notes = loadNotes();
      if (notes.length === 0) {
        return {
          success: true,
          actionType: 'NOTE_LIST',
          feedbackText: 'Non hai ancora nessuna nota salvata.',
          sourceLabel: 'notes',
          dataAffected: false,
        };
      }

      const listFormatted = notes.map((note, index) => `${index + 1}. ${note.title ? `\"${note.title}\": ` : ''}${note.text}`).join('\n');
      return {
        success: true,
        actionType: 'NOTE_LIST',
        feedbackText: `Ecco le tue note:\n${listFormatted}`,
        sourceLabel: 'notes',
        dataAffected: false,
      };
    }

    case 'NOTE_DELETE': {
      const scope = payload?.parameters?.scope;
      const targetId = payload?.parameters?.matchedNoteId as string | undefined;
      const targetQuery = payload?.parameters?.targetQuery as string | undefined;

      // Case A: Delete all notes
      if (scope === 'all') {
        const currentNotes = loadNotes();
        if (currentNotes.length === 0) {
          return {
            success: false,
            actionType: 'NOTE_DELETE',
            feedbackText: 'Non hai nessuna nota salvata da cancellare.',
            sourceLabel: 'notes',
            dataAffected: false,
            error: 'No notes to delete',
          };
        }

        const writeOk = saveNotes([]);
        if (!writeOk) {
          return {
            success: false,
            actionType: 'NOTE_DELETE',
            feedbackText: 'Errore durante la cancellazione delle note in memoria.',
            sourceLabel: 'notes',
            dataAffected: false,
            error: 'saveNotes([]) returned false',
          };
        }

        // VERIFICATION: Verify storage is indeed empty
        const reloaded = loadNotes();
        if (reloaded.length !== 0) {
          return {
            success: false,
            actionType: 'NOTE_DELETE',
            feedbackText: 'Verifica fallita: le note risultano ancora presenti.',
            sourceLabel: 'notes',
            dataAffected: false,
            error: 'Verification failed: Notes collection not empty after deletion',
          };
        }

        return {
          success: true,
          actionType: 'NOTE_DELETE',
          feedbackText: 'Ho eliminato tutte le note.',
          sourceLabel: 'notes',
          dataAffected: true,
        };
      }

      // Case B: Delete specific note
      const currentNotes = loadNotes();
      let targetNote: MaiaNote | null = null;

      if (targetId) {
        targetNote = currentNotes.find((n) => n.id === targetId) || null;
      } else if (targetQuery) {
        const matchResult = findMatchingNotes(targetQuery, currentNotes);
        if (matchResult.exactMatch) {
          targetNote = matchResult.exactMatch;
        }
      }

      if (!targetNote) {
        return {
          success: false,
          actionType: 'NOTE_DELETE',
          feedbackText: 'Nota da eliminare non trovata.',
          sourceLabel: 'notes',
          dataAffected: false,
          error: 'Target note not found in storage',
        };
      }

      const remaining = currentNotes.filter((n) => n.id !== targetNote!.id);
      const writeOk = saveNotes(remaining);
      if (!writeOk) {
        return {
          success: false,
          actionType: 'NOTE_DELETE',
          feedbackText: 'Si è verificato un errore durante l\'eliminazione della nota.',
          sourceLabel: 'notes',
          dataAffected: false,
          error: 'saveNotes returned false',
        };
      }

      // VERIFICATION: Verify note no longer exists
      const reloaded = loadNotes();
      const stillExists = reloaded.some((n) => n.id === targetNote!.id);
      if (stillExists || reloaded.length !== currentNotes.length - 1) {
        return {
          success: false,
          actionType: 'NOTE_DELETE',
          feedbackText: 'Verifica fallita: la nota è ancora presente.',
          sourceLabel: 'notes',
          dataAffected: false,
          error: 'Verification failed: Note still present after delete',
        };
      }

      return {
        success: true,
        actionType: 'NOTE_DELETE',
        feedbackText: `Ho eliminato la nota: "${targetNote.text}".`,
        sourceLabel: 'notes',
        dataAffected: true,
      };
    }

    // =========================================================================
    // REMINDERS DOMAIN
    // =========================================================================
    case 'REMINDER_CREATE': {
      const reminderText = payload?.parameters?.reminderText as string | undefined;
      const dueAtStr = payload?.parameters?.dueAt as string | undefined;

      if (!reminderText || !dueAtStr) {
        return {
          success: false,
          actionType: 'REMINDER_CREATE',
          feedbackText: 'Parametri del promemoria non validi o incompleti.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Missing reminderText or dueAt parameter',
        };
      }

      const dueDate = new Date(dueAtStr);
      if (isNaN(dueDate.getTime())) {
        return {
          success: false,
          actionType: 'REMINDER_CREATE',
          feedbackText: 'Data o orario del promemoria non valido.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Invalid dueAt Date',
        };
      }

      const createRes = createReminder(reminderText, dueDate, payload?.rawText);
      if (!createRes.success || !createRes.reminder) {
        return {
          success: false,
          actionType: 'REMINDER_CREATE',
          feedbackText: createRes.error || 'Errore nel salvataggio del promemoria in memoria locale.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: createRes.error || 'createReminder failed',
        };
      }

      // VERIFICATION: Verify reminder exists in storage
      const reloaded = loadReminders();
      const verified = reloaded.some((r) => r.id === createRes.reminder!.id && r.text === reminderText);
      if (!verified) {
        return {
          success: false,
          actionType: 'REMINDER_CREATE',
          feedbackText: 'Verifica fallita: il promemoria non risulta salvato.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Verification failed: Reminder not found in storage after write',
        };
      }

      const timeFormatted = dueDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      const dateFormatted = dueDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });

      return {
        success: true,
        actionType: 'REMINDER_CREATE',
        feedbackText: `Promemoria impostato: "${createRes.reminder.text}" per il ${dateFormatted} alle ${timeFormatted}.`,
        sourceLabel: 'reminders',
        dataAffected: true,
      };
    }

    case 'REMINDER_LIST': {
      const all = loadReminders();
      const active = all.filter((r) => !r.completed);

      if (active.length === 0) {
        return {
          success: true,
          actionType: 'REMINDER_LIST',
          feedbackText: 'Non hai nessun promemoria attivo al momento.',
          sourceLabel: 'reminders',
          dataAffected: false,
        };
      }

      const listFormatted = active
        .map((r, i) => {
          const d = new Date(r.dueAt);
          const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
          const dt = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
          return `${i + 1}. "${r.text}" (scadenza: ${dt} alle ${t})`;
        })
        .join('\n');

      return {
        success: true,
        actionType: 'REMINDER_LIST',
        feedbackText: `Ecco i tuoi promemoria attivi:\n${listFormatted}`,
        sourceLabel: 'reminders',
        dataAffected: false,
      };
    }

    case 'REMINDER_COMPLETE': {
      const targetId = payload?.parameters?.matchedReminderId as string | undefined;
      const targetQuery = payload?.parameters?.targetQuery as string | undefined;

      const current = loadReminders();
      let targetReminder: MaiaReminder | null = null;

      if (targetId) {
        targetReminder = current.find((r) => r.id === targetId) || null;
      } else if (targetQuery) {
        const matchRes = findMatchingReminders(targetQuery, current);
        if (matchRes.exactMatch) {
          targetReminder = matchRes.exactMatch;
        }
      }

      if (!targetReminder) {
        return {
          success: false,
          actionType: 'REMINDER_COMPLETE',
          feedbackText: 'Promemoria da completare non trovato.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Target reminder not found in storage',
        };
      }

      // Idempotency: Check if already completed
      if (targetReminder.completed) {
        return {
          success: false,
          actionType: 'REMINDER_COMPLETE',
          feedbackText: `Il promemoria "${targetReminder.text}" era già segnato come completato.`,
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Reminder already completed',
        };
      }

      const completedOk = completeReminder(targetReminder.id, true);
      if (!completedOk) {
        return {
          success: false,
          actionType: 'REMINDER_COMPLETE',
          feedbackText: 'Si è verificato un errore durante l\'aggiornamento del promemoria.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'completeReminder returned false',
        };
      }

      // VERIFICATION: Verify completed flag is indeed true
      const reloaded = loadReminders();
      const verified = reloaded.find((r) => r.id === targetReminder!.id);
      if (!verified || verified.completed !== true) {
        return {
          success: false,
          actionType: 'REMINDER_COMPLETE',
          feedbackText: 'Verifica fallita: lo stato del promemoria non risulta aggiornato.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Verification failed: completed flag is not true in storage',
        };
      }

      return {
        success: true,
        actionType: 'REMINDER_COMPLETE',
        feedbackText: `Ho segnato come completato il promemoria: "${targetReminder.text}".`,
        sourceLabel: 'reminders',
        dataAffected: true,
      };
    }

    case 'REMINDER_DELETE': {
      const scope = payload?.parameters?.scope;
      const targetId = payload?.parameters?.matchedReminderId as string | undefined;
      const targetQuery = payload?.parameters?.targetQuery as string | undefined;

      // Case A: Delete all reminders
      if (scope === 'all') {
        const currentReminders = loadReminders();
        if (currentReminders.length === 0) {
          return {
            success: false,
            actionType: 'REMINDER_DELETE',
            feedbackText: 'Non hai nessun promemoria salvato da cancellare.',
            sourceLabel: 'reminders',
            dataAffected: false,
            error: 'No reminders to delete',
          };
        }

        const writeOk = saveReminders([]);
        if (!writeOk) {
          return {
            success: false,
            actionType: 'REMINDER_DELETE',
            feedbackText: 'Errore durante la cancellazione dei promemoria in memoria locale.',
            sourceLabel: 'reminders',
            dataAffected: false,
            error: 'saveReminders([]) returned false',
          };
        }

        // VERIFICATION: Verify storage is empty
        const reloaded = loadReminders();
        if (reloaded.length !== 0) {
          return {
            success: false,
            actionType: 'REMINDER_DELETE',
            feedbackText: 'Verifica fallita: i promemoria risultano ancora presenti.',
            sourceLabel: 'reminders',
            dataAffected: false,
            error: 'Verification failed: Reminders not empty after deletion',
          };
        }

        return {
          success: true,
          actionType: 'REMINDER_DELETE',
          feedbackText: 'Ho eliminato tutti i promemoria.',
          sourceLabel: 'reminders',
          dataAffected: true,
        };
      }

      // Case B: Delete specific reminder
      const currentReminders = loadReminders();
      let targetReminder: MaiaReminder | null = null;

      if (targetId) {
        targetReminder = currentReminders.find((r) => r.id === targetId) || null;
      } else if (targetQuery) {
        const matchRes = findMatchingReminders(targetQuery, currentReminders);
        if (matchRes.exactMatch) {
          targetReminder = matchRes.exactMatch;
        }
      }

      if (!targetReminder) {
        return {
          success: false,
          actionType: 'REMINDER_DELETE',
          feedbackText: 'Promemoria da eliminare non trovato.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Target reminder not found in storage',
        };
      }

      const deletedOk = deleteReminder(targetReminder.id);
      if (!deletedOk) {
        return {
          success: false,
          actionType: 'REMINDER_DELETE',
          feedbackText: 'Si è verificato un errore durante l\'eliminazione del promemoria.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'deleteReminder returned false',
        };
      }

      // VERIFICATION: Verify reminder no longer exists
      const reloaded = loadReminders();
      const stillExists = reloaded.some((r) => r.id === targetReminder!.id);
      if (stillExists || reloaded.length !== currentReminders.length - 1) {
        return {
          success: false,
          actionType: 'REMINDER_DELETE',
          feedbackText: 'Verifica fallita: il promemoria risulta ancora presente.',
          sourceLabel: 'reminders',
          dataAffected: false,
          error: 'Verification failed: Reminder still present after delete',
        };
      }

      return {
        success: true,
        actionType: 'REMINDER_DELETE',
        feedbackText: `Ho eliminato il promemoria: "${targetReminder.text}".`,
        sourceLabel: 'reminders',
        dataAffected: true,
      };
    }

    // =========================================================================
    // USER MEMORY DOMAIN
    // =========================================================================
    case 'MEMORY_SAVE': {
      const rawText = payload?.rawText || '';
      const currentMem = context?.memory ?? loadUserMemory();
      const memRes = handleMemoryCommand(rawText, currentMem);

      if (memRes.isCommand && memRes.updatedMemory) {
        const saveOk = saveUserMemory(memRes.updatedMemory);
        if (!saveOk) {
          return {
            success: false,
            actionType: 'MEMORY_SAVE',
            feedbackText: 'Errore durante il salvataggio delle informazioni nella memoria.',
            sourceLabel: 'memory',
            dataAffected: false,
            error: 'saveUserMemory returned false',
          };
        }

        // VERIFICATION: Verify new memory content in storage
        const reloaded = loadUserMemory();
        let verified = false;
        if (memRes.category === 'userName') {
          verified = reloaded.userName === memRes.updatedMemory.userName;
        } else if (memRes.category === 'userCity') {
          verified = reloaded.userCity === memRes.updatedMemory.userCity;
        } else if (memRes.category && Array.isArray(reloaded[memRes.category])) {
          const list = reloaded[memRes.category] as string[];
          verified = memRes.item ? list.includes(memRes.item) : true;
        } else {
          verified = true;
        }

        if (!verified) {
          return {
            success: false,
            actionType: 'MEMORY_SAVE',
            feedbackText: 'Verifica fallita: l\'informazione non risulta salvata nella memoria.',
            sourceLabel: 'memory',
            dataAffected: false,
            error: 'Verification failed: Memory item not found after save',
          };
        }

        return {
          success: true,
          actionType: 'MEMORY_SAVE',
          feedbackText: memRes.reply || 'Memorizzato.',
          sourceLabel: 'memory',
          dataAffected: true,
        };
      }

      if (memRes.status === 'duplicate') {
        return {
          success: true,
          actionType: 'MEMORY_SAVE',
          feedbackText: memRes.reply || 'Lo so già! Queste informazioni sono già presenti nella mia memoria.',
          sourceLabel: 'memory',
          dataAffected: false,
        };
      }

      return {
        success: false,
        actionType: 'MEMORY_SAVE',
        feedbackText: memRes.reply || 'Non sono riuscita a memorizzare questa informazione.',
        sourceLabel: 'memory',
        dataAffected: false,
        error: 'Memory command did not produce an update',
      };
    }

    case 'MEMORY_QUERY': {
      const currentMem = context?.memory ?? loadUserMemory();
      const memRes = handleMemoryCommand('cosa ricordi di me', currentMem);
      return {
        success: true,
        actionType: 'MEMORY_QUERY',
        feedbackText: memRes.reply || 'Nessuna informazione personale salvata al momento.',
        sourceLabel: 'memory',
        dataAffected: false,
      };
    }

    case 'MEMORY_DELETE': {
      const rawText = payload?.rawText || '';
      const currentMem = context?.memory ?? loadUserMemory();
      const profileField = payload?.parameters?.profileField as 'userName' | 'userCity' | undefined;
      const memRes = profileField
        ? {
            isCommand: true,
            action: 'forget' as const,
            category: profileField,
            item: currentMem[profileField] || undefined,
            updatedMemory: { ...currentMem, [profileField]: '' },
            reply: `Ho dimenticato ${profileField === 'userName' ? 'il tuo nome' : 'la tua città'}.`,
          }
        : handleMemoryCommand(rawText, currentMem);

      if (memRes.isCommand && memRes.action === 'forget' && memRes.updatedMemory) {
        const saveOk = saveUserMemory(memRes.updatedMemory, Boolean(profileField));
        if (!saveOk) {
          return {
            success: false,
            actionType: 'MEMORY_DELETE',
            feedbackText: 'Errore durante la rimozione dell\'informazione dalla memoria.',
            sourceLabel: 'memory',
            dataAffected: false,
            error: 'saveUserMemory returned false',
          };
        }

        // VERIFICATION: Verify item is actually gone
        const reloaded = loadUserMemory();
        let stillPresent = false;
        if (memRes.category === 'userName') {
          stillPresent = Boolean(reloaded.userName);
        } else if (memRes.category === 'userCity') {
          stillPresent = Boolean(reloaded.userCity);
        } else if (memRes.category && Array.isArray(reloaded[memRes.category])) {
          const list = reloaded[memRes.category] as string[];
          stillPresent = memRes.item ? list.includes(memRes.item) : false;
        }

        if (stillPresent) {
          return {
            success: false,
            actionType: 'MEMORY_DELETE',
            feedbackText: 'Verifica fallita: l\'informazione risulta ancora presente nella memoria.',
            sourceLabel: 'memory',
            dataAffected: false,
            error: 'Verification failed: Memory item still present after deletion',
          };
        }

        return {
          success: true,
          actionType: 'MEMORY_DELETE',
          feedbackText: memRes.reply || 'Informazione rimossa dalla memoria.',
          sourceLabel: 'memory',
          dataAffected: true,
        };
      }

      if (memRes.status === 'not_found') {
        return {
          success: false,
          actionType: 'MEMORY_DELETE',
          feedbackText: memRes.reply || 'Informazione non trovata nella memoria.',
          sourceLabel: 'memory',
          dataAffected: false,
          error: 'Memory item not found',
        };
      }

      return {
        success: false,
        actionType: 'MEMORY_DELETE',
        feedbackText: memRes.reply || 'Nessuna informazione eliminata.',
        sourceLabel: 'memory',
        dataAffected: false,
        error: 'handleMemoryCommand did not produce a forget action',
      };
    }

    // =========================================================================
    // EXTERNAL TOOL / WEB SEARCH
    // =========================================================================
    case 'WEB_SEARCH': {
      return {
        success: false,
        actionType: 'WEB_SEARCH',
        feedbackText: 'La ricerca web richiede l\'esecuzione asincrona tramite executeActionAsync.',
        sourceLabel: 'web-search',
        dataAffected: false,
        error: 'WEB_SEARCH_REQUIRES_ASYNC',
      };
    }

    // =========================================================================
    // UNSUPPORTED / FUTURE ACTIONS
    // =========================================================================
    default: {
      return {
        success: false,
        actionType,
        feedbackText: `Azione non ancora supportata in questa versione (${actionType}).`,
        sourceLabel: 'router',
        dataAffected: false,
        error: `UNSUPPORTED_ACTION: ${actionType} is not implemented in Phase 2`,
      };
    }
  }
}

/**
 * Asynchronously executes an action resolution.
 * Delegates WEB_SEARCH to the external webSearchService, while preserving
 * synchronous local execution and verification for Notes, Reminders, and Memory.
 */
export async function executeActionAsync(
  resolution: RouterResolution,
  context?: ActionExecutorContext
): Promise<ActionResult> {
  if (resolution.actionType === 'WEB_SEARCH') {
    const rawQuery =
      (resolution.payload?.parameters?.searchQuery as string) ||
      resolution.payload?.rawText ||
      '';
    const category = resolution.payload?.parameters?.category as any;

    const searchResult = await executeWebSearch({
      searchQuery: rawQuery,
      category,
    });

    if (!searchResult.success) {
      return {
        success: false,
        actionType: 'WEB_SEARCH',
        feedbackText: searchResult.summary,
        sourceLabel: 'web-search',
        dataAffected: false,
        error: searchResult.error,
      };
    }

    return {
      success: true,
      actionType: 'WEB_SEARCH',
      feedbackText: searchResult.summary,
      sourceLabel: 'web-search',
      dataAffected: false,
    };
  }

  // Delegate all deterministic local actions to the synchronous executeAction
  return executeAction(resolution, context);
}
