import { WebSearchSource } from './actions';
import { MaiaPreference } from '../types';

/**
 * MAIA Core Context & Working Memory Types (Phase 6A & 6G)
 *
 * Provides typed definitions for short-lived conversational working memory,
 * semantic verbs, entities, targets, and verified execution results.
 */

export type SemanticVerb =
  | 'CREATE'     // Crea, prendi nota, ricordami, aggiungi
  | 'READ'       // Mostra, visualizza, elenca, leggi, quali sono
  | 'UPDATE'     // Modifica, sposta, posticipa, rimanda, cambia orario/testo
  | 'DELETE'     // Cancella, elimina, rimuovi, scarta
  | 'COMPLETE'   // Segna come fatto, completa, spunta
  | 'SEARCH'     // Ricerca web live, meteo, notizie
  | 'EXPLAIN';   // Spiegazione scientifica, calcolo, codice, chat aperta

export type SemanticEntity =
  | 'NOTE'
  | 'REMINDER'
  | 'MEMORY'
  | 'PROJECT'
  | 'WEB'
  | 'CALENDAR'      // Reserved for future capabilities
  | 'TASK'          // Reserved for future capabilities
  | 'UNKNOWN';      // Intent not bound to a known local capability

export type SemanticScopeType =
  | 'ALL'              // "tutte le note", "cancella tutto"
  | 'ORDINAL'          // "il primo", "la seconda", "l'ultimo"
  | 'TEXT_MATCH'       // "quello della macchina", "nota spesa"
  | 'RELATIVE_TIME'    // "quello di prima", "quello appena creato"
  | 'PRONOUN'          // "questo", "quello", "cancellalo", "spostala"
  | 'EXPLICIT_ID'      // Resolved unique ID
  | 'UNRESOLVED';      // Missing or ambiguous reference

export interface TargetDescriptor {
  type: SemanticScopeType;
  rawReference?: string;
  ordinalIndex?: number;    // 1-based (e.g. 1 for "il primo")
  resolvedId?: string;
  matchedText?: string;
  relativeAction?: SemanticVerb;
}

/**
 * Information Freshness Classification (Phase 6G Web Search Hardening)
 */
export type FreshnessType =
  | 'CURRENT'        // oggi / adesso / attuale / ultime / recenti
  | 'HISTORICAL'     // informazioni storiche / eventi passati
  | 'GENERAL'        // conoscenza generale / nozioni
  | 'EXPLICIT_WEB';   // l'utente chiede esplicitamente di cercare online / sul web

export interface SemanticIntent {
  verb: SemanticVerb;
  entity: SemanticEntity;
  target: TargetDescriptor;
  parameters: {
    text?: string;
    profileName?: string;
    profileCity?: string;
    profileField?: string;
    profileValue?: string;
    projectName?: string;
    projectObjective?: string;
    personalFactKey?: string;
    personalFactValue?: string;
    personalFactQuery?: string;
    reminderField?: string;
    reminderQuery?: string;
    newText?: string;
    updateMode?: 'REPLACE' | 'APPEND';
    title?: string;
    dueAt?: string;
    timeShiftMinutes?: number;
    category?: string;
    isAllClarified?: boolean;
    searchQuery?: string;
    freshness?: FreshnessType;
    isFollowUp?: boolean;
    // Phase 6H Learning & Preferences
    subcategory?: string;
    key?: string;
    value?: unknown;
    scope?: string;
    isTemporary?: boolean;
    isBehavioralEvidence?: boolean;
    negated?: boolean;
    invalidDate?: boolean;
    invalidDateText?: string;
  };
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rawQuery: string;
  isLocalActionCandidate?: boolean;
}

export type ExecutionStatus =
  | 'SUCCESS'
  | 'FAILURE'
  | 'AMBIGUOUS'
  | 'CONFIRMATION_REQUIRED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED';

export interface VerifiedActionResult {
  status: ExecutionStatus;
  entity: SemanticEntity;
  verb: SemanticVerb;
  feedbackText: string;
  dataAffected: boolean;
  affectedId?: string;
  affectedCount?: number;
  clarificationPrompt?: string;
  confirmationPrompt?: string;
  error?: string;
  sources?: WebSearchSource[];
  searchQuery?: string;
}

/**
 * Lightweight reference to an entity item displayed to the user.
 */
export interface DisplayedItemRef {
  index: number;         // 1, 2, 3...
  id: string;            // Unique item ID (from notes, reminders, etc.)
  entity: SemanticEntity;
  summary: string;       // Brief title/text for quick keyword matching
  dueAt?: string;        // Optional ISO timestamp for temporal operations
}

/**
 * Cached ephemeral web search result in conversational SessionContext (Phase 6G).
 * IN-MEMORY ONLY, NEVER PERSISTED.
 */
export interface LastWebSearchResult {
  rawQuery: string;
  searchQuery: string;
  summary: string;
  sources?: WebSearchSource[];
  timestamp: number;
  category?: string;
}

/**
 * Volatile working-memory state for conversational context resolution.
 *
 * STRICT RULES:
 * - IN-MEMORY ONLY: Cleared on page refresh/restart or Nuova Chat.
 * - ZERO PERSISTENCE: Never stored in localStorage or external databases.
 * - TTL PROTECTED: Automatically expires after 5 minutes of inactivity.
 */
export interface SessionContext {
  activeEntity: SemanticEntity | null;
  activeCollectionType: SemanticEntity | null;

  displayedItems: DisplayedItemRef[];

  selectedItem: DisplayedItemRef | null;

  recentReferences: Array<{
    id: string;
    entity: SemanticEntity;
    timestamp: number;
    verb?: SemanticVerb;
  }>;

  pendingAction: SemanticIntent | null;

  pendingClarification: {
    type:
      | 'DISAMBIGUATE_ENTITY'
      | 'SELECT_TARGET'
      | 'MISSING_PARAM';
    candidates?: DisplayedItemRef[];
    originalIntent: SemanticIntent;
    missingParameter?: 'text' | 'newText' | 'dueAt' | 'target' | 'other';
  } | null;

  currentTopic: string;

  lastUserIntent: SemanticIntent | null;

  lastSuccessfulAction: VerifiedActionResult | null;

  lastActivityTimestamp: number;

  lastWebSearch?: LastWebSearchResult | null;

  // Working memory for volatile preferences & learning evidence (Phase 6H)
  temporaryPreferences?: Record<string, unknown>;
  learningEvidence?: Array<{
    key: string;
    value: unknown;
    count: number;
    lastObservedAt: number;
    rawText?: string;
    category?: string;
  }>;
  pendingPreferenceCandidate?: MaiaPreference | null;
}
