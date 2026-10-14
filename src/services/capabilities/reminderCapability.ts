import {
  SemanticIntent,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import {
  createReminder,
  deleteReminder,
  completeReminder,
  loadReminders,
  saveReminders,
  formatFriendlyDueTime,
  parseItalianReminder,
} from '../../utils/reminderManager';
import { TargetResolutionResult } from '../router/targetResolver';
import { MaiaCapability } from './types';

export class ReminderCapability implements MaiaCapability {
  readonly entity = 'REMINDER' as const;
  readonly supportedVerbs = ['CREATE', 'READ', 'UPDATE', 'COMPLETE', 'DELETE'] as const;

  canHandle(intent: SemanticIntent): boolean {
    return intent.entity === 'REMINDER';
  }

  async execute(
    intent: SemanticIntent,
    _context: SessionContext,
    target?: TargetResolutionResult
  ): Promise<VerifiedActionResult> {
    switch (intent.verb) {
      case 'CREATE': {
        // Fallback to low-level parser as utility if parameters not fully populated
        let text = intent.parameters.text?.trim();
        let dueAtStr = intent.parameters.dueAt;

        // Always inspect the original request, even when the classifier already
        // extracted the reminder text. Date-only phrases must not inherit the
        // parser's legacy 09:00 default or bypass its clarification response.
        const parsed = parseItalianReminder(intent.rawQuery);
        if (parsed.isReminderIntent && parsed.ambiguous && parsed.clarification && !dueAtStr) {
          return {
            status: 'AMBIGUOUS',
            entity: 'REMINDER',
            verb: 'CREATE',
            feedbackText: parsed.clarification,
            clarificationPrompt: parsed.clarification,
            dataAffected: false,
          };
        }
        if (!text && parsed.isReminderIntent && parsed.reminderText) text = parsed.reminderText;
        if (!dueAtStr && parsed.isReminderIntent && parsed.dueAt) dueAtStr = parsed.dueAt.toISOString();

        if (!text) {
          return {
            status: 'AMBIGUOUS',
            entity: 'REMINDER',
            verb: 'CREATE',
            feedbackText: 'Cosa vorresti che ti ricordi?',
            clarificationPrompt: 'Cosa vorresti che ti ricordi?',
            dataAffected: false,
          };
        }

        // Never silently invent a reminder time. If the user did not provide
        // a resolvable time, ask instead of scheduling an unexpected reminder.
        if (!dueAtStr) {
          return {
            status: 'AMBIGUOUS',
            entity: 'REMINDER',
            verb: 'CREATE',
            feedbackText: 'Quando vuoi che te lo ricordi?',
            clarificationPrompt: "Quando vuoi che te lo ricordi? Ad esempio: “alle 20”, “domani alle 9” o “tra mezz'ora”.",
            dataAffected: false,
          };
        }

        const finalDueAt = new Date(dueAtStr);
        if (Number.isNaN(finalDueAt.getTime()) || finalDueAt.getTime() <= Date.now()) {
          return {
            status: 'AMBIGUOUS',
            entity: 'REMINDER',
            verb: 'CREATE',
            feedbackText: "L'orario del promemoria non è valido o è già passato.",
            clarificationPrompt: 'Indicami un orario futuro, per esempio “domani alle 9”.',
            dataAffected: false,
          };
        }

        const created = createReminder(text, finalDueAt, intent.rawQuery);
        if (!created.success || !created.reminder) {
          return {
            status: 'FAILURE',
            entity: 'REMINDER',
            verb: 'CREATE',
            feedbackText: created.error || 'Impossibile creare il promemoria.',
            dataAffected: false,
            error: created.error,
          };
        }

        // Verification (DO -> VERIFY -> REPORT)
        const after = loadReminders();
        const verified = after.some((r) => r.id === created.reminder!.id);

        if (verified) {
          const timeFormatted = formatFriendlyDueTime(created.reminder.dueAt);
          return {
            status: 'SUCCESS',
            entity: 'REMINDER',
            verb: 'CREATE',
            feedbackText: created.duplicate
              ? `Esiste già un promemoria uguale: "${created.reminder.text}" (${timeFormatted}). Non ne ho creato un duplicato.`
              : `Promemoria impostato: "${created.reminder.text}" per ${timeFormatted}.`,
            dataAffected: !created.duplicate,
            affectedId: created.reminder.id,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'REMINDER',
          verb: 'CREATE',
          feedbackText: 'Errore: promemoria non verificato nel database locale.',
          dataAffected: false,
          error: 'Verification failed: reminder not found in storage after write',
        };
      }

      case 'READ': {
        const allReminders = loadReminders();
        const wantsCompleted = /\b(?:completat[ioe]|fatti|conclusi|terminati)\b/i.test(intent.rawQuery);
        const wantsActive = /\b(?:attivi|attivo|da\s+fare|pendenti)\b/i.test(intent.rawQuery);
        const reminders = wantsCompleted
          ? allReminders.filter((r) => r.completed)
          : wantsActive ? allReminders.filter((r) => !r.completed) : allReminders;
        if (reminders.length === 0) {
          return {
            status: 'SUCCESS',
            entity: 'REMINDER',
            verb: 'READ',
            feedbackText: wantsCompleted ? 'Non hai promemoria completati.' : 'Non hai promemoria attivi al momento.',
            dataAffected: false,
            affectedCount: 0,
          };
        }

        if (target?.resolvedId) {
          const matched = reminders.find((r) => r.id === target.resolvedId);
          if (matched) {
            const timeStr = formatFriendlyDueTime(matched.dueAt);
            const statusIcon = matched.completed ? '✓' : '⏰';
            return {
              status: 'SUCCESS',
              entity: 'REMINDER',
              verb: 'READ',
              feedbackText: `Ecco il promemoria: [${statusIcon}] "${matched.text}" (${timeStr}).`,
              dataAffected: false,
              affectedId: matched.id,
              affectedCount: 1,
            };
          }
        }

        const formatted = reminders
          .map((r, i) => {
            const timeStr = formatFriendlyDueTime(r.dueAt);
            const statusIcon = r.completed ? '✓' : '⏰';
            return `${i + 1}. [${statusIcon}] ${r.text} (${timeStr})`;
          })
          .join('\n');

        const isSingular =
          reminders.length === 1 &&
          (intent.target.rawReference?.toLowerCase().includes('il') || target?.scope === 'SINGLE');
        const header = isSingular ? 'Ecco il tuo promemoria:' : 'Ecco i tuoi promemoria:';

        return {
          status: 'SUCCESS',
          entity: 'REMINDER',
          verb: 'READ',
          feedbackText: `${header}\n${formatted}`,
          dataAffected: false,
          affectedCount: reminders.length,
        };
      }

      case 'COMPLETE': {
        if (!target?.resolvedId) {
          return {
            status: 'NOT_FOUND',
            entity: 'REMINDER',
            verb: 'COMPLETE',
            feedbackText: 'Nessun promemoria trovato da completare.',
            dataAffected: false,
          };
        }

        const targetId = target.resolvedId;
        const success = completeReminder(targetId, true);
        if (!success) {
          return {
            status: 'FAILURE',
            entity: 'REMINDER',
            verb: 'COMPLETE',
            feedbackText: 'Impossibile completare il promemoria.',
            dataAffected: false,
          };
        }

        // Verification
        const after = loadReminders();
        const updatedItem = after.find((r) => r.id === targetId);
        const verified = updatedItem?.completed === true;

        if (verified) {
          return {
            status: 'SUCCESS',
            entity: 'REMINDER',
            verb: 'COMPLETE',
            feedbackText: `Promemoria completato: "${updatedItem?.text || target.matchedText}".`,
            dataAffected: true,
            affectedId: targetId,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'REMINDER',
          verb: 'COMPLETE',
          feedbackText: 'Errore di verifica durante il completamento del promemoria.',
          dataAffected: false,
        };
      }

      case 'DELETE': {
        const reminders = loadReminders();
        if (reminders.length === 0) {
          return {
            status: 'NOT_FOUND',
            entity: 'REMINDER',
            verb: 'DELETE',
            feedbackText: 'Non ci sono promemoria da eliminare.',
            dataAffected: false,
            affectedCount: 0,
          };
        }

        // Scope ALL
        if (target?.scope === 'ALL') {
          const remindersBefore = loadReminders();
          const originalIds = new Set(remindersBefore.map((r) => r.id));
          const count = remindersBefore.length;

          const saveOk = saveReminders([]);
          const after = loadReminders();
          const remainingOriginal = after.filter((r) => originalIds.has(r.id));
          const verified = saveOk && remainingOriginal.length === 0;

          if (verified) {
            const actualDeletedCount = count - remainingOriginal.length;
            return {
              status: 'SUCCESS',
              entity: 'REMINDER',
              verb: 'DELETE',
              feedbackText: `Eliminati ${actualDeletedCount} promemoria.`,
              dataAffected: actualDeletedCount > 0,
              affectedCount: actualDeletedCount,
            };
          }

          return {
            status: 'FAILURE',
            entity: 'REMINDER',
            verb: 'DELETE',
            feedbackText: 'Errore durante l\'eliminazione dei promemoria.',
            dataAffected: false,
          };
        }

        // Single target
        if (target?.resolvedId) {
          const targetId = target.resolvedId;
          const targetItem = reminders.find((r) => r.id === targetId);
          const success = deleteReminder(targetId);
          // Verification
          const after = loadReminders();
          const verified = success && !after.some((r) => r.id === targetId);

          if (verified) {
            const summary = targetItem?.text || target.matchedText || targetId;
            return {
              status: 'SUCCESS',
              entity: 'REMINDER',
              verb: 'DELETE',
              feedbackText: `Promemoria eliminato: "${summary}".`,
              dataAffected: true,
              affectedId: targetId,
            };
          }

          return {
            status: 'FAILURE',
            entity: 'REMINDER',
            verb: 'DELETE',
            feedbackText: 'Errore di verifica durante l\'eliminazione del promemoria.',
            dataAffected: false,
          };
        }

        return {
          status: 'NOT_FOUND',
          entity: 'REMINDER',
          verb: 'DELETE',
          feedbackText: 'Nessun promemoria trovato corrispondente alla richiesta.',
          dataAffected: false,
        };
      }

      case 'UPDATE': {
        const targetId = target?.resolvedId;
        if (!targetId) {
          return {
            status: target?.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'AMBIGUOUS',
            entity: 'REMINDER',
            verb: 'UPDATE',
            feedbackText:
              target?.clarificationPrompt ||
              'Quale promemoria vuoi spostare o modificare?',
            clarificationPrompt: target?.clarificationPrompt,
            dataAffected: false,
          };
        }

        const newText = intent.parameters.newText?.trim();
        const updateMode = intent.parameters.updateMode || 'REPLACE';
        const dueAt = intent.parameters.dueAt;
        const timeShiftMinutes = intent.parameters.timeShiftMinutes;

        if (!newText && !dueAt && timeShiftMinutes === undefined) {
          return {
            status: 'AMBIGUOUS',
            entity: 'REMINDER',
            verb: 'UPDATE',
            feedbackText:
              'Cosa vorresti modificare del promemoria? Puoi specificare un nuovo orario o un nuovo testo.',
            clarificationPrompt:
              'Cosa vorresti modificare del promemoria?',
            dataAffected: false,
          };
        }

        const reminders = loadReminders();
        const item = reminders.find((r) => r.id === targetId);
        if (!item) {
          return {
            status: 'NOT_FOUND',
            entity: 'REMINDER',
            verb: 'UPDATE',
            feedbackText: 'Promemoria non trovato.',
            dataAffected: false,
          };
        }

        let updatedText = item.text;
        if (newText) {
          updatedText = updateMode === 'APPEND' ? `${item.text}; ${newText}`.trim() : newText;
        }

        let updatedDueAt = item.dueAt;
        if (timeShiftMinutes !== undefined) {
          const currentDueDate = new Date(item.dueAt);
          const newTime = currentDueDate.getTime() + timeShiftMinutes * 60 * 1000;
          updatedDueAt = new Date(newTime).toISOString();
        } else if (dueAt) {
          updatedDueAt = new Date(dueAt).toISOString();
        }

        const updatedList = reminders.map((r) =>
          r.id === targetId
            ? { ...r, text: updatedText, dueAt: updatedDueAt, notified: false }
            : r
        );

        const saveSuccess = saveReminders(updatedList);
        // DO -> VERIFY -> REPORT
        const after = loadReminders();
        const verifiedItem = after.find((r) => r.id === targetId);
        const textOk = !newText || verifiedItem?.text === updatedText;
        const dateOk =
          (dueAt === undefined && timeShiftMinutes === undefined) ||
          verifiedItem?.dueAt === updatedDueAt;
        const verified = saveSuccess && verifiedItem && textOk && dateOk;

        if (verified) {
          const timeFormatted = formatFriendlyDueTime(updatedDueAt);
          const feedbackText =
            newText && (dueAt || timeShiftMinutes !== undefined)
              ? `Promemoria aggiornato: "${updatedText}" per ${timeFormatted}.`
              : newText
              ? `Testo del promemoria aggiornato in: "${updatedText}".`
              : `Promemoria spostato a ${timeFormatted}.`;

          return {
            status: 'SUCCESS',
            entity: 'REMINDER',
            verb: 'UPDATE',
            feedbackText,
            dataAffected: true,
            affectedId: targetId,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'REMINDER',
          verb: 'UPDATE',
          feedbackText: 'Errore: la modifica del promemoria non è stata salvata.',
          dataAffected: false,
          error: 'Verification failed: reminder not updated in storage',
        };
      }

      default:
        return {
          status: 'UNSUPPORTED',
          entity: 'REMINDER',
          verb: intent.verb,
          feedbackText: `Operazione ${intent.verb} non supportata per i promemoria.`,
          dataAffected: false,
        };
    }
  }
}
