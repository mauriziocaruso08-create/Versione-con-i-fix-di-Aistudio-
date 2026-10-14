import { RouterResolution } from '../../types/actions';
import { SemanticIntent } from '../../types/context';
import { TargetResolutionResult } from './targetResolver';
import { RiskCategory } from './safetyGuard';

/**
 * Default confirmation timeout: 2 minutes (in milliseconds).
 */
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000;
const CONFIRMATION_STORAGE_KEY = 'maia_pending_confirmation_v1';

/**
 * Represents a pending confirmation for a destructive action.
 * The active copy is kept in memory and mirrored to localStorage for short-lived
 * runtime recovery; the confirmation expires after the configured TTL.
 */
export interface PendingConfirmation {
  id: string;
  resolution: RouterResolution;
  intent?: SemanticIntent;
  targetResult?: TargetResolutionResult;
  riskCategory?: RiskCategory;
  createdAt: number;
  expiresAt: number;
}

/**
 * Classification of user reply to a confirmation prompt.
 */
export type ConfirmationReply =
  | 'CONFIRM'
  | 'CANCEL'
  | 'AMBIGUOUS'
  | 'NOT_A_CONFIRMATION'
  | 'EXPIRED';

/**
 * Result returned when evaluating a user reply against a pending confirmation.
 */
export interface ConfirmationResolution {
  status:
    | 'CONFIRMED'
    | 'CANCELLED'
    | 'AMBIGUOUS'
    | 'NOT_A_CONFIRMATION'
    | 'EXPIRED'
    | 'NO_PENDING_CONFIRMATION';
  confirmationId?: string;
  resolution?: RouterResolution;
  pendingConfirmation?: PendingConfirmation;
  message?: string;
}

// Safety-critical confirmation state is mirrored to localStorage so a transient
// Preview/runtime reload cannot silently turn the next "sì" into a Gemini chat.
let activePendingConfirmation: PendingConfirmation | null = null;

function persistPendingConfirmation(pending: PendingConfirmation | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!pending) localStorage.removeItem(CONFIRMATION_STORAGE_KEY);
    else localStorage.setItem(CONFIRMATION_STORAGE_KEY, JSON.stringify(pending));
  } catch (_) {}
}

function restorePendingConfirmation(): PendingConfirmation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONFIRMATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingConfirmation;
    if (!parsed || !parsed.resolution || !parsed.expiresAt) return null;
    if (Date.now() >= parsed.expiresAt) {
      localStorage.removeItem(CONFIRMATION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}
let currentTimeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS;

/**
 * Sets a custom timeout for confirmations (useful for testing or configuration).
 */
export function setConfirmationTimeoutMs(timeoutMs: number): void {
  currentTimeoutMs = timeoutMs;
}

/**
 * Resets the confirmation timeout to default (2 minutes).
 */
export function resetConfirmationTimeoutMs(): void {
  currentTimeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS;
}

/**
 * Clears any currently active pending confirmation.
 */
export function clearPendingConfirmation(): void {
  activePendingConfirmation = null;
  persistPendingConfirmation(null);
}

/**
 * Creates a pending confirmation for a destructive action.
 *
 * SAFETY RULES:
 * 1. Non-destructive actions are safely rejected (returns null).
 * 2. If a pending confirmation already exists, it is replaced by the newest one
 *    (the previous confirmation is invalidated deterministically).
 * 3. Stores an immutable deep copy of the exact RouterResolution and intent.
 */
export function createPendingConfirmation(
  resolution: RouterResolution,
  now?: number,
  metadata?: {
    intent?: SemanticIntent;
    targetResult?: TargetResolutionResult;
    riskCategory?: RiskCategory;
  }
): PendingConfirmation | null {
  // Reject non-destructive actions safely
  if (resolution.payload?.isDestructive !== true) {
    return null;
  }

  const timestamp = now ?? Date.now();
  const id = `conf-${timestamp}-${Math.random().toString(36).slice(2, 7)}`;

  // Deep clone resolution and metadata to guarantee absolute immutability
  const clonedResolution: RouterResolution = JSON.parse(JSON.stringify(resolution));
  const clonedIntent = metadata?.intent ? JSON.parse(JSON.stringify(metadata.intent)) : undefined;
  const clonedTargetResult = metadata?.targetResult ? JSON.parse(JSON.stringify(metadata.targetResult)) : undefined;

  const pending: PendingConfirmation = {
    id,
    resolution: clonedResolution,
    intent: clonedIntent,
    targetResult: clonedTargetResult,
    riskCategory: metadata?.riskCategory,
    createdAt: timestamp,
    expiresAt: timestamp + currentTimeoutMs,
  };

  // Replace any existing pending confirmation with the newest one
  activePendingConfirmation = pending;
  persistPendingConfirmation(pending);

  return pending;
}

/**
 * Retrieves the currently active pending confirmation, verifying expiration.
 * If expired, it is automatically cleared and null is returned.
 */
export function getPendingConfirmation(now?: number): PendingConfirmation | null {
  if (!activePendingConfirmation) {
    activePendingConfirmation = restorePendingConfirmation();
  }

  if (!activePendingConfirmation) {
    return null;
  }

  const currentTime = now ?? Date.now();
  if (currentTime >= activePendingConfirmation.expiresAt) {
    clearPendingConfirmation();
    return null;
  }

  return activePendingConfirmation;
}

/**
 * Normalizes input text for confirmation reply classification.
 */
function cleanReply(text: string): string {
  return text.trim().toLowerCase().replace(/[.?!;:,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Evaluates a user reply against the active pending confirmation.
 *
 * CRITICAL SAFETY RULES:
 * - One-time confirmation: on 'CONFIRMED' or 'CANCELLED', the pending state is cleared immediately.
 * - An ambiguous reply leaves the pending confirmation intact for clarification.
 * - An unrelated command clears the pending confirmation so it cannot be triggered accidentally later.
 * - On 'CONFIRMED', returns the exact original RouterResolution with status transitioned to 'DETERMINISTIC_LOCAL'.
 */
export function resolveConfirmationReply(
  reply: string,
  now?: number
): ConfirmationResolution {
  const currentTime = now ?? Date.now();

  // 1. Restore safety-critical confirmation after a transient runtime reload.
  if (!activePendingConfirmation) {
    activePendingConfirmation = restorePendingConfirmation();
  }

  // 2. Check if there is an active pending confirmation
  if (!activePendingConfirmation) {
    return {
      status: 'NO_PENDING_CONFIRMATION',
      message: 'Nessuna operazione in attesa di conferma.',
    };
  }

  // 3. Check expiration
  if (currentTime >= activePendingConfirmation.expiresAt) {
    const expiredId = activePendingConfirmation.id;
    clearPendingConfirmation();
    return {
      status: 'EXPIRED',
      confirmationId: expiredId,
      message: 'La richiesta di conferma è scaduta. L\'operazione non è stata eseguita.',
    };
  }

  const clean = cleanReply(reply);
  const currentPending = activePendingConfirmation;

  // 4. Affirmative reply check
  // e.g. "sì", "si", "confermo", "conferma", "vai", "procedi", "ok", "okay", "fallo", "fai pure", etc.
  const affirmativeRegex = /^(?:s[ìi]|si|confermo|conferma|vai|procedi|ok|okay|fallo|fai pure|d['’]accordo|volentieri|yes)(?:\s+(?:confermo|conferma|elimina|cancella|rimuovi|delete|remove|procedi|vai|fallo|fai|pure|it|it please))?$/i;
  if (affirmativeRegex.test(clean)) {
    // Transition status to DETERMINISTIC_LOCAL for execution by ActionExecutor
    const confirmedResolution: RouterResolution = {
      ...JSON.parse(JSON.stringify(currentPending.resolution)),
      status: 'DETERMINISTIC_LOCAL',
    };

    // One-time execution: clear pending confirmation immediately
    clearPendingConfirmation();

    return {
      status: 'CONFIRMED',
      confirmationId: currentPending.id,
      resolution: confirmedResolution,
      pendingConfirmation: currentPending,
      message: 'Operazione confermata.',
    };
  }

  // 5. Cancellation reply check
  // e.g. "no", "annulla", "cancella", "cancel", "lascia perdere", "non farlo", "fermati", "stop", etc.
  const negativeRegex =
    /^(?:no|annulla|annullami|cancella|cancel|lascia\s+perdere|lascia\s+stare|non\s+farlo|fermati|stop|non\s+cancellare|non\s+eliminare|nope|rifiuta|niente)$/i;
  if (negativeRegex.test(clean)) {
    const cancelledResolution = JSON.parse(JSON.stringify(currentPending.resolution));
    clearPendingConfirmation();

    return {
      status: 'CANCELLED',
      confirmationId: currentPending.id,
      resolution: cancelledResolution,
      pendingConfirmation: currentPending,
      message: 'Operazione annullata.',
    };
  }

  // 6. Ambiguous reply check
  // e.g. "forse", "non lo so", "aspetta", "quello", "quella", "sì ma...", "ma quale?", "ok ma spiegami", "va bene?", "fallo dopo"
  const ambiguousRegex =
    /^(?:forse|non\s+lo\s+so|aspetta|aspettami|quello|quella|questo|questa|quello\s+l[ìi]|ma\s+quale\??|ok\s+ma\s+spiegami|s[ìi]\s+ma.*|va\s+bene\??|fallo\s+dopo|dopo|vediamo|mah|non\s+saprei|ci\s+penso|chiss[àa])$/i;
  if (ambiguousRegex.test(clean)) {
    // Keep pending confirmation active so the user can still answer clearly
    return {
      status: 'AMBIGUOUS',
      confirmationId: currentPending.id,
      pendingConfirmation: currentPending,
      message: 'Risposta non chiara. Rispondi con "sì" per confermare o "no" per annullare.',
    };
  }

  // 7. Unrelated command check
  // e.g. "Che tempo fa domani?", "Quanto fa 837 × 46?", "Raccontami una barzelletta"
  // Clear the pending confirmation so it cannot accidentally be confirmed in subsequent turns
  clearPendingConfirmation();

  return {
    status: 'NOT_A_CONFIRMATION',
    confirmationId: currentPending.id,
    message: 'La richiesta non è una risposta di conferma.',
  };
}
