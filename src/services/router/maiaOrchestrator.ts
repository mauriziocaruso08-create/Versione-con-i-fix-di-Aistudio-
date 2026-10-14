import {
  getContext,
  setActiveEntity,
  setCurrentTopic,
  setDisplayedItems,
  setLastSuccessfulAction,
  setLastWebSearch,
  setPendingAction,
  setPendingClarification,
  setPendingPreferenceCandidate,
  setSelectedItem,
} from '../context/sessionContext';
import {
  extractRelativeTimeShift,
  extractTargetDateTime,
} from './semanticClassifier';
import { analyzeIntent } from './intentEngine';
import { resolveTarget, TargetResolutionResult } from './targetResolver';
import { capabilityRegistry } from '../capabilities/capabilityRegistry';
import { evaluateSafety } from './safetyGuard';
import {
  createPendingConfirmation,
  resolveConfirmationReply,
} from './confirmationManager';
import { loadReminders } from '../../utils/reminderManager';
import { loadNotes } from '../../utils/notesManager';
import { loadUserMemory, saveUserMemory } from './actionExecutor';
import { isConfirmationAffirmative, isConfirmationNegative } from '../../utils/memoryManager';
import { saveOrUpdatePreference } from '../learning/preferenceManager';
import { RouterResolution, WebSearchSource } from '../../types/actions';
import { executeCapabilityWithRecovery } from '../core/verifyRecovery';
import { DisplayedItemRef, SemanticEntity, SemanticIntent, VerifiedActionResult } from '../../types/context';

export type OrchestrationResultType =
  | 'HANDLED_LOCAL'
  | 'CONFIRMATION_REQUIRED'
  | 'FALLTHROUGH_GEMINI';

export interface OrchestrationResult {
  type: OrchestrationResultType;
  feedbackText?: string;
  sourceLabel?: string;
  dataAffected?: boolean;
  affectedEntity?: SemanticEntity;
  rawQuery?: string;
  sources?: WebSearchSource[];
  searchQuery?: string;
}

/**
 * Evaluates whether an input represents a selection from pending clarification candidates.
 * Supports numeric ("1", "2", "3", "numero 2", "la 2", "nota 2"),
 * ordinals ("la prima", "il secondo", "seconda", "terzo", "l'ultimo", "la seconda nota"),
 * and candidate summary keywords.
 */
function matchCandidateSelection(
  rawInput: string,
  candidates: DisplayedItemRef[]
): { matchedCandidate?: DisplayedItemRef; isSelectionAttempt: boolean } {
  const input = rawInput
    .trim()
    .replace(/[.?!;:]+$/, '')
    .trim();

  // Strip leading conversational / action wrappers
  // e.g. "Voglio la seconda", "Scegli la 2", "Prendi il primo", "Modifica la 2", "Cancella la seconda"
  const stripped = input
    .replace(
      /^(?:(?:per\s+favore\s+)?(?:vorrei|voglio|scegli|seleziona|prendi|modifica|cancella|elimina|la\s+scelta\s+[eè]|preferisco|intendo)\s+)+/i,
      ''
    )
    .replace(/[,\s]+(?:per\s+favore|per\s+cortesia|grazie)$/i, '')
    .trim();

  // 1. Numeric selection: "1", "2", "il 2", "la 1", "numero 2", "n. 2", "nota 2", "promemoria 1"
  const numMatch = stripped.match(
    /^(?:(?:il|la|l['’])\s+)?(?:(?:nota|promemoria|opzione|scelta|elemento)\s+)?(?:numero\s+|n[°\.]?\s*)?(\d+)(?:\s+(?:nota|promemoria|opzione|scelta|elemento))?$/i
  );
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    const found = candidates.find((c) => c.index === num) || candidates[num - 1];
    return {
      matchedCandidate: found,
      isSelectionAttempt: true,
    };
  }

  // 2. Ordinal selection: "il primo", "la prima", "primo", "prima", "il secondo", "la seconda", "seconda", "l'ultimo", "la seconda nota"
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

  const ordMatch = stripped.match(
    /^(?:(?:il|la|l['’])\s+)?(?:(?:nota|promemoria|opzione|scelta|elemento)\s+)?(primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta|sesto|sesta|settimo|settima|ottavo|ottava|nono|nona|decimo|decima|ultimo|ultima|1°|1a|2°|2a|3°|3a|4°|4a|5°|5a)(?:\s+(?:nota|promemoria|opzione|scelta|elemento))?$/i
  );
  if (ordMatch) {
    const key = ordMatch[1].toLowerCase();
    const idx = ordinalMap[key];
    if (idx !== undefined) {
      if (idx === -1) {
        return {
          matchedCandidate: candidates[candidates.length - 1],
          isSelectionAttempt: true,
        };
      }
      const found = candidates.find((c) => c.index === idx) || candidates[idx - 1];
      return {
        matchedCandidate: found,
        isSelectionAttempt: true,
      };
    }
  }

  // 3. Text match against candidate summary (e.g. "quella del pane carasau", "pane carasau")
  const cleanSummaryTarget = stripped
    .replace(
      /^(?:quella\s+|quello\s+)?(?:del|dello|della|dei|degli|delle|di|sul|sulla|sullo|sui|sugli|sulle|su|che\s+parla\s+del?l?[aoei']?)\s+/i,
      ''
    )
    .trim()
    .toLowerCase();

  if (cleanSummaryTarget.length >= 3) {
    const matchingCandidates = candidates.filter((c) =>
      c.summary.toLowerCase().includes(cleanSummaryTarget)
    );
    if (matchingCandidates.length === 1) {
      return {
        matchedCandidate: matchingCandidates[0],
        isSelectionAttempt: true,
      };
    }
  }

  return {
    matchedCandidate: undefined,
    isSelectionAttempt: false,
  };
}

/**
 * Central Orchestrator for MAIA Input Processing (Phase 6D).
 *
 * Implements the single authoritative pipeline:
 * USER INPUT
 * → SessionContext
 * → Semantic Intent Engine (6B)
 * → Contextual Target Resolver (6C)
 * → Capability Registry
 * → Capability Execution (DO -> VERIFY -> REPORT)
 * → Context Update
 * → Final Response
 */
export async function orchestrateUserInput(
  query: string,
  now: number = Date.now()
): Promise<OrchestrationResult> {
  const clean = query.trim();
  const context = getContext(now);

  // =========================================================================
  // 1. EVALUATE ACTIVE DESTRUCTIVE CONFIRMATION REPLY (IF ANY)
  // =========================================================================
  const confRes = resolveConfirmationReply(clean, now);
  if (confRes.status === 'NO_PENDING_CONFIRMATION' && !context.pendingClarification && /^(?:annulla|no|stop)$/i.test(clean)) {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText: 'Non c’è nessuna operazione in attesa di conferma.',
      sourceLabel: 'MAIA Safety Guard',
      dataAffected: false,
    };
  }
  if (confRes.status !== 'NO_PENDING_CONFIRMATION') {
    if (confRes.status === 'CONFIRMED' && confRes.resolution) {
      const resolution = confRes.resolution;
      const actionType = resolution.actionType;
      const isAll = resolution.payload?.parameters?.scope === 'all';
      const targetId = resolution.payload?.parameters?.targetId as string | undefined;

      let result: VerifiedActionResult | null = null;

      if (actionType === 'NOTE_DELETE') {
        const noteCap = capabilityRegistry.getCapability('NOTE');
        if (noteCap) {
          result = await executeCapabilityWithRecovery(noteCap, 
            {
              verb: 'DELETE',
              entity: 'NOTE',
              target: isAll
                ? { type: 'ALL', rawReference: 'tutte le note' }
                : { type: 'EXPLICIT_ID', resolvedId: targetId },
              parameters: {},
              confidence: 'HIGH',
              rawQuery: clean,
              isLocalActionCandidate: true,
            },
            context,
            isAll
              ? { status: 'RESOLVED', entity: 'NOTE', scope: 'ALL' }
              : { status: 'RESOLVED', entity: 'NOTE', resolvedId: targetId, scope: 'SINGLE' }
          );

          if (result.status === 'SUCCESS') {
            if (isAll) {
              setDisplayedItems([], 'NOTE', now);
              setSelectedItem(null, now);
            } else if (targetId) {
              const currentCtx = getContext(now);
              setDisplayedItems(
                currentCtx.displayedItems.filter((item) => item.id !== targetId),
                'NOTE',
                now
              );
              if (currentCtx.selectedItem?.id === targetId) {
                setSelectedItem(null, now);
              }
            }
            setLastSuccessfulAction(result, now);
          }
        }
      } else if (actionType === 'REMINDER_DELETE') {
        const reminderCap = capabilityRegistry.getCapability('REMINDER');
        if (reminderCap) {
          result = await executeCapabilityWithRecovery(reminderCap, 
            {
              verb: 'DELETE',
              entity: 'REMINDER',
              target: isAll
                ? { type: 'ALL', rawReference: 'tutti i promemoria' }
                : { type: 'EXPLICIT_ID', resolvedId: targetId },
              parameters: {},
              confidence: 'HIGH',
              rawQuery: clean,
              isLocalActionCandidate: true,
            },
            context,
            isAll
              ? { status: 'RESOLVED', entity: 'REMINDER', scope: 'ALL' }
              : { status: 'RESOLVED', entity: 'REMINDER', resolvedId: targetId, scope: 'SINGLE' }
          );

          if (result.status === 'SUCCESS') {
            if (isAll) {
              setDisplayedItems([], 'REMINDER', now);
              setSelectedItem(null, now);
            } else if (targetId) {
              const currentCtx = getContext(now);
              setDisplayedItems(
                currentCtx.displayedItems.filter((item) => item.id !== targetId),
                'REMINDER',
                now
              );
              if (currentCtx.selectedItem?.id === targetId) {
                setSelectedItem(null, now);
              }
            }
            setLastSuccessfulAction(result, now);
          }
        }
      } else if (actionType === 'MEMORY_DELETE') {
        const memoryCap = capabilityRegistry.getCapability('MEMORY');
        if (memoryCap) {
          result = await executeCapabilityWithRecovery(memoryCap, 
            {
              verb: 'DELETE',
              entity: 'MEMORY',
              target: isAll
                ? { type: 'ALL', rawReference: (resolution.payload?.parameters?.targetQuery as string) || 'tutta la memoria' }
                : {
                    type: 'TEXT_MATCH',
                    rawReference: (resolution.payload?.parameters?.targetQuery as string) || '',
                  },
              parameters: {
                text: (resolution.payload?.parameters?.targetQuery as string) || '',
                profileField: resolution.payload?.parameters?.profileField as 'userName' | 'userCity' | undefined,
                subcategory:
                  (resolution.payload?.parameters?.subcategory as string) ||
                  ((resolution.payload?.parameters?.targetQuery as string)?.toLowerCase().includes('preferenz') ||
                  resolution.payload?.rawText?.toLowerCase().includes('preferenz') ||
                  resolution.payload?.rawText?.toLowerCase().includes('preferisc')
                    ? 'preferences'
                    : undefined),
              },
              confidence: 'HIGH',
              rawQuery: resolution.payload?.rawText || clean,
              isLocalActionCandidate: true,
            },
            context,
            isAll
              ? { status: 'RESOLVED', entity: 'MEMORY', scope: 'ALL' }
              : { status: 'RESOLVED', entity: 'MEMORY', scope: 'SINGLE' }
          );
        }
      }

      const isSuccess = result?.status === 'SUCCESS';
      return {
        type: 'HANDLED_LOCAL',
        feedbackText:
          result?.feedbackText ||
          (isSuccess ? 'Operazione confermata ed eseguita.' : 'Operazione non completata.'),
        sourceLabel: 'MAIA Safety Guard',
        dataAffected: result?.dataAffected ?? false,
        affectedEntity:
          actionType === 'NOTE_DELETE'
            ? 'NOTE'
            : actionType === 'REMINDER_DELETE'
            ? 'REMINDER'
            : 'MEMORY',
      };
    }

    if (confRes.status === 'CANCELLED') {
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: confRes.message || 'Operazione annullata.',
        sourceLabel: 'MAIA Safety Guard',
        dataAffected: false,
      };
    }

    if (confRes.status === 'AMBIGUOUS') {
      return {
        type: 'HANDLED_LOCAL',
        feedbackText:
          confRes.message ||
          'Non è chiaro. Rispondi con "sì" per confermare oppure "no" per annullare.',
        sourceLabel: 'MAIA Safety Guard',
        dataAffected: false,
      };
    }

    if (confRes.status === 'EXPIRED') {
      return {
        type: 'HANDLED_LOCAL',
        feedbackText:
          confRes.message ||
          'La richiesta di conferma è scaduta. L\'operazione non è stata eseguita.',
        sourceLabel: 'MAIA Safety Guard',
        dataAffected: false,
      };
    }
  }

  // =========================================================================
  // 1a2. EVALUATE PENDING PREFERENCE CANDIDATE (CONFIRMED LEARNING)
  // =========================================================================
  if (context.pendingPreferenceCandidate) {
    const candidate = context.pendingPreferenceCandidate;
    const isAffirmative = isConfirmationAffirmative(clean);
    const isNegative = isConfirmationNegative(clean);

    if (isAffirmative) {
      const currentMem = loadUserMemory();
      const syncRes = saveOrUpdatePreference(
        {
          ...candidate,
          source: 'CONFIRMED',
          confidence: 'HIGH',
        },
        currentMem,
        now
      );
      saveUserMemory(syncRes.updatedMemory);
      setPendingPreferenceCandidate(null, now);

      const prefText = candidate.rawText || candidate.key;
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: `Perfetto, ho salvato questa preferenza nella tua memoria: "${prefText}".`,
        sourceLabel: 'MAIA Learning',
        dataAffected: true,
        affectedEntity: 'MEMORY',
      };
    }

    if (isNegative) {
      setPendingPreferenceCandidate(null, now);
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: 'D’accordo, non salverò questa preferenza.',
        sourceLabel: 'MAIA Learning',
        dataAffected: false,
        affectedEntity: 'MEMORY',
      };
    }

    // If neither affirmative nor negative, user switched context: clear candidate and proceed
    setPendingPreferenceCandidate(null, now);
  }

  // =========================================================================
  // 1b. EVALUATE ACTIVE PENDING CLARIFICATION (PRIORITY OVER ORDINARY CLASSIFICATION)
  // =========================================================================
  if (context.pendingClarification && context.pendingClarification.type === 'SELECT_TARGET') {
    const clarification = context.pendingClarification;
    const candidates = clarification.candidates || [];
    const origIntent = clarification.originalIntent;

    // Check explicit cancellation
    const isCancel = /^(?:annulla|annullami|lascia\s+stare|interrompi|stop|elimina\s+richiesta|non\s+importa|niente)$/i.test(clean);
    if (isCancel) {
      setPendingClarification(null, now);
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: 'Operazione annullata.',
        sourceLabel: 'MAIA Clarification',
        dataAffected: false,
      };
    }

    // Attempt matching candidate selection
    const selection = matchCandidateSelection(clean, candidates);

    if (selection.matchedCandidate) {
      const candidate = selection.matchedCandidate;
      const resolvedTarget: TargetResolutionResult = {
        status: 'RESOLVED',
        entity: candidate.entity,
        resolvedId: candidate.id,
        matchedText: candidate.summary,
        displayedIndex: candidate.index,
        source: 'DISPLAYED_ITEM',
        scope: 'SINGLE',
      };

      const resolvedIntent: SemanticIntent = {
        ...origIntent,
        entity: candidate.entity,
        target: {
          type: 'EXPLICIT_ID',
          resolvedId: candidate.id,
          rawReference: candidate.summary,
        },
      };

      const cap = capabilityRegistry.getCapability(candidate.entity);
      if (!cap) {
        setPendingClarification(null, now);
        return {
          type: 'HANDLED_LOCAL',
          feedbackText: `Funzionalità per ${candidate.entity} non disponibile.`,
          sourceLabel: 'MAIA Capability Registry',
          dataAffected: false,
          affectedEntity: candidate.entity,
        };
      }

      // DO -> VERIFY -> REPORT
      const execResult = await executeCapabilityWithRecovery(cap, resolvedIntent, context, resolvedTarget);

      if (execResult.status === 'SUCCESS') {
        if (origIntent.verb === 'UPDATE') {
          setLastSuccessfulAction(execResult, now);
          setSelectedItem(
            {
              index: candidate.index,
              id: candidate.id,
              entity: candidate.entity,
              summary: origIntent.parameters.newText || candidate.summary,
            },
            now,
            'UPDATE'
          );
          setActiveEntity(candidate.entity, now);
        } else if (origIntent.verb === 'DELETE') {
          setLastSuccessfulAction(execResult, now);
          const freshCtx = getContext(now);
          setDisplayedItems(
            freshCtx.displayedItems.filter((item) => item.id !== candidate.id),
            candidate.entity,
            now
          );
          if (freshCtx.selectedItem?.id === candidate.id) {
            setSelectedItem(null, now);
          }
        }
      }

      // Clear pendingClarification after successful resolution
      setPendingClarification(null, now);

      return {
        type: 'HANDLED_LOCAL',
        feedbackText: execResult.feedbackText,
        sourceLabel: `MAIA Actions (${candidate.entity.toLowerCase()})`,
        dataAffected: execResult.dataAffected,
        affectedEntity: candidate.entity,
      };
    }

    if (selection.isSelectionAttempt) {
      // User attempted a numeric/ordinal selection, but index was out of range
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: `Selezione non valida. Scegli un'opzione tra 1 e ${candidates.length} (es. '1', 'la seconda').`,
        sourceLabel: 'MAIA Clarification',
        dataAffected: false,
        affectedEntity: origIntent.entity,
      };
    }

    // Check if user is issuing an unrelated new command
    const probeIntent = analyzeIntent(clean, context);
    const isExplicitCognitive =
      /\b(?:numero\s+primo|numeri\s+primi)\b/i.test(clean) ||
      /^(?:quanto\s+fa|calcola|risolvi|fai\s+il\s+calcolo)\b/i.test(clean) ||
      /^\d+\s*[\+\-\*\/×÷]\s*\d+/.test(clean) ||
      /^(?:spiegami|spiega|perch[eé]|cosa\s+significa|cos['’][eè]|chi\s+[eè]|chi\s+era|raccontami|parlami\s+di|come\s+funziona|definizione\s+di)\b/i.test(clean) ||
      /^(?:scrivi(?:mi)?\s+(?:una|un)?|traduci(?:mi)?|componi(?:mi)?|crea\s+un\s+testo|riassumi(?:mi)?)\b/i.test(clean);

    const isNewCommand =
      probeIntent.verb === 'CREATE' ||
      probeIntent.verb === 'READ' ||
      probeIntent.verb === 'SEARCH' ||
      (probeIntent.verb === 'DELETE' && probeIntent.target.type === 'ALL') ||
      isExplicitCognitive ||
      (probeIntent.isLocalActionCandidate &&
        (probeIntent.verb === 'UPDATE' || probeIntent.verb === 'DELETE') &&
        probeIntent.target.type !== 'UNRESOLVED');

    if (isNewCommand) {
      // Unrelated new command: clear pendingClarification and proceed to normal pipeline
      setPendingClarification(null, now);
    } else {
      // Ambiguous / unrecognized reply: keep clarification active and ask user again
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: `Non ho compreso la selezione. Indica quale elemento intendi scegliendo tra 1 e ${candidates.length} (es. '1', 'la seconda').`,
        sourceLabel: 'MAIA Clarification',
        dataAffected: false,
        affectedEntity: origIntent.entity,
      };
    }
  }

  // =========================================================================
  // 1c. EVALUATE PENDING MISSING PARAMETER CONTINUATION
  // =========================================================================
  if (context.pendingClarification && context.pendingClarification.type === 'MISSING_PARAM') {
    const clarification = context.pendingClarification;
    const origIntent = clarification.originalIntent;
    const missingParam = clarification.missingParameter || 'newText';

    // 1. Check explicit cancellation
    const isCancel = /^(?:annulla|annullami|lascia\s+perdere|lascia\s+stare|interrompi|stop|elimina\s+richiesta|non\s+importa|niente|no)$/i.test(clean);
    if (isCancel) {
      setPendingClarification(null, now);
      return {
        type: 'HANDLED_LOCAL',
        feedbackText: 'Operazione annullata.',
        sourceLabel: 'MAIA Clarification',
        dataAffected: false,
      };
    }

    // 2. Check context switching: cognitive inquiries or completely distinct local action verbs
    const probeIntent = analyzeIntent(clean, context);
    const isExplicitCognitive =
      probeIntent.verb === 'SEARCH' ||
      /\b(?:numero\s+primo|numeri\s+primi)\b/i.test(clean) ||
      /^(?:quanto\s+fa|calcola|risolvi|fai\s+il\s+calcolo)\b/i.test(clean) ||
      /^\d+\s*[\+\-\*\/×÷]\s*\d+/.test(clean) ||
      /^(?:spiegami|spiega|perch[eé]|cosa\s+significa|cos['’][eè]|chi\s+[eè]|chi\s+era|raccontami|parlami\s+di|come\s+funziona|definizione\s+di|qual\s+[eè]|quali\s+sono|dimmi\s+di|dimmi\s+chi|dimmi\s+cosa|che\s+tempo|meteo)\b/i.test(clean) ||
      /^(?:scrivi(?:mi)?\s+(?:una|un)?|traduci(?:mi)?|componi(?:mi)?|crea\s+un\s+testo|riassumi(?:mi)?)\b/i.test(clean);

    const isDifferentActionSwitch =
      probeIntent.isLocalActionCandidate &&
      (probeIntent.verb !== origIntent.verb ||
        probeIntent.entity !== origIntent.entity ||
        (probeIntent.target.type !== 'UNRESOLVED' && probeIntent.target.type !== 'PRONOUN'));

    if (isExplicitCognitive || isDifferentActionSwitch) {
      // Discard stale pending clarification and proceed to normal pipeline
      setPendingClarification(null, now);
    } else {
      // 3. User supplied the missing parameter
      setPendingClarification(null, now);

      const completedIntent: SemanticIntent = {
        ...origIntent,
        rawQuery: clean,
      };

      if (missingParam === 'newText') {
        if (completedIntent.entity === 'REMINDER') {
          const dueAt = extractTargetDateTime(clean);
          const shift = extractRelativeTimeShift(clean);
          if (dueAt || shift !== undefined) {
            completedIntent.parameters = {
              ...completedIntent.parameters,
              dueAt,
              timeShiftMinutes: shift,
            };
          } else {
            completedIntent.parameters = {
              ...completedIntent.parameters,
              newText: clean,
            };
          }
        } else {
          completedIntent.parameters = {
            ...completedIntent.parameters,
            newText: clean,
          };
        }
      } else if (missingParam === 'dueAt' && completedIntent.entity === 'REMINDER') {
        const dueAt = extractTargetDateTime(clean, new Date(now));
        const shift = extractRelativeTimeShift(clean);
        if (dueAt || shift !== undefined) {
          completedIntent.parameters = {
            ...completedIntent.parameters,
            ...(dueAt ? { dueAt } : {}),
            ...(shift !== undefined ? { timeShiftMinutes: shift } : {}),
          };
        } else {
          return {
            type: 'HANDLED_LOCAL',
            feedbackText: 'Non ho riconosciuto la data o l’orario. Prova con “domani alle 10:00” oppure “tra 30 minuti”.',
            sourceLabel: 'MAIA Clarification',
            dataAffected: false,
          };
        }
      } else if (missingParam === 'text') {
        completedIntent.parameters = {
          ...completedIntent.parameters,
          text: clean,
        };
      } else if (missingParam === 'dueAt') {
        const dueAt = extractTargetDateTime(clean);
        const shift = extractRelativeTimeShift(clean);
        completedIntent.parameters = {
          ...completedIntent.parameters,
          dueAt,
          timeShiftMinutes: shift,
        };
      }

      const targetRes: TargetResolutionResult =
        completedIntent.target.type === 'EXPLICIT_ID' && completedIntent.target.resolvedId
          ? {
              status: 'RESOLVED',
              entity: completedIntent.entity,
              resolvedId: completedIntent.target.resolvedId,
              matchedText: completedIntent.target.rawReference,
              scope: 'SINGLE',
            }
          : resolveTarget(completedIntent, context, {
              reminders: loadReminders(),
              notes: loadNotes(),
              now,
            });

      const cap = capabilityRegistry.getCapability(completedIntent.entity);
      if (cap) {
        const result = await executeCapabilityWithRecovery(cap, completedIntent, context, targetRes);
        if (result.status === 'SUCCESS') {
          setLastSuccessfulAction(result, now);
          if (targetRes.resolvedId) {
            setSelectedItem(
              {
                index: 1,
                id: targetRes.resolvedId,
                entity: completedIntent.entity,
                summary: completedIntent.parameters.newText || completedIntent.parameters.text || clean,
              },
              now,
              completedIntent.verb
            );
          }
          setActiveEntity(completedIntent.entity, now);
        }

        return {
          type: 'HANDLED_LOCAL',
          feedbackText: result.feedbackText,
          sourceLabel: `MAIA Actions (${completedIntent.entity.toLowerCase()})`,
          dataAffected: result.dataAffected,
          affectedEntity: completedIntent.entity,
        };
      }
    }
  }

  // =========================================================================
  // 2. SEMANTIC INTENT CLASSIFICATION (PHASE 6B SINGLE SOURCE OF TRUTH)
  // =========================================================================
  let intent = analyzeIntent(clean, context);

  // Resolve deletion of a profile value (e.g. "Cancella Malta") against the
  // authoritative local profile before generic note/reminder matching can win.
  // This only applies to an exact stored profile value and explicit delete verbs.
  const profileDeleteMatch = clean.match(/^(?:per\s+favore\s+)?(?:dimentica(?:ti)?|scorda|rimuovi|cancella|elimina)(?:\s+dalla\s+memoria(?:\s+personale)?)?\s+(.+?)\s*[.!?]*$/i);
  if (profileDeleteMatch && !/\b(?:nota|promemoria|reminder|progetto|tutte\s+le\s+note|tutti\s+i\s+promemoria)\b/i.test(clean)) {
    const candidateValue = profileDeleteMatch[1].trim().replace(/^(?:il|la)\s+(?:mio|mia)\s+/i, '').replace(/[.!?]+$/, '').trim();
    const profile = loadUserMemory();
    const normalizedCandidate = candidateValue.toLocaleLowerCase('it');
    const matchedField = profile.userName && profile.userName.trim().toLocaleLowerCase('it') === normalizedCandidate
      ? 'userName'
      : profile.userCity && profile.userCity.trim().toLocaleLowerCase('it') === normalizedCandidate
        ? 'userCity'
        : undefined;
    if (matchedField) {
      intent = {
        ...intent,
        verb: 'DELETE',
        entity: 'MEMORY',
        target: { type: 'TEXT_MATCH', rawReference: candidateValue },
        parameters: { ...intent.parameters, text: candidateValue, profileField: matchedField, subcategory: 'profile' },
        confidence: 'HIGH',
        rawQuery: clean,
        isLocalActionCandidate: true,
      };
    }
  }

  // Invalid explicit calendar dates are a local validation failure, never a fallback to Gemini.
  if (intent.parameters.invalidDate) {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText: `La data "${intent.parameters.invalidDateText || 'indicata'}" non è valida. Controlla giorno e mese e riprova.`,
      sourceLabel: 'MAIA Safety Guard',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  // Negative local intents are handled by MAIA and never delegated to Gemini.
  if (intent.parameters.negated && intent.isLocalActionCandidate) {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText: 'Tranquillo: non eseguo nessuna modifica.',
      sourceLabel: 'MAIA Intent Engine',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  // 2a. Genuine Cognitive / General Fallthrough to Gemini
  if (!intent.isLocalActionCandidate && intent.verb === 'EXPLAIN') {
    // Context switch: if activeEntity was WEB, clear it and update currentTopic
    if (context.activeEntity === 'WEB') {
      setActiveEntity(null, now);
      setCurrentTopic(clean, now);
    }
    return {
      type: 'FALLTHROUGH_GEMINI',
      rawQuery: clean,
    };
  }

  // 2b. Web Search capability (Phase 6G Web Search Hardening)
  if (intent.verb === 'SEARCH' && intent.entity === 'WEB') {
    const webCap = capabilityRegistry.getCapability('WEB');
    if (webCap) {
      const res = await executeCapabilityWithRecovery(webCap, intent, context);

      const targetSearchQuery =
        intent.parameters.searchQuery?.trim() ||
        res.searchQuery ||
        intent.rawQuery;

      if (res.status === 'SUCCESS') {
        setActiveEntity('WEB', now);
        setCurrentTopic(targetSearchQuery, now);
        setLastWebSearch(
          {
            rawQuery: intent.rawQuery,
            searchQuery: targetSearchQuery,
            summary: res.feedbackText,
            sources: res.sources,
            timestamp: now,
            category: intent.parameters.category,
          },
          now
        );
        setLastSuccessfulAction(res, now);
      } else if (res.status === 'FAILURE') {
        // Retain pending action for honest failure recovery & potential retry
        setPendingAction(intent, now);
      }

      return {
        type: 'HANDLED_LOCAL',
        feedbackText: res.feedbackText,
        sourceLabel: 'MAIA Web Search',
        dataAffected: false,
        affectedEntity: 'WEB',
        sources: res.sources,
        searchQuery: targetSearchQuery,
      };
    }
  }

  // =========================================================================
  // 3. CONTEXTUAL TARGET RESOLUTION (PHASE 6C)
  // =========================================================================
  const currentReminders = loadReminders();
  const currentNotes = loadNotes();
  const currentMemory = loadUserMemory();

  let targetResult = resolveTarget(intent, context, {
    reminders: currentReminders,
    notes: currentNotes,
    now,
  });

  // Generic local update/delete requests must resolve against stored items,
  // not search for the literal phrase "la mia nota/promemoria".
  if ((intent.verb === 'UPDATE' || intent.verb === 'DELETE') &&
      (intent.entity === 'NOTE' || intent.entity === 'REMINDER') &&
      (intent.target.type === 'UNRESOLVED' || /^(?:il\s+mio\s+promemoria|la\s+mia\s+nota|il\s+promemoria|la\s+nota|questo|quello|quella)$/i.test((intent.target.rawReference || '').trim()))) {
    const items = intent.entity === 'NOTE' ? currentNotes : currentReminders.filter((item) => !item.completed);
    const candidates = items.map((item, index) => ({ id: item.id, entity: intent.entity, summary: String(('title' in item ? item.title : undefined) || item.text || ''), index: index + 1 }));
    if (candidates.length === 1) {
      targetResult = { status: 'RESOLVED', entity: intent.entity, resolvedId: candidates[0].id, matchedText: candidates[0].summary, source: 'STORE_MATCH', scope: 'SINGLE' };
      intent = { ...intent, target: { type: 'EXPLICIT_ID', resolvedId: candidates[0].id, rawReference: candidates[0].summary } };
    } else if (candidates.length > 1) {
      targetResult = { status: 'AMBIGUOUS', entity: intent.entity, candidates, clarificationPrompt: `Ho trovato ${candidates.length} elementi. Quale vuoi ${intent.verb === 'DELETE' ? 'cancellare' : 'modificare'}? Indica il numero o il titolo.` };
    } else {
      targetResult = { status: 'NOT_FOUND', entity: intent.entity, clarificationPrompt: intent.entity === 'NOTE' ? 'Non hai note salvate da modificare o cancellare.' : 'Non hai promemoria attivi da modificare o cancellare.' };
    }
  }

  // Check if capability explicitly does not support the verb (e.g. UPDATE in Phase 6D)
  const candidateCap = capabilityRegistry.getCapability(intent.entity);
  if (candidateCap && !candidateCap.supportedVerbs.includes(intent.verb)) {
    const unsuppResult = await executeCapabilityWithRecovery(candidateCap, intent, context, targetResult);
    return {
      type: 'HANDLED_LOCAL',
      feedbackText: unsuppResult.feedbackText,
      sourceLabel: 'MAIA Capability',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  // Handle Target Resolution Ambiguities & Incomplete Queries
  // (NEVER FALLTHROUGH TO GEMINI ON LOCAL CANDIDATES!)
  if (targetResult.status === 'AMBIGUOUS') {
    if (targetResult.candidates && targetResult.candidates.length > 0) {
      const candidateRefs: DisplayedItemRef[] = targetResult.candidates.map((c, idx) => ({
        index: c.index ?? idx + 1,
        id: c.id,
        entity: c.entity,
        summary: c.summary,
      }));
      setPendingClarification(
        {
          type: 'SELECT_TARGET',
          candidates: candidateRefs,
          originalIntent: intent,
        },
        now
      );
      setDisplayedItems(candidateRefs, intent.entity, now);
    }
    return {
      type: 'HANDLED_LOCAL',
      feedbackText:
        targetResult.clarificationPrompt ||
        'Ho trovato più elementi corrispondenti. Quale intendi esattamente?',
      sourceLabel: 'MAIA Clarification',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  const isGeneralRead =
    intent.verb === 'READ' &&
    (intent.target.type === 'ALL' || (!intent.target.rawReference && intent.target.type === 'UNRESOLVED'));

  if (targetResult.status === 'UNRESOLVED' && intent.verb !== 'CREATE' && !isGeneralRead) {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText:
        targetResult.clarificationPrompt ||
        'A quale elemento ti riferisci? Specifica meglio quale vuoi selezionare.',
      sourceLabel: 'MAIA Clarification',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  if (targetResult.status === 'NOT_FOUND' && intent.verb !== 'CREATE' && !isGeneralRead) {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText:
        targetResult.clarificationPrompt ||
        'Non ho trovato alcun elemento corrispondente alla tua richiesta.',
      sourceLabel: 'MAIA Target Resolver',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  // =========================================================================
  // 4. CENTRAL SAFETY GUARD (PHASE 6F)
  // =========================================================================
  const safetyAssessment = evaluateSafety(intent, targetResult, context, {
    notesCount: currentNotes.length,
    remindersCount: currentReminders.length,
    hasMemory: Boolean(
      currentMemory &&
        (currentMemory.userName ||
          currentMemory.userCity ||
          (currentMemory.preferences && currentMemory.preferences.length > 0) ||
          (currentMemory.interests && currentMemory.interests.length > 0) ||
          (currentMemory.projects && currentMemory.projects.length > 0) ||
          (currentMemory.notes && currentMemory.notes.length > 0))
    ),
    hasPreferences: Boolean(
      currentMemory &&
        ((currentMemory.preferences && currentMemory.preferences.length > 0) ||
          (currentMemory.structuredPreferences && currentMemory.structuredPreferences.length > 0))
    ),
  });

  if (safetyAssessment.decision === 'REJECT') {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText: safetyAssessment.reason || 'Operazione non consentita o parametri non validi.',
      sourceLabel: 'MAIA Safety Guard',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  if (safetyAssessment.decision === 'REQUIRE_CONFIRMATION') {
    const isAll = targetResult.scope === 'ALL' || intent.target.type === 'ALL';
    const promptText = safetyAssessment.confirmationPrompt!;

    const resolution: RouterResolution = {
      actionType:
        intent.entity === 'NOTE'
          ? 'NOTE_DELETE'
          : intent.entity === 'REMINDER'
          ? 'REMINDER_DELETE'
          : 'MEMORY_DELETE',
      status: 'CONFIRMATION_REQUIRED',
      payload: {
        rawText: clean,
        isDestructive: true,
        parameters: {
          scope: isAll ? 'all' : 'specific',
          targetId: targetResult.resolvedId,
          matchedText: targetResult.matchedText,
          targetQuery: intent.parameters.text || targetResult.matchedText || clean,
          subcategory: intent.parameters.subcategory,
          profileField: intent.parameters.profileField,
        },
      },
      confirmationPrompt: promptText,
    };

    createPendingConfirmation(resolution, now, {
      intent,
      targetResult,
      riskCategory: safetyAssessment.category,
    });

    return {
      type: 'CONFIRMATION_REQUIRED',
      feedbackText: promptText,
      sourceLabel: 'MAIA Safety Guard',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  // =========================================================================
  // 5. CAPABILITY REGISTRY LOOKUP & EXECUTION
  // =========================================================================
  const capability = capabilityRegistry.getCapability(intent.entity);
  if (!capability || !capability.canHandle(intent, context)) {
    return {
      type: 'HANDLED_LOCAL',
      feedbackText: `Operazione ${intent.verb} per ${intent.entity} non supportata.`,
      sourceLabel: 'MAIA Capability Registry',
      dataAffected: false,
      affectedEntity: intent.entity,
    };
  }

  // DO -> VERIFY -> REPORT
  const execResult = await executeCapabilityWithRecovery(capability, intent, context, targetResult);

  // =========================================================================
  // 6. SESSION CONTEXT UPDATE (POST-VERIFICATION ONLY)
  // =========================================================================
  if (execResult.status === 'SUCCESS') {
    if (intent.verb === 'READ') {
      if (targetResult.resolvedId) {
        setSelectedItem(
          {
            index: targetResult.displayedIndex || 1,
            id: targetResult.resolvedId,
            entity: intent.entity,
            summary: targetResult.matchedText || clean,
          },
          now,
          'READ'
        );
      }
      setLastSuccessfulAction(execResult, now);

      if (intent.entity === 'REMINDER') {
        const freshReminders = loadReminders();
        setDisplayedItems(
          freshReminders.map((r, i) => ({
            index: i + 1,
            id: r.id,
            entity: 'REMINDER',
            summary: r.text,
            dueAt: r.dueAt,
          })),
          'REMINDER',
          now
        );
      } else if (intent.entity === 'NOTE') {
        const freshNotes = loadNotes();
        setDisplayedItems(
          freshNotes.map((n, i) => ({
            index: i + 1,
            id: n.id,
            entity: 'NOTE',
            summary: n.title ? `${n.title}: ${n.text}` : n.text,
          })),
          'NOTE',
          now
        );
      }
    } else if (intent.verb === 'CREATE') {
      // Refresh storage first, then select the actual created item with its
      // real current positional index. This prevents "la seconda" / "l'ultima"
      // from seeing a stale index immediately after a create action.
      let freshCreatedItems: DisplayedItemRef[] = [];
      if (intent.entity === 'REMINDER') {
        const freshReminders = loadReminders();
        freshCreatedItems = freshReminders.map((r, i) => ({
          index: i + 1, id: r.id, entity: 'REMINDER' as const, summary: r.text, dueAt: r.dueAt,
        }));
      } else if (intent.entity === 'NOTE') {
        const freshNotes = loadNotes();
        freshCreatedItems = freshNotes.map((n, i) => ({
          index: i + 1, id: n.id, entity: 'NOTE' as const, summary: n.text,
        }));
      }
      if (execResult.affectedId) {
        const createdRef = freshCreatedItems.find((item) => item.id === execResult.affectedId);
        setSelectedItem(
          createdRef || { index: 1, id: execResult.affectedId, entity: intent.entity, summary: intent.parameters.text || clean },
          now,
          'CREATE'
        );
      }
      // Keep the positional view synchronized after creation. Without this,
      // an immediate follow-up such as "modifica la seconda" could use an
      // obsolete list that predates the newly created item.
      if (intent.entity === 'REMINDER') {
        const freshReminders = loadReminders();
        setDisplayedItems(
          freshReminders.map((r, i) => ({
            index: i + 1,
            id: r.id,
            entity: 'REMINDER',
            summary: r.text,
            dueAt: r.dueAt,
          })),
          'REMINDER',
          now
        );
      } else if (intent.entity === 'NOTE') {
        const freshNotes = loadNotes();
        setDisplayedItems(
          freshNotes.map((n, i) => ({
            index: i + 1,
            id: n.id,
            entity: 'NOTE',
            summary: n.title ? `${n.title}: ${n.text}` : n.text,
          })),
          'NOTE',
          now
        );
      }
      setActiveEntity(intent.entity, now);
      setLastSuccessfulAction(execResult, now);
    } else if (intent.verb === 'COMPLETE') {
      setLastSuccessfulAction(execResult, now);
      if (targetResult.resolvedId) {
        setSelectedItem(
          {
            index: targetResult.displayedIndex || 1,
            id: targetResult.resolvedId,
            entity: intent.entity,
            summary: targetResult.matchedText || clean,
          },
          now,
          'COMPLETE'
        );
      }
    } else if (intent.verb === 'UPDATE') {
      setLastSuccessfulAction(execResult, now);
      if (targetResult.resolvedId) {
        setSelectedItem(
          {
            index: targetResult.displayedIndex || 1,
            id: targetResult.resolvedId,
            entity: intent.entity,
            summary: intent.parameters.newText || targetResult.matchedText || clean,
          },
          now,
          'UPDATE'
        );
      }
      // Refresh the displayed collection so subsequent ordinal references use
      // current text/order rather than a stale pre-update snapshot.
      if (intent.entity === 'REMINDER') {
        const freshReminders = loadReminders();
        setDisplayedItems(
          freshReminders.map((r, i) => ({
            index: i + 1,
            id: r.id,
            entity: 'REMINDER',
            summary: r.text,
            dueAt: r.dueAt,
          })),
          'REMINDER',
          now
        );
      } else if (intent.entity === 'NOTE') {
        const freshNotes = loadNotes();
        setDisplayedItems(
          freshNotes.map((n, i) => ({
            index: i + 1,
            id: n.id,
            entity: 'NOTE',
            summary: n.title ? `${n.title}: ${n.text}` : n.text,
          })),
          'NOTE',
          now
        );
      }
      setActiveEntity(intent.entity, now);
    }
  } else if (execResult.status === 'AMBIGUOUS') {
    if (intent.verb === 'UPDATE' && !intent.parameters.newText) {
      setPendingClarification(
        {
          type: 'MISSING_PARAM',
          originalIntent: {
            ...intent,
            target: targetResult.resolvedId
              ? {
                  type: 'EXPLICIT_ID',
                  resolvedId: targetResult.resolvedId,
                  rawReference: targetResult.matchedText || intent.target.rawReference,
                }
              : intent.target,
          },
          missingParameter: 'newText',
        },
        now
      );
    } else if (intent.verb === 'CREATE' && !intent.parameters.text) {
      setPendingClarification(
        {
          type: 'MISSING_PARAM',
          originalIntent: intent,
          missingParameter: 'text',
        },
        now
      );
    } else if (intent.verb === 'CREATE' && intent.entity === 'REMINDER' && !intent.parameters.dueAt) {
      setPendingClarification(
        {
          type: 'MISSING_PARAM',
          originalIntent: intent,
          missingParameter: 'dueAt',
        },
        now
      );
    }
  }

  return {
    type: 'HANDLED_LOCAL',
    feedbackText: execResult.feedbackText,
    sourceLabel: `MAIA Actions (${intent.entity.toLowerCase()})`,
    dataAffected: execResult.dataAffected,
    affectedEntity: intent.entity,
  };
}
