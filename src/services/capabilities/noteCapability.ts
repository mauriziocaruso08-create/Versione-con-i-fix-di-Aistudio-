import {
  SemanticIntent,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import { MaiaNote } from '../../types';
import { loadNotes, saveNotes } from '../../utils/notesManager';
import { TargetResolutionResult } from '../router/targetResolver';
import { MaiaCapability } from './types';

export class NoteCapability implements MaiaCapability {
  readonly entity = 'NOTE' as const;
  readonly supportedVerbs = ['CREATE', 'READ', 'UPDATE', 'DELETE'] as const;

  canHandle(intent: SemanticIntent): boolean {
    return intent.entity === 'NOTE';
  }

  async execute(
    intent: SemanticIntent,
    _context: SessionContext,
    target?: TargetResolutionResult
  ): Promise<VerifiedActionResult> {
    switch (intent.verb) {
      case 'CREATE': {
        const rawText = intent.parameters.text?.trim();
        const title = typeof intent.parameters.title === 'string' ? intent.parameters.title.trim() : '';
        if (!rawText) {
          return {
            status: 'AMBIGUOUS',
            entity: 'NOTE',
            verb: 'CREATE',
            feedbackText: 'Cosa vorresti appuntare nella nota?',
            clarificationPrompt: 'Cosa vorresti appuntare nella nota?',
            dataAffected: false,
          };
        }

        const currentNotes = loadNotes();
        const newNote: MaiaNote = {
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ...(title ? { title } : {}),
          text: rawText,
          createdAt: new Date().toISOString(),
        };

        const saveSuccess = saveNotes([...currentNotes, newNote]);
        // DO -> VERIFY -> REPORT
        const after = loadNotes();
        const verified = saveSuccess && after.some((n) => n.id === newNote.id);

        if (verified) {
          return {
            status: 'SUCCESS',
            entity: 'NOTE',
            verb: 'CREATE',
            feedbackText: title
              ? `Nota "${title}" salvata: "${rawText}".`
              : `Nota salvata: "${rawText}".`,
            dataAffected: true,
            affectedId: newNote.id,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'NOTE',
          verb: 'CREATE',
          feedbackText: 'Errore: non è stato possibile salvare la nota.',
          dataAffected: false,
          error: 'Verification failed: note not found in storage after write',
        };
      }

      case 'READ': {
        const notes = loadNotes();
        if (notes.length === 0) {
          return {
            status: 'SUCCESS',
            entity: 'NOTE',
            verb: 'READ',
            feedbackText: 'Non hai ancora salvato nessuna nota.',
            dataAffected: false,
            affectedCount: 0,
          };
        }

        if (target?.resolvedId) {
          const matched = notes.find((n) => n.id === target.resolvedId);
          if (matched) {
            return {
              status: 'SUCCESS',
              entity: 'NOTE',
              verb: 'READ',
              feedbackText: matched.title
                ? `Ecco la nota "${matched.title}": "${matched.text}".`
                : `Ecco il contenuto della nota: "${matched.text}".`,
              dataAffected: false,
              affectedId: matched.id,
              affectedCount: 1,
            };
          }
        }

        const formatted = notes
          .map((n, i) => `${i + 1}. ${n.title ? `\"${n.title}\": ` : ''}${n.text}`)
          .join('\n');

        return {
          status: 'SUCCESS',
          entity: 'NOTE',
          verb: 'READ',
          feedbackText: `Ecco le tue note:\n${formatted}`,
          dataAffected: false,
          affectedCount: notes.length,
        };
      }

      case 'DELETE': {
        const notes = loadNotes();
        if (notes.length === 0) {
          return {
            status: 'NOT_FOUND',
            entity: 'NOTE',
            verb: 'DELETE',
            feedbackText: 'Non ci sono note da eliminare.',
            dataAffected: false,
            affectedCount: 0,
          };
        }

        // Scope ALL
        if (target?.scope === 'ALL') {
          const count = notes.length;
          const saveSuccess = saveNotes([]);
          // Verification
          const after = loadNotes();
          const verified = saveSuccess && after.length === 0;

          if (verified) {
            return {
              status: 'SUCCESS',
              entity: 'NOTE',
              verb: 'DELETE',
              feedbackText: 'Tutte le note sono state eliminate.',
              dataAffected: true,
              affectedCount: count,
            };
          }

          return {
            status: 'FAILURE',
            entity: 'NOTE',
            verb: 'DELETE',
            feedbackText: 'Errore durante l\'eliminazione delle note.',
            dataAffected: false,
            error: 'Verification failed: notes list is not empty after clear',
          };
        }

        // Single target
        if (target?.resolvedId) {
          const targetId = target.resolvedId;
          const targetNote = notes.find((n) => n.id === targetId);
          const remaining = notes.filter((n) => n.id !== targetId);
          const saveSuccess = saveNotes(remaining);
          // Verification
          const after = loadNotes();
          const verified = saveSuccess && !after.some((n) => n.id === targetId);

          if (verified) {
            const summary = targetNote?.text || target.matchedText || targetId;
            return {
              status: 'SUCCESS',
              entity: 'NOTE',
              verb: 'DELETE',
              feedbackText: `Nota eliminata: "${summary}".`,
              dataAffected: true,
              affectedId: targetId,
            };
          }

          return {
            status: 'FAILURE',
            entity: 'NOTE',
            verb: 'DELETE',
            feedbackText: 'Errore durante l\'eliminazione della nota.',
            dataAffected: false,
            error: 'Verification failed: note still present after delete attempt',
          };
        }

        return {
          status: 'NOT_FOUND',
          entity: 'NOTE',
          verb: 'DELETE',
          feedbackText: 'Nessuna nota trovata corrispondente alla richiesta.',
          dataAffected: false,
        };
      }

      case 'UPDATE': {
        const targetId = target?.resolvedId;
        if (!targetId) {
          return {
            status: target?.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'AMBIGUOUS',
            entity: 'NOTE',
            verb: 'UPDATE',
            feedbackText:
              target?.clarificationPrompt || 'Quale nota vuoi modificare?',
            clarificationPrompt:
              target?.clarificationPrompt || 'Quale nota vuoi modificare?',
            dataAffected: false,
          };
        }

        const newText = intent.parameters.newText?.trim();
        const newTitle = typeof intent.parameters.title === 'string' ? intent.parameters.title.trim() : undefined;
        const updateMode = intent.parameters.updateMode || 'REPLACE';
        if (!newText) {
          return {
            status: 'AMBIGUOUS',
            entity: 'NOTE',
            verb: 'UPDATE',
            feedbackText: 'Quale nuovo testo vuoi inserire nella nota?',
            clarificationPrompt: 'Quale nuovo testo vuoi inserire nella nota?',
            dataAffected: false,
          };
        }

        const notes = loadNotes();
        const noteItem = notes.find((n) => n.id === targetId);
        if (!noteItem) {
          return {
            status: 'NOT_FOUND',
            entity: 'NOTE',
            verb: 'UPDATE',
            feedbackText: 'Nota non trovata.',
            dataAffected: false,
          };
        }

        const updatedList = notes.map((n) =>
          n.id === targetId
            ? {
                ...n,
                text: updateMode === 'APPEND' ? `${n.text}; ${newText}`.trim() : newText,
                ...(newTitle ? { title: newTitle } : {}),
              }
            : n
        );
        const expectedText = updateMode === 'APPEND' ? `${noteItem.text}; ${newText}`.trim() : newText;
        const saveOk = saveNotes(updatedList);

        // DO -> VERIFY -> REPORT
        const after = loadNotes();
        const verifiedItem = after.find((n) => n.id === targetId);
        const verified = saveOk && verifiedItem?.text === expectedText &&
          verifiedItem?.title === (newTitle || noteItem.title);

        if (verified) {
          return {
            status: 'SUCCESS',
            entity: 'NOTE',
            verb: 'UPDATE',
            feedbackText: updateMode === 'APPEND'
              ? `Nota aggiornata: aggiunto "${newText}".`
              : `Nota aggiornata in: "${newText}".`,
            dataAffected: true,
            affectedId: targetId,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'NOTE',
          verb: 'UPDATE',
          feedbackText: 'Errore durante la modifica della nota.',
          dataAffected: false,
          error: 'Verification failed: note not updated in storage',
        };
      }

      default:
        return {
          status: 'UNSUPPORTED',
          entity: 'NOTE',
          verb: intent.verb,
          feedbackText: `Operazione ${intent.verb} non supportata per le note.`,
          dataAffected: false,
        };
    }
  }
}
