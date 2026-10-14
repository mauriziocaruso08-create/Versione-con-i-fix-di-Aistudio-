import {
  SemanticIntent,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import { executeWebSearch } from '../webSearchService';
import { TargetResolutionResult } from '../router/targetResolver';
import { MaiaCapability } from './types';

/**
 * Web Search Capability for MAIA (Phase 6G Web Search Hardening).
 *
 * ARCHITECTURAL REQUIREMENTS:
 * - Entity: WEB.
 * - Supported verbs: SEARCH, READ, EXPLAIN.
 * - Strict DO -> VERIFY -> REPORT pipeline.
 * - Real Google Search Grounding citations only; NEVER invent fake URLs or sources.
 * - Quota errors (429) & network failures reported honestly without mock fallback.
 */
export class WebCapability implements MaiaCapability {
  readonly entity = 'WEB' as const;
  readonly supportedVerbs = ['SEARCH', 'READ', 'EXPLAIN'] as const;

  canHandle(intent: SemanticIntent): boolean {
    return intent.entity === 'WEB';
  }

  async execute(
    intent: SemanticIntent,
    _context: SessionContext,
    _target?: TargetResolutionResult
  ): Promise<VerifiedActionResult> {
    const category = (intent.parameters.category as any) || 'general';
    const targetQuery =
      intent.parameters.searchQuery?.trim() ||
      intent.target.rawReference?.trim() ||
      intent.rawQuery.trim();

    if (!targetQuery) {
      return {
        status: 'FAILURE',
        entity: 'WEB',
        verb: 'SEARCH',
        feedbackText: 'Nessun termine valido specificato per la ricerca web.',
        dataAffected: false,
        error: 'EMPTY_QUERY',
      };
    }

    try {
      // 1. DO: Execute real-time web search with Google Search Grounding
      const result = await executeWebSearch({
        searchQuery: targetQuery,
        category,
      });

      // 2. VERIFY: Evaluate execution integrity and response content
      if (!result.success) {
        return {
          status: 'FAILURE',
          entity: 'WEB',
          verb: 'SEARCH',
          feedbackText: result.summary || 'Errore durante la ricerca sul web.',
          dataAffected: false,
          error: result.error,
          searchQuery: targetQuery,
        };
      }

      const summary = result.summary?.trim();
      const isEmptyOrNotFound =
        !summary ||
        /^(?:nessun\s+risultato\s+rilevante\s+trovato|nessuna\s+informazione\s+rilevante\s+trovata)\b/i.test(
          summary
        );

      if (isEmptyOrNotFound) {
        return {
          status: 'NOT_FOUND',
          entity: 'WEB',
          verb: 'SEARCH',
          feedbackText:
            summary ||
            'Non ho trovato risultati affidabili o aggiornati sul web per questa richiesta.',
          dataAffected: false,
          sources: [],
          searchQuery: targetQuery,
        };
      }

      // 3. REPORT: Maintain authentic source attribution without inventing fake URLs
      const validSources = (result.sources || []).filter(
        (s) => s && typeof s.url === 'string' && s.url.startsWith('http')
      );

      let formattedFeedback = summary;
      if (validSources.length > 0) {
        const sourceLinks = validSources
          .slice(0, 5) // Limit to top 5 verified sources
          .map((s) => `• [${s.title}](${s.url})`)
          .join('\n');

        // Append sources block if URL is not already embedded in summary
        if (!summary.includes(validSources[0].url)) {
          formattedFeedback = `${summary}\n\n**Fonti:**\n${sourceLinks}`;
        }
      }

      return {
        status: 'SUCCESS',
        entity: 'WEB',
        verb: 'SEARCH',
        feedbackText: formattedFeedback,
        dataAffected: false,
        sources: validSources,
        searchQuery: targetQuery,
      };
    } catch (err: any) {
      return {
        status: 'FAILURE',
        entity: 'WEB',
        verb: 'SEARCH',
        feedbackText:
          'Impossibile completare la ricerca sul web per un errore di connessione.',
        dataAffected: false,
        error: err?.message || 'UNKNOWN_ERROR',
        searchQuery: targetQuery,
      };
    }
  }
}
