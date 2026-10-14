import {
  SemanticIntent,
  SessionContext,
} from '../../types/context';
import { TargetResolutionResult } from './targetResolver';

/**
 * Risk classification for actions in MAIA (Phase 6F Central Safety Guard).
 */
export type RiskCategory =
  | 'SAFE'
  | 'MODIFY'
  | 'DESTRUCTIVE'
  | 'HIGHLY_DESTRUCTIVE';

/**
 * Safety decision produced by Central Safety Guard.
 */
export type SafetyDecision =
  | 'ALLOW'
  | 'REQUIRE_CONFIRMATION'
  | 'REJECT';

/**
 * Result of evaluating an intent through Central Safety Guard.
 */
export interface SafetyAssessment {
  category: RiskCategory;
  decision: SafetyDecision;
  confirmationPrompt?: string;
  reason?: string;
  isDestructive: boolean;
}

/**
 * Optional contextual data to evaluate whether stores are empty.
 */
export interface SafetyGuardData {
  notesCount?: number;
  remindersCount?: number;
  hasMemory?: boolean;
  hasPreferences?: boolean;
}

/**
 * Categorizes the inherent risk of a SemanticIntent and resolved target.
 */
export function getRiskCategory(
  intent: SemanticIntent,
  targetResult?: TargetResolutionResult
): RiskCategory {
  if (
    !intent.isLocalActionCandidate ||
    intent.verb === 'READ' ||
    intent.verb === 'SEARCH' ||
    intent.verb === 'EXPLAIN'
  ) {
    return 'SAFE';
  }

  if (intent.verb === 'CREATE' || intent.verb === 'UPDATE' || intent.verb === 'COMPLETE') {
    return 'MODIFY';
  }

  if (intent.verb === 'DELETE') {
    const isAll =
      targetResult?.scope === 'ALL' ||
      intent.target.type === 'ALL';
    return isAll ? 'HIGHLY_DESTRUCTIVE' : 'DESTRUCTIVE';
  }

  return 'SAFE';
}

/**
 * Determines whether an action is destructive.
 */
export function isDestructiveAction(
  intent: SemanticIntent,
  targetResult?: TargetResolutionResult
): boolean {
  const category = getRiskCategory(intent, targetResult);
  return category === 'DESTRUCTIVE' || category === 'HIGHLY_DESTRUCTIVE';
}

/**
 * Central Safety Guard (Phase 6F).
 *
 * Evaluates a resolved SemanticIntent BEFORE capability execution:
 * - SAFE (READ, SEARCH, EXPLAIN) -> ALLOW
 * - MODIFY (UPDATE, CREATE, COMPLETE) -> ALLOW (no unnecessary confirmations for updates)
 * - DESTRUCTIVE (DELETE single item) -> REQUIRE_CONFIRMATION (if resolved), REJECT (if ambiguous/not found)
 * - HIGHLY_DESTRUCTIVE (DELETE_ALL) -> REQUIRE_CONFIRMATION (if items exist), REJECT (if empty store)
 */
export function evaluateSafety(
  intent: SemanticIntent,
  targetResult: TargetResolutionResult,
  _context?: SessionContext,
  data?: SafetyGuardData
): SafetyAssessment {
  const category = getRiskCategory(intent, targetResult);

  // 1. SAFE OPERATIONS: Reads, explain, searches
  if (category === 'SAFE') {
    return {
      category: 'SAFE',
      decision: 'ALLOW',
      isDestructive: false,
    };
  }

  // 2. MODIFY OPERATIONS: Updates, creates, completions (no prompt needed)
  if (category === 'MODIFY') {
    return {
      category: 'MODIFY',
      decision: 'ALLOW',
      isDestructive: false,
    };
  }

  // 3. HIGHLY DESTRUCTIVE OPERATIONS: DELETE_ALL
  if (category === 'HIGHLY_DESTRUCTIVE') {
    // Check if collection is empty
    if (intent.entity === 'NOTE' && data?.notesCount === 0) {
      return {
        category: 'HIGHLY_DESTRUCTIVE',
        decision: 'REJECT',
        reason: 'Non ci sono note da eliminare.',
        isDestructive: true,
      };
    }

    if (intent.entity === 'REMINDER' && data?.remindersCount === 0) {
      return {
        category: 'HIGHLY_DESTRUCTIVE',
        decision: 'REJECT',
        reason: 'Non ci sono promemoria da eliminare.',
        isDestructive: true,
      };
    }

    if (intent.entity === 'MEMORY') {
      const isPrefReset =
        intent.parameters?.subcategory === 'preferences' ||
        intent.target?.rawReference?.toLowerCase().includes('preferenz');

      if (isPrefReset) {
        if (data?.hasPreferences === false) {
          return {
            category: 'HIGHLY_DESTRUCTIVE',
            decision: 'REJECT',
            reason: 'Non ci sono preferenze memorizzate da cancellare.',
            isDestructive: true,
          };
        }
      } else if (data?.hasMemory === false) {
        return {
          category: 'HIGHLY_DESTRUCTIVE',
          decision: 'REJECT',
          reason: 'Non ci sono informazioni salvate nella memoria.',
          isDestructive: true,
        };
      }
    }

    const promptText =
      intent.entity === 'NOTE'
        ? "Sei sicuro di voler eliminare tutte le note? L'operazione è irreversibile."
        : intent.entity === 'REMINDER'
        ? "Sei sicuro di voler eliminare tutti i promemoria? L'operazione è irreversibile."
        : intent.parameters?.subcategory === 'preferences' ||
          intent.target?.rawReference?.toLowerCase().includes('preferenz')
        ? "Sei sicuro di voler cancellare tutte le tue preferenze? L'operazione è irreversibile."
        : "Sei sicuro di voler cancellare tutta la memoria a lungo termine? L'operazione è irreversibile.";

    return {
      category: 'HIGHLY_DESTRUCTIVE',
      decision: 'REQUIRE_CONFIRMATION',
      confirmationPrompt: promptText,
      isDestructive: true,
    };
  }

  // 4. DESTRUCTIVE OPERATIONS: DELETE (Single item)
  if (category === 'DESTRUCTIVE') {
    // If target is ambiguous, reject destruction without explicit target disambiguation
    if (targetResult.status === 'AMBIGUOUS') {
      return {
        category: 'DESTRUCTIVE',
        decision: 'REJECT',
        reason:
          targetResult.clarificationPrompt ||
          'Target ambiguo: specifica quale elemento intendi eliminare.',
        isDestructive: true,
      };
    }

    if (targetResult.status === 'UNRESOLVED' || targetResult.status === 'NOT_FOUND') {
      return {
        category: 'DESTRUCTIVE',
        decision: 'REJECT',
        reason:
          targetResult.clarificationPrompt ||
          'Elemento da eliminare non trovato o non specificato.',
        isDestructive: true,
      };
    }

    // Resolved single item
    const summary = targetResult.matchedText || 'questo elemento';
    const promptText =
      intent.entity === 'MEMORY'
        ? `Vuoi davvero rimuovere dalla mia memoria: "${intent.parameters?.text || summary}"?`
        : intent.entity === 'NOTE'
        ? `Sei sicuro di voler eliminare la nota "${summary}"? L'operazione è irreversibile.`
        : `Sei sicuro di voler eliminare il promemoria "${summary}"? L'operazione è irreversibile.`;

    return {
      category: 'DESTRUCTIVE',
      decision: 'REQUIRE_CONFIRMATION',
      confirmationPrompt: promptText,
      isDestructive: true,
    };
  }

  return {
    category: 'SAFE',
    decision: 'ALLOW',
    isDestructive: false,
  };
}
