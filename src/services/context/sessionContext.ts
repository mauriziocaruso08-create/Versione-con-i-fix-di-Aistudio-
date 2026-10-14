import {
  DisplayedItemRef,
  LastWebSearchResult,
  SemanticEntity,
  SemanticIntent,
  SemanticVerb,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import { MaiaPreference } from '../../types';

/**
 * Default conversational working-memory TTL: 5 minutes (in milliseconds).
 */
export const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum number of recent references retained in working memory.
 */
export const MAX_RECENT_REFERENCES = 10;

/**
 * Creates an empty initial working-memory context.
 */
export function createInitialContext(now: number = Date.now()): SessionContext {
  return {
    activeEntity: null,
    activeCollectionType: null,
    displayedItems: [],
    selectedItem: null,
    recentReferences: [],
    pendingAction: null,
    pendingClarification: null,
    currentTopic: 'general',
    lastUserIntent: null,
    lastSuccessfulAction: null,
    lastActivityTimestamp: now,
    lastWebSearch: null,
    temporaryPreferences: {},
    learningEvidence: [],
    pendingPreferenceCandidate: null,
  };
}

/**
 * In-memory singleton state holder.
 *
 * ARCHITECTURAL PRINCIPLES:
 * - 100% Volatile (RAM only).
 * - React-independent, UI-independent, deterministic.
 * - Never stored in localStorage, IndexedDB, or server.
 * - Cleared on reload or Nuova Chat.
 */
let currentContext: SessionContext = createInitialContext();
let currentTtlMs: number = DEFAULT_SESSION_TTL_MS;

/**
 * Produces an immutable, defensive snapshot of a SessionContext.
 */
function cloneContext(ctx: SessionContext): SessionContext {
  return {
    activeEntity: ctx.activeEntity,
    activeCollectionType: ctx.activeCollectionType,
    displayedItems: ctx.displayedItems.map((item) => ({ ...item })),
    selectedItem: ctx.selectedItem ? { ...ctx.selectedItem } : null,
    recentReferences: ctx.recentReferences.map((ref) => ({ ...ref })),
    pendingAction: ctx.pendingAction
      ? JSON.parse(JSON.stringify(ctx.pendingAction))
      : null,
    pendingClarification: ctx.pendingClarification
      ? {
          type: ctx.pendingClarification.type,
          candidates: ctx.pendingClarification.candidates
            ? ctx.pendingClarification.candidates.map((c) => ({ ...c }))
            : undefined,
          originalIntent: ctx.pendingClarification.originalIntent
            ? JSON.parse(
                JSON.stringify(ctx.pendingClarification.originalIntent)
              )
            : undefined,
          missingParameter: ctx.pendingClarification.missingParameter,
        }
      : null,
    currentTopic: ctx.currentTopic,
    lastUserIntent: ctx.lastUserIntent
      ? JSON.parse(JSON.stringify(ctx.lastUserIntent))
      : null,
    lastSuccessfulAction: ctx.lastSuccessfulAction
      ? { ...ctx.lastSuccessfulAction }
      : null,
    lastActivityTimestamp: ctx.lastActivityTimestamp,
    lastWebSearch: ctx.lastWebSearch ? { ...ctx.lastWebSearch } : null,
    temporaryPreferences: ctx.temporaryPreferences ? { ...ctx.temporaryPreferences } : {},
    learningEvidence: ctx.learningEvidence ? ctx.learningEvidence.map((e) => ({ ...e })) : [],
    pendingPreferenceCandidate: ctx.pendingPreferenceCandidate
      ? { ...ctx.pendingPreferenceCandidate }
      : null,
  };
}

/**
 * Sets a custom session TTL (in ms) for testing or configuration.
 */
export function setSessionTtlMs(ttlMs: number): void {
  currentTtlMs = ttlMs > 0 ? ttlMs : DEFAULT_SESSION_TTL_MS;
}

/**
 * Gets the current configured TTL in milliseconds.
 */
export function getSessionTtlMs(): number {
  return currentTtlMs;
}

/**
 * Checks whether the current working memory has expired based on inactivity.
 * Supports injected `now` timestamp for deterministic testing.
 */
export function isContextExpired(now: number = Date.now()): boolean {
  return now - currentContext.lastActivityTimestamp > currentTtlMs;
}

/**
 * Evaluates TTL and invalidates stale conversational references if expired.
 * Returns true if the context was expired and invalidated, false otherwise.
 */
export function invalidateExpiredContext(now: number = Date.now()): boolean {
  if (isContextExpired(now)) {
    // Invalidate conversational working memory
    currentContext.activeEntity = null;
    currentContext.activeCollectionType = null;
    currentContext.displayedItems = [];
    currentContext.selectedItem = null;
    currentContext.pendingAction = null;
    currentContext.pendingClarification = null;
    currentContext.lastWebSearch = null;
    currentContext.temporaryPreferences = {};
    currentContext.learningEvidence = [];
    currentContext.pendingPreferenceCandidate = null;
    // Discard references older than TTL
    currentContext.recentReferences = currentContext.recentReferences.filter(
      (ref) => now - ref.timestamp <= currentTtlMs
    );
    // Mark timestamp at check time
    currentContext.lastActivityTimestamp = now;
    return true;
  }

  // Filter individual stale references even if overall context is active
  currentContext.recentReferences = currentContext.recentReferences.filter(
    (ref) => now - ref.timestamp <= currentTtlMs
  );
  return false;
}

/**
 * Retrieves the current session context as a defensive, immutable snapshot.
 * Automatically checks and invalidates expired context before returning.
 */
export function getContext(now: number = Date.now()): Readonly<SessionContext> {
  invalidateExpiredContext(now);
  return cloneContext(currentContext);
}

/**
 * Retrieves the raw session context without running TTL invalidation.
 * Primarily intended for debugging and test inspections.
 */
export function getRawContext(): Readonly<SessionContext> {
  return cloneContext(currentContext);
}

/**
 * Resets working memory completely to its initial blank state.
 * Called on page load or by "Clear Chat / Nuova Chat".
 */
export function resetContext(now: number = Date.now()): void {
  currentContext = createInitialContext(now);
}

/**
 * Updates the last activity timestamp to prevent premature expiration.
 */
export function touchContext(timestamp: number = Date.now()): void {
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Sets the active entity in focus (e.g. 'NOTE', 'REMINDER').
 */
export function setActiveEntity(
  entity: SemanticEntity | null,
  timestamp: number = Date.now()
): void {
  currentContext.activeEntity = entity;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Sets the active collection type currently in focus.
 */
export function setActiveCollectionType(
  collectionType: SemanticEntity | null,
  timestamp: number = Date.now()
): void {
  currentContext.activeCollectionType = collectionType;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Updates the displayed items list (e.g. when reminders or notes are listed on screen).
 * Also automatically syncs activeCollectionType and activeEntity.
 */
export function setDisplayedItems(
  items: DisplayedItemRef[],
  collectionType?: SemanticEntity,
  timestamp: number = Date.now()
): void {
  // The displayed list is the authoritative positional view used by phrases
  // such as "la seconda". Re-index it on every refresh so deletions,
  // updates and filtered views can never leave stale ordinal positions behind.
  currentContext.displayedItems = items.map((item, index) => ({
    ...item,
    index: index + 1,
  }));
  if (collectionType) {
    currentContext.activeCollectionType = collectionType;
    currentContext.activeEntity = collectionType;
  }
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Sets the currently selected item (e.g. after a user references "il primo" or an item is created).
 * If item is provided, also records it in recentReferences.
 */
export function setSelectedItem(
  item: DisplayedItemRef | null,
  timestamp: number = Date.now(),
  verb?: SemanticVerb
): void {
  currentContext.selectedItem = item ? { ...item } : null;
  if (item) {
    currentContext.activeEntity = item.entity;
    addRecentReference(item.id, item.entity, timestamp, verb);
  }
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Adds an entity reference to the recent references ring-buffer.
 */
export function addRecentReference(
  id: string,
  entity: SemanticEntity,
  timestamp: number = Date.now(),
  verb?: SemanticVerb
): void {
  // Remove existing reference if present to bump to front
  const filtered = currentContext.recentReferences.filter(
    (r) => !(r.id === id && r.entity === entity)
  );

  currentContext.recentReferences = [
    { id, entity, timestamp, ...(verb ? { verb } : {}) },
    ...filtered,
  ].slice(0, MAX_RECENT_REFERENCES);

  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Records an action pending confirmation or parameter completion.
 */
export function setPendingAction(
  action: SemanticIntent | null,
  timestamp: number = Date.now()
): void {
  currentContext.pendingAction = action
    ? JSON.parse(JSON.stringify(action))
    : null;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Records a clarification request currently awaiting user response.
 */
export function setPendingClarification(
  clarification: SessionContext['pendingClarification'],
  timestamp: number = Date.now()
): void {
  currentContext.pendingClarification = clarification
    ? {
        type: clarification.type,
        candidates: clarification.candidates
          ? clarification.candidates.map((c) => ({ ...c }))
          : undefined,
        originalIntent: clarification.originalIntent
          ? JSON.parse(JSON.stringify(clarification.originalIntent))
          : undefined,
        missingParameter: clarification.missingParameter,
      }
    : null;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Sets the conversational topic string (used for topic shift audit).
 */
export function setCurrentTopic(
  topic: string,
  timestamp: number = Date.now()
): void {
  currentContext.currentTopic = topic.trim() || 'general';
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Records the last parsed user intent.
 */
export function setLastUserIntent(
  intent: SemanticIntent | null,
  timestamp: number = Date.now()
): void {
  currentContext.lastUserIntent = intent
    ? JSON.parse(JSON.stringify(intent))
    : null;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Records the last successfully verified action result.
 */
export function setLastSuccessfulAction(
  action: VerifiedActionResult | null,
  timestamp: number = Date.now()
): void {
  currentContext.lastSuccessfulAction = action ? { ...action } : null;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Records the last web search result in volatile conversational context (Phase 6G).
 */
export function setLastWebSearch(
  search: LastWebSearchResult | null,
  timestamp: number = Date.now()
): void {
  currentContext.lastWebSearch = search ? { ...search } : null;
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Sets a volatile temporary preference override for the active session (Phase 6H).
 */
export function setTemporaryPreference(
  key: string,
  value: unknown,
  timestamp: number = Date.now()
): void {
  currentContext.temporaryPreferences = {
    ...(currentContext.temporaryPreferences || {}),
    [key]: value,
  };
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Clears volatile temporary preferences.
 */
export function clearTemporaryPreferences(timestamp: number = Date.now()): void {
  currentContext.temporaryPreferences = {};
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Updates learning evidence list in active SessionContext.
 */
export function setLearningEvidence(
  evidence: SessionContext['learningEvidence'],
  timestamp: number = Date.now()
): void {
  currentContext.learningEvidence = evidence ? evidence.map((e) => ({ ...e })) : [];
  currentContext.lastActivityTimestamp = timestamp;
}

/**
 * Sets a pending preference candidate awaiting user confirmation.
 */
export function setPendingPreferenceCandidate(
  candidate: MaiaPreference | null,
  timestamp: number = Date.now()
): void {
  currentContext.pendingPreferenceCandidate = candidate ? { ...candidate } : null;
  currentContext.lastActivityTimestamp = timestamp;
}
