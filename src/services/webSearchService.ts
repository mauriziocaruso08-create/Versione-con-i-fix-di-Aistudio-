import { WebSearchParams, WebSearchResult } from '../types/actions';

/**
 * Service responsible solely for communicating with the MAIA backend web search endpoint (/api/search).
 *
 * SAFETY & ARCHITECTURAL RULES (Phase 6G Web Search Hardening):
 * - Client-side only calls the local proxy endpoint `/api/search`.
 * - No API keys or secrets are stored, imported, or exposed here.
 * - Side-effect free: does not access localStorage, React state, or audio.
 * - Does not contact Gemini directly.
 * - Handles timeouts, quota limits (429), API failures, and source validation.
 */
export async function executeWebSearch(
  params: WebSearchParams,
  timeoutMs: number = 25000
): Promise<WebSearchResult> {
  const query = params.searchQuery?.trim();
  if (!query) {
    return {
      success: false,
      query: '',
      summary: 'Nessun termine di ricerca specificato.',
      error: 'La query di ricerca non può essere vuota.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        category: params.category || 'general',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const isQuotaStatus = response.status === 429;
    let data: any = {};
    try {
      data = await response.json();
    } catch (parseErr) {
      data = {};
    }

    const isQuota =
      isQuotaStatus ||
      Boolean(data.isQuota) ||
      /\b(?:429|quota|RESOURCE_EXHAUSTED)\b/i.test(data.error || '');

    if (!response.ok || !data.success) {
      if (isQuota) {
        return {
          success: false,
          query,
          summary: 'Limite di richieste superato per la ricerca web (errore 429 / quota esaurita). Riprova tra poco.',
          error: 'QUOTA_EXHAUSTED',
        };
      }

      return {
        success: false,
        query,
        summary: data.error || `Errore HTTP durante la ricerca web (${response.status}).`,
        error: data.error || `Errore HTTP ${response.status}`,
      };
    }

    // Validate sources: keep only well-formed URLs, avoid hallucinating fake ones
    const rawSources = Array.isArray(data.sources) ? data.sources : [];
    const validSources = rawSources
      .filter((s: any) => s && typeof s.url === 'string' && s.url.startsWith('http'))
      .map((s: any) => ({
        title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : 'Fonte Web',
        url: s.url.trim(),
      }));

    return {
      success: true,
      query: data.query || query,
      summary: data.summary || 'Nessuna informazione rilevante trovata.',
      sources: validSources,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      return {
        success: false,
        query,
        summary: 'La ricerca web ha richiesto troppo tempo (timeout di connessione). Riprova più tardi.',
        error: 'TIMEOUT',
      };
    }

    console.warn('Web search network error:', err?.message || err);
    return {
      success: false,
      query,
      summary: 'Impossibile completare la ricerca sul web per problemi di connessione.',
      error: err?.message || 'Errore di connessione al servizio di ricerca.',
    };
  }
}

