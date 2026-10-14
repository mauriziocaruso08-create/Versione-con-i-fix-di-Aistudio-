import {
  SemanticEntity,
  SemanticIntent,
  SemanticVerb,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import { TargetResolutionResult } from '../router/targetResolver';

export interface MaiaCapability {
  entity: SemanticEntity;
  supportedVerbs: readonly SemanticVerb[] | SemanticVerb[];

  canHandle(intent: SemanticIntent, context: SessionContext): boolean;

  execute(
    intent: SemanticIntent,
    context: SessionContext,
    target?: TargetResolutionResult
  ): Promise<VerifiedActionResult>;
}
