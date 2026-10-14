import { MaiaCapability } from '../capabilities/types';
import {
  SemanticIntent,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import { TargetResolutionResult } from '../router/targetResolver';

/**
 * MAIA Verify & Recovery layer.
 *
 * Capabilities are responsible for their own postcondition checks. This layer
 * sits above them and guarantees that an unexpected exception can never be
 * reported as success. Read-only operations may be retried once because a
 * retry cannot duplicate user data. Mutating operations are deliberately NOT
 * retried automatically: if a write throws after changing storage, retrying
 * could create duplicates.
 */
export async function executeCapabilityWithRecovery(
  capability: MaiaCapability,
  intent: SemanticIntent,
  context: SessionContext,
  target?: TargetResolutionResult
): Promise<VerifiedActionResult> {
  const execute = async (): Promise<VerifiedActionResult> => {
    try {
      const result = await capability.execute(intent, context, target);

      // A capability is only allowed to claim success with a real result.
      if (!result || typeof result !== 'object' || !result.status) {
        return failureResult(intent, 'Capability returned an invalid result.');
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message || 'Unknown capability execution error');
    }
  };

  try {
    return await execute();
  } catch (error) {
    // Safe recovery: retry only operations that cannot mutate persistent data.
    if (intent.verb === 'READ') {
      try {
        return await execute();
      } catch (retryError) {
        return failureResult(
          intent,
          `Operazione di lettura fallita anche dopo il tentativo di recupero: ${errorMessage(retryError)}`
        );
      }
    }

    return failureResult(
      intent,
      `Operazione non completata. Nessun secondo tentativo automatico è stato eseguito per evitare duplicazioni. Errore: ${errorMessage(error)}`
    );
  }
}

function failureResult(intent: SemanticIntent, error: string): VerifiedActionResult {
  return {
    status: 'FAILURE',
    entity: intent.entity,
    verb: intent.verb,
    feedbackText: 'Non posso confermare che l’operazione sia andata a buon fine.',
    dataAffected: false,
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
