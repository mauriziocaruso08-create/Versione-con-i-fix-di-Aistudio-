import {
  DisplayedItemRef,
  SemanticEntity,
  SemanticIntent,
  SessionContext,
} from '../../types/context';
import { getSessionTtlMs } from '../context/sessionContext';

export type TargetResolutionStatus =
  | 'RESOLVED'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  | 'UNRESOLVED'
  | 'NOT_APPLICABLE';

export type ResolutionSource =
  | 'EXPLICIT_ID'
  | 'DISPLAYED_ITEM'
  | 'SELECTED_ITEM'
  | 'RECENT_REFERENCE'
  | 'STORE_MATCH'
  | 'ALL_SCOPE';

export interface CandidateItem {
  id: string;
  entity: SemanticEntity;
  summary: string;
  index?: number;
}

export interface TargetResolutionResult {
  status: TargetResolutionStatus;
  entity: SemanticEntity;
  resolvedId?: string;
  matchedText?: string;
  source?: ResolutionSource;
  displayedIndex?: number;
  candidates?: CandidateItem[];
  clarificationPrompt?: string;
  scope?: 'SINGLE' | 'ALL';
}

export interface TargetItemLike {
  id: string;
  text: string;
  title?: string;
  completed?: boolean;
  dueAt?: string;
  createdAt?: string;
}

export interface TargetResolutionData {
  reminders?: TargetItemLike[];
  notes?: TargetItemLike[];
  now?: number;
}

/**
 * Checks if a SessionContext is expired based on inactivity timestamp.
 */
function isExpired(context: SessionContext, now: number = Date.now()): boolean {
  return now - context.lastActivityTimestamp > getSessionTtlMs();
}

/**
 * Clean and normalize text for strict substring/keyword matching.
 */
function normalizeForMatch(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\wÀ-ÿ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic Contextual Target Resolver for MAIA (Phase 6C).
 *
 * Resolves WHAT object or collection a SemanticIntent refers to,
 * without executing any action, writing to storage, or mutating context.
 */
export function resolveTarget(
  intent: SemanticIntent,
  context: SessionContext,
  data?: TargetResolutionData
): TargetResolutionResult {
  const currentNow = data?.now ?? Date.now();
  const contextIsExpired = isExpired(context, currentNow);

  // If intent is purely cognitive or non-action, target resolution is NOT_APPLICABLE
  if (intent.verb === 'EXPLAIN' || intent.verb === 'SEARCH') {
    return {
      status: 'NOT_APPLICABLE',
      entity: intent.entity,
      matchedText: intent.rawQuery,
    };
  }

  // CREATE does not target an existing item (except when creating a note/reminder without target)
  if (intent.verb === 'CREATE') {
    return {
      status: 'NOT_APPLICABLE',
      entity: intent.entity,
      matchedText: intent.parameters.text,
    };
  }

  // MEMORY entities target facts in UserMemory (resolved and managed by MemoryCapability)
  if (intent.entity === 'MEMORY') {
    return {
      status: 'RESOLVED',
      entity: 'MEMORY',
      matchedText: intent.parameters.text || intent.target.rawReference,
      source: 'STORE_MATCH',
      scope: intent.target.type === 'ALL' ? 'ALL' : 'SINGLE',
    };
  }

  // ==========================================================================
  // SOURCE 1: EXPLICIT ID
  // ==========================================================================
  if (intent.target.type === 'EXPLICIT_ID' && intent.target.resolvedId) {
    const targetId = intent.target.resolvedId;
    let foundText: string | undefined;

    if (intent.entity === 'REMINDER' && data?.reminders) {
      const match = data.reminders.find((r) => r.id === targetId);
      if (match) foundText = match.text;
    } else if (intent.entity === 'NOTE' && data?.notes) {
      const match = data.notes.find((n) => n.id === targetId);
      if (match) foundText = match.text;
    } else if (!data) {
      // If data is omitted, accept explicit ID directly
      return {
        status: 'RESOLVED',
        entity: intent.entity,
        resolvedId: targetId,
        source: 'EXPLICIT_ID',
        scope: 'SINGLE',
      };
    }

    if (foundText !== undefined) {
      return {
        status: 'RESOLVED',
        entity: intent.entity,
        resolvedId: targetId,
        matchedText: foundText,
        source: 'EXPLICIT_ID',
        scope: 'SINGLE',
      };
    }

    return {
      status: 'NOT_FOUND',
      entity: intent.entity,
      clarificationPrompt: `L'elemento con ID ${targetId} non è stato trovato.`,
    };
  }

  // ==========================================================================
  // SCOPE ALL RESOLUTION ("tutte le note", "tutti i promemoria", "cancella tutto")
  // ==========================================================================
  if (intent.target.type === 'ALL') {
    // Check if the entity is genuinely explicit or if it was a generic "cancella tutto"
    const rawLower = intent.rawQuery.toLowerCase().trim();
    const isGenericAll =
      intent.target.rawReference === 'tutto' ||
      /\b(?:cancella|elimina|rimuovi|svuota)\s+tutto\b/i.test(rawLower);

    // If it's a generic "cancella tutto" and the entity is UNKNOWN:
    // DO NOT blindly assume activeEntity! Require disambiguation.
    if (isGenericAll && intent.entity === 'UNKNOWN') {
      return {
        status: 'AMBIGUOUS',
        entity: 'UNKNOWN',
        scope: 'ALL',
        clarificationPrompt: 'Vuoi cancellare tutte le note o tutti i promemoria?',
      };
    }

    // If explicit entity is specified (e.g. "tutte le note", "tutti i promemoria")
    if (intent.entity === 'NOTE' || intent.entity === 'REMINDER') {
      return {
        status: 'RESOLVED',
        entity: intent.entity,
        source: 'ALL_SCOPE',
        scope: 'ALL',
        matchedText: intent.target.rawReference || 'tutti',
      };
    }

    return {
      status: 'UNRESOLVED',
      entity: 'UNKNOWN',
      clarificationPrompt: 'Vuoi cancellare tutte le note o tutti i promemoria?',
    };
  }

  // ==========================================================================
  // SOURCE 2: ORDINALS AGAINST DISPLAYED ITEMS
  // ==========================================================================
  if (intent.target.type === 'ORDINAL') {
    // If context is expired, displayedItems are unusable
    if (contextIsExpired || !context.displayedItems || context.displayedItems.length === 0) {
      return {
        status: 'NOT_FOUND',
        entity: intent.entity,
        clarificationPrompt:
          'Non ho un elenco recente visibile a schermo. Mostrami prima gli elementi per indicarne uno con la posizione.',
      };
    }

    // Filter displayedItems by matching entity (if intent entity is known)
    const matchingDisplayed = intent.entity !== 'UNKNOWN'
      ? context.displayedItems.filter((item) => item.entity === intent.entity)
      : context.displayedItems;

    if (matchingDisplayed.length === 0) {
      return {
        status: 'NOT_FOUND',
        entity: intent.entity,
        clarificationPrompt: `Non ci sono ${intent.entity.toLowerCase()} nell'elenco attualmente visualizzato.`,
      };
    }

    const ordIdx = intent.target.ordinalIndex ?? 1;

    // Handle "l'ultimo" (-1)
    let targetItem: DisplayedItemRef | undefined;
    if (ordIdx === -1) {
      targetItem = matchingDisplayed[matchingDisplayed.length - 1];
    } else {
      // 1-based index matching
      targetItem = matchingDisplayed.find((item) => item.index === ordIdx);
      if (!targetItem && ordIdx <= matchingDisplayed.length && ordIdx > 0) {
        targetItem = matchingDisplayed[ordIdx - 1];
      }
    }

    if (targetItem) {
      return {
        status: 'RESOLVED',
        entity: targetItem.entity,
        resolvedId: targetItem.id,
        matchedText: targetItem.summary,
        source: 'DISPLAYED_ITEM',
        displayedIndex: targetItem.index,
        scope: 'SINGLE',
      };
    }

    // Out of bounds
    return {
      status: 'NOT_FOUND',
      entity: intent.entity,
      clarificationPrompt: `La posizione richiesta (${ordIdx}) non è presente nell'elenco (ci sono ${matchingDisplayed.length} elementi).`,
    };
  }

  // ==========================================================================
  // SOURCE 3: RELATIVE_TIME ("l'ultima nota che ho modificato", "l'ultimo promemoria...")
  // ==========================================================================
  if (intent.target.type === 'RELATIVE_TIME') {
    if (contextIsExpired) {
      return {
        status: 'UNRESOLVED',
        entity: intent.entity,
        clarificationPrompt:
          'È passato troppo tempo dall\'ultima interazione. A quale elemento ti riferisci?',
      };
    }

    if (intent.entity === 'NOTE') {
      const isLastModified =
        intent.target.relativeAction === 'UPDATE' ||
        /\b(?:modificat|aggiornat|cambiat|corrett|riscritt)/i.test(intent.target.rawReference || '') ||
        /\b(?:modificat|aggiornat|cambiat|corrett|riscritt)/i.test(intent.rawQuery);

      const allNotes = data?.notes || [];

      if (isLastModified) {
        let candidateId: string | undefined;

        // 1. Check recentReferences ring-buffer for a note updated (most recent first)
        const recentUpdatedNote = (context.recentReferences || []).find(
          (r) => r.entity === 'NOTE' && r.verb === 'UPDATE'
        );
        if (recentUpdatedNote) {
          candidateId = recentUpdatedNote.id;
        }

        // 2. Check lastSuccessfulAction if it was a note update
        if (
          !candidateId &&
          context.lastSuccessfulAction?.entity === 'NOTE' &&
          context.lastSuccessfulAction?.verb === 'UPDATE' &&
          context.lastSuccessfulAction?.affectedId
        ) {
          candidateId = context.lastSuccessfulAction.affectedId;
        }

        // 3. Fallback: if selectedItem is NOTE and last action was an UPDATE
        if (
          !candidateId &&
          context.selectedItem?.entity === 'NOTE' &&
          context.lastSuccessfulAction?.verb === 'UPDATE'
        ) {
          candidateId = context.selectedItem.id;
        }

        if (candidateId) {
          const matchedNote = allNotes.find((n) => n.id === candidateId);
          if (matchedNote) {
            return {
              status: 'RESOLVED',
              entity: 'NOTE',
              resolvedId: matchedNote.id,
              matchedText: matchedNote.text,
              source: 'RECENT_REFERENCE',
              scope: 'SINGLE',
            };
          }
          return {
            status: 'NOT_FOUND',
            entity: 'NOTE',
            scope: 'SINGLE',
            clarificationPrompt: "L'ultima nota modificata non è più disponibile.",
          };
        }

        return {
          status: 'NOT_FOUND',
          entity: 'NOTE',
          scope: 'SINGLE',
          clarificationPrompt:
            'Non ho trovato nessuna nota modificata di recente a cui fare riferimento.',
        };
      }

      // Looking for last created or general recent note
      const isLastCreated =
        intent.target.relativeAction === 'CREATE' ||
        /\b(?:creat|salvat|aggiunt|pres)/i.test(intent.target.rawReference || '') ||
        /\b(?:creat|salvat|aggiunt|pres)/i.test(intent.rawQuery);

      let candidateId: string | undefined;
      if (isLastCreated) {
        const recentCreatedNote = (context.recentReferences || []).find(
          (r) => r.entity === 'NOTE' && r.verb === 'CREATE'
        );
        if (recentCreatedNote) {
          candidateId = recentCreatedNote.id;
        }
      }

      if (!candidateId) {
        const recentNote = (context.recentReferences || []).find((r) => r.entity === 'NOTE');
        if (recentNote) candidateId = recentNote.id;
      }

      if (candidateId) {
        const matchedNote = allNotes.find((n) => n.id === candidateId);
        if (matchedNote) {
          return {
            status: 'RESOLVED',
            entity: 'NOTE',
            resolvedId: matchedNote.id,
            matchedText: matchedNote.text,
            source: 'RECENT_REFERENCE',
            scope: 'SINGLE',
          };
        }
      }

      return {
        status: 'NOT_FOUND',
        entity: 'NOTE',
        scope: 'SINGLE',
        clarificationPrompt:
          'Non ho trovato nessuna nota recente a cui fare riferimento.',
      };
    }

    if (intent.entity === 'REMINDER') {
      const isLastModified =
        intent.target.relativeAction === 'UPDATE' ||
        /\b(?:modificat|aggiornat|cambiat|spostat|posticipat)/i.test(intent.target.rawReference || '') ||
        /\b(?:modificat|aggiornat|cambiat|spostat|posticipat)/i.test(intent.rawQuery);

      const allReminders = data?.reminders || [];

      if (isLastModified) {
        let candidateId: string | undefined;

        const recentUpdatedRem = (context.recentReferences || []).find(
          (r) => r.entity === 'REMINDER' && r.verb === 'UPDATE'
        );
        if (recentUpdatedRem) {
          candidateId = recentUpdatedRem.id;
        }

        if (
          !candidateId &&
          context.lastSuccessfulAction?.entity === 'REMINDER' &&
          context.lastSuccessfulAction?.verb === 'UPDATE' &&
          context.lastSuccessfulAction?.affectedId
        ) {
          candidateId = context.lastSuccessfulAction.affectedId;
        }

        if (candidateId) {
          const matchedRem = allReminders.find((r) => r.id === candidateId);
          if (matchedRem) {
            return {
              status: 'RESOLVED',
              entity: 'REMINDER',
              resolvedId: matchedRem.id,
              matchedText: matchedRem.text,
              source: 'RECENT_REFERENCE',
              scope: 'SINGLE',
            };
          }
          return {
            status: 'NOT_FOUND',
            entity: 'REMINDER',
            scope: 'SINGLE',
            clarificationPrompt: "L'ultimo promemoria modificato non è più disponibile.",
          };
        }

        return {
          status: 'NOT_FOUND',
          entity: 'REMINDER',
          scope: 'SINGLE',
          clarificationPrompt:
            'Non ho trovato nessun promemoria modificato di recente a cui fare riferimento.',
        };
      }

      let candidateId: string | undefined;
      const recentRem = (context.recentReferences || []).find((r) => r.entity === 'REMINDER');
      if (recentRem) candidateId = recentRem.id;

      if (candidateId) {
        const matchedRem = allReminders.find((r) => r.id === candidateId);
        if (matchedRem) {
          return {
            status: 'RESOLVED',
            entity: 'REMINDER',
            resolvedId: matchedRem.id,
            matchedText: matchedRem.text,
            source: 'RECENT_REFERENCE',
            scope: 'SINGLE',
          };
        }
      }

      return {
        status: 'NOT_FOUND',
        entity: 'REMINDER',
        scope: 'SINGLE',
        clarificationPrompt:
          'Non ho trovato nessun promemoria recente a cui fare riferimento.',
      };
    }
  }

  // ==========================================================================
  // SOURCE 4 & 5: PRONOUNS AGAINST SELECTED ITEM & RECENT REFERENCES
  // ==========================================================================
  // Normalize legacy parser output where standalone pronouns were emitted as TEXT_MATCH.
  if (intent.target.type === 'TEXT_MATCH' && intent.entity === 'REMINDER' &&
      /^(?:lo|la|questo|questa|quello|quella|spostalo|spostala|mettilo|mettila|rimandalo|rimandala|posticipalo|posticipala)$/i.test(intent.target.rawReference || '')) {
    intent = { ...intent, target: { type: 'PRONOUN', rawReference: intent.target.rawReference } };
  }

  if (intent.target.type === 'PRONOUN') {
    // If context is expired, pronoun references are strictly invalid
    if (contextIsExpired) {
      return {
        status: 'UNRESOLVED',
        entity: intent.entity,
        clarificationPrompt:
          'È passato troppo tempo dall\'ultima interazione. A quale elemento ti riferisci esattamente?',
      };
    }

    if (intent.entity === 'NOTE') {
      const allNotes = data?.notes || [];
      const recentNoteRefs = (context.recentReferences || []).filter((r) => r.entity === 'NOTE');
      const uniqueRecentIds = Array.from(new Set(recentNoteRefs.map((r) => r.id)));

      // An explicit selection is stronger than the historical reference ring.
      // This is critical for chains such as: "mostrami le note" -> "la seconda"
      // -> "modifica questa". The selected item is the user's active focus;
      // older references must not make that follow-up ambiguous.
      if (context.selectedItem && context.selectedItem.entity === 'NOTE' && (intent.target.rawReference || '').toLowerCase() === 'questa') {
        const item = context.selectedItem;
        const exists = allNotes.some((n) => n.id === item.id);
        if (exists) {
          return {
            status: 'RESOLVED',
            entity: 'NOTE',
            resolvedId: item.id,
            matchedText: allNotes.find((n) => n.id === item.id)?.text || item.summary,
            source: 'SELECTED_ITEM',
            displayedIndex: item.index,
            scope: 'SINGLE',
          };
        }
      }

      // If multiple distinct notes were recently created/referenced, "quella nota" is ambiguous
      if (uniqueRecentIds.length > 1) {
        const candidateItems: CandidateItem[] = [];
        for (let idx = 0; idx < uniqueRecentIds.length; idx++) {
          const id = uniqueRecentIds[idx];
          const n = allNotes.find((note) => note.id === id);
          if (n) {
            candidateItems.push({ id: n.id, entity: 'NOTE', summary: n.text, index: idx + 1 });
          }
        }

        if (candidateItems.length > 1) {
          return {
            status: 'AMBIGUOUS',
            entity: 'NOTE',
            candidates: candidateItems,
            clarificationPrompt: 'Ci sono più note recenti. Quale intendi modificare?',
          };
        }
      }

      // If displayedItems has multiple notes and none is selected
      const displayedNotes = (context.displayedItems || []).filter((item) => item.entity === 'NOTE');
      if (displayedNotes.length > 1 && !context.selectedItem) {
        const candidateItems: CandidateItem[] = displayedNotes.map((d) => ({
          id: d.id,
          entity: 'NOTE',
          summary: d.summary,
          index: d.index,
        }));
        return {
          status: 'AMBIGUOUS',
          entity: 'NOTE',
          candidates: candidateItems,
          clarificationPrompt: 'Ho trovato più note. A quale ti riferisci?',
        };
      }

      // If exactly 1 recent reference exists
      if (uniqueRecentIds.length === 1) {
        const id = uniqueRecentIds[0];
        const match = allNotes.find((n) => n.id === id);
        if (match) {
          return {
            status: 'RESOLVED',
            entity: 'NOTE',
            resolvedId: match.id,
            matchedText: match.text,
            source: 'RECENT_REFERENCE',
            scope: 'SINGLE',
          };
        }
      }

      // If exactly 1 note exists in the database
      if (allNotes.length === 1) {
        return {
          status: 'RESOLVED',
          entity: 'NOTE',
          resolvedId: allNotes[0].id,
          matchedText: allNotes[0].text,
          source: 'STORE_MATCH',
          scope: 'SINGLE',
        };
      } else if (allNotes.length > 1 && uniqueRecentIds.length === 0) {
        const candidateItems: CandidateItem[] = allNotes.map((n, i) => ({
          id: n.id,
          entity: 'NOTE',
          summary: n.text,
          index: i + 1,
        }));
        return {
          status: 'AMBIGUOUS',
          entity: 'NOTE',
          candidates: candidateItems,
          clarificationPrompt: 'Ci sono più note. Quale nota vuoi modificare?',
        };
      }
    }

    if (intent.entity === 'REMINDER') {
      const allReminders = data?.reminders || [];
      const recentRemRefs = (context.recentReferences || []).filter((r) => r.entity === 'REMINDER');
      const uniqueRecentIds = Array.from(new Set(recentRemRefs.map((r) => r.id)));

      // Explicit selection wins over older reminder references for pronoun
      // follow-ups ("spostalo", "modifica quello", etc.).
      if (context.selectedItem && context.selectedItem.entity === 'REMINDER') {
        const item = context.selectedItem;
        const exists = allReminders.some((r) => r.id === item.id);
        if (exists) {
          const current = allReminders.find((r) => r.id === item.id);
          return {
            status: 'RESOLVED',
            entity: 'REMINDER',
            resolvedId: item.id,
            matchedText: current?.text || item.summary,
            source: 'SELECTED_ITEM',
            displayedIndex: item.index,
            scope: 'SINGLE',
          };
        }
      }

      if (uniqueRecentIds.length > 1) {
        const candidateItems: CandidateItem[] = [];
        for (let idx = 0; idx < uniqueRecentIds.length; idx++) {
          const id = uniqueRecentIds[idx];
          const r = allReminders.find((rem) => rem.id === id);
          if (r) {
            candidateItems.push({ id: r.id, entity: 'REMINDER', summary: r.text, index: idx + 1 });
          }
        }

        if (candidateItems.length > 1) {
          return {
            status: 'AMBIGUOUS',
            entity: 'REMINDER',
            candidates: candidateItems,
            clarificationPrompt: 'Ci sono più promemoria recenti. A quale ti riferisci?',
          };
        }
      }

      const displayedRems = (context.displayedItems || []).filter((item) => item.entity === 'REMINDER');
      if (displayedRems.length > 1 && !context.selectedItem) {
        const candidateItems: CandidateItem[] = displayedRems.map((d) => ({
          id: d.id,
          entity: 'REMINDER',
          summary: d.summary,
          index: d.index,
        }));
        return {
          status: 'AMBIGUOUS',
          entity: 'REMINDER',
          candidates: candidateItems,
          clarificationPrompt: 'Ho trovato più promemoria. A quale ti riferisci?',
        };
      }

      if (uniqueRecentIds.length === 1) {
        const id = uniqueRecentIds[0];
        const match = allReminders.find((r) => r.id === id);
        if (match) {
          return {
            status: 'RESOLVED',
            entity: 'REMINDER',
            resolvedId: match.id,
            matchedText: match.text,
            source: 'RECENT_REFERENCE',
            scope: 'SINGLE',
          };
        }
      }

      if (allReminders.length === 1) {
        return {
          status: 'RESOLVED',
          entity: 'REMINDER',
          resolvedId: allReminders[0].id,
          matchedText: allReminders[0].text,
          source: 'STORE_MATCH',
          scope: 'SINGLE',
        };
      } else if (allReminders.length > 1 && uniqueRecentIds.length === 0) {
        const candidateItems: CandidateItem[] = allReminders.map((r, i) => ({
          id: r.id,
          entity: 'REMINDER',
          summary: r.text,
          index: i + 1,
        }));
        return {
          status: 'AMBIGUOUS',
          entity: 'REMINDER',
          candidates: candidateItems,
          clarificationPrompt: 'Ci sono più promemoria. Quale vuoi modificare?',
        };
      }
    }

    // Default fallback: UNKNOWN pronouns ("questo/quello") still resolve
    // against the active selection when the selection's entity is compatible.
    if (context.selectedItem) {
      const item = context.selectedItem;
      const entityMatches = intent.entity === 'UNKNOWN' || intent.entity === item.entity;
      if (entityMatches) {
        return {
          status: 'RESOLVED',
          entity: item.entity,
          resolvedId: item.id,
          matchedText: item.summary,
          source: 'SELECTED_ITEM',
          displayedIndex: item.index,
          scope: 'SINGLE',
        };
      }
    }

    return {
      status: 'UNRESOLVED',
      entity: intent.entity,
      clarificationPrompt:
        'A quale elemento ti riferisci? Non ho un elemento selezionato di recente.',
    };
  }

  // ==========================================================================
  // SOURCE 5: TEXT_MATCH IN DATASET
  // ==========================================================================
  if (intent.target.type === 'TEXT_MATCH') {
    const rawSearch = intent.target.matchedText || intent.target.rawReference || '';
    const cleanSearch = normalizeForMatch(rawSearch);

    if (!cleanSearch) {
      return {
        status: 'UNRESOLVED',
        entity: intent.entity,
        clarificationPrompt: 'Specifica quale elemento desideri selezionare.',
      };
    }

    // Determine target pool based on entity
    let itemsToSearch: Array<{ id: string; text: string; title?: string; dueAt?: string; entity: SemanticEntity }> = [];

    if (intent.entity === 'REMINDER' || intent.entity === 'UNKNOWN') {
      if (data?.reminders) {
        itemsToSearch.push(
          ...data.reminders.map((r) => ({ id: r.id, text: r.text, dueAt: r.dueAt, entity: 'REMINDER' as SemanticEntity }))
        );
      }
    }
    if (intent.entity === 'NOTE' || intent.entity === 'UNKNOWN') {
      if (data?.notes) {
        itemsToSearch.push(
          ...data.notes.map((n) => ({ id: n.id, text: n.text, title: n.title, entity: 'NOTE' as SemanticEntity }))
        );
      }
    }

    if (itemsToSearch.length === 0) {
      return {
        status: 'NOT_FOUND',
        entity: intent.entity,
        clarificationPrompt: `Nessun elemento trovato per "${rawSearch}".`,
      };
    }

    let keywordSearch = cleanSearch
      .replace(/^(?:quell[oa]\s+(?:che\s+parla\s+d[eio][l']?|sul?l?[aoei']?|d[eio][l']?)|la\s+nota\s+(?:sul?l?[aoei']?|d[eio][l']?)|il\s+promemoria\s+(?:sul?l?[aoei']?|d[eio][l']?)|che\s+parla\s+d[eio][l']?|sulla|sui|sul|sulle|della|del|di)\s+/i, '')
      .trim();
    if (!keywordSearch) keywordSearch = cleanSearch;

    // Match candidate items
    const exactMatches: Array<{ id: string; text: string; title?: string; entity: SemanticEntity }> = [];
    const substringMatches: Array<{ id: string; text: string; title?: string; entity: SemanticEntity }> = [];

    for (const item of itemsToSearch) {
      const normItem = normalizeForMatch(item.text);
      const normTitle = item.title ? normalizeForMatch(item.title) : '';
      const exactTitle = normTitle && (normTitle === cleanSearch || (keywordSearch && normTitle === keywordSearch));
      const exactText = normItem === cleanSearch || (keywordSearch && normItem === keywordSearch);
      const substringTitle = normTitle && (normTitle.includes(cleanSearch) || cleanSearch.includes(normTitle) || (keywordSearch && normTitle.includes(keywordSearch)));
      if (exactTitle || exactText) {
        exactMatches.push(item);
      } else if (
        normItem.includes(cleanSearch) ||
        cleanSearch.includes(normItem) ||
        (keywordSearch && normItem.includes(keywordSearch)) ||
        substringTitle
      ) {
        substringMatches.push(item);
      } else if (keywordSearch === 'domani' && item.dueAt) {
        const itemDate = new Date(item.dueAt);
        const tom = new Date(currentNow + 24 * 60 * 60 * 1000);
        if (itemDate.getDate() === tom.getDate() && itemDate.getMonth() === tom.getMonth()) {
          substringMatches.push(item);
        }
      }
    }

    const matches = exactMatches.length > 0 ? exactMatches : substringMatches;

    if (matches.length === 1) {
      const single = matches[0];
      return {
        status: 'RESOLVED',
        entity: single.entity,
        resolvedId: single.id,
        matchedText: single.title ? `${single.title}: ${single.text}` : single.text,
        source: 'STORE_MATCH',
        scope: 'SINGLE',
      };
    }

    if (matches.length > 1) {
      const candidates: CandidateItem[] = matches.map((m, i) => ({
        id: m.id,
        entity: m.entity,
        summary: m.text,
        index: i + 1,
      }));

      const resolvedEntity =
        intent.entity !== 'UNKNOWN'
          ? intent.entity
          : candidates.length > 0 && candidates.every((c) => c.entity === candidates[0].entity)
          ? candidates[0].entity
          : 'UNKNOWN';

      const entityName =
        resolvedEntity === 'NOTE'
          ? 'note'
          : resolvedEntity === 'REMINDER'
          ? 'promemoria'
          : 'elementi';

      const candidateList = candidates
        .map((c, i) => `${i + 1}. "${c.summary}"`)
        .join(', ');

      const actionQuestion =
        intent.verb === 'UPDATE'
          ? 'Quale intendi modificare?'
          : intent.verb === 'DELETE'
          ? 'Quale intendi eliminare?'
          : 'Quale intendi selezionare?';

      return {
        status: 'AMBIGUOUS',
        entity: resolvedEntity,
        candidates,
        clarificationPrompt: `Ho trovato più ${entityName} corrispondenti a "${rawSearch}" (${candidateList}). ${actionQuestion}`,
      };
    }

    return {
      status: 'NOT_FOUND',
      entity: intent.entity,
      clarificationPrompt: `Non ho trovato alcun elemento corrispondente a "${rawSearch}".`,
    };
  }

  // ==========================================================================
  // UNRESOLVED FALLBACK (Contextual single candidate or active item)
  // ==========================================================================
  if (intent.target.type === 'UNRESOLVED') {
    // Destructive generic delete must not silently inherit a selected item when
    // multiple candidates exist. Safety first: ask the user which one.
    if (intent.verb === 'DELETE' && intent.entity === 'REMINDER' && data?.reminders && data.reminders.length > 1) {
      const candidates: CandidateItem[] = data.reminders.map((r, i) => ({
        id: r.id,
        entity: 'REMINDER',
        summary: r.text,
        index: i + 1,
      }));
      return {
        status: 'AMBIGUOUS',
        entity: 'REMINDER',
        candidates,
        clarificationPrompt: `Ci sono più promemoria. Quale vuoi eliminare? ${candidates.map((c) => `${c.index}. "${c.summary}"`).join(', ')}`,
      };
    }
    if (intent.verb === 'DELETE' && intent.entity === 'NOTE' && data?.notes && data.notes.length > 1) {
      const candidates: CandidateItem[] = data.notes.map((n, i) => ({
        id: n.id,
        entity: 'NOTE',
        summary: n.text,
        index: i + 1,
      }));
      return {
        status: 'AMBIGUOUS',
        entity: 'NOTE',
        candidates,
        clarificationPrompt: `Ci sono più note. Quale vuoi eliminare? ${candidates.map((c) => `${c.index}. "${c.summary}"`).join(', ')}`,
      };
    }

    // Check if context has an active selected item matching the entity
    if (!contextIsExpired && context.selectedItem) {
      const sel = context.selectedItem;
      if (sel.entity === intent.entity || intent.entity === 'UNKNOWN') {
        return {
          status: 'RESOLVED',
          entity: sel.entity,
          resolvedId: sel.id,
          matchedText: sel.summary,
          source: 'SELECTED_ITEM',
          displayedIndex: sel.index,
          scope: 'SINGLE',
        };
      }
    }

    // Check if displayedItems has exactly 1 item
    if (!contextIsExpired && context.displayedItems && context.displayedItems.length === 1) {
      const singleDisp = context.displayedItems[0];
      if (singleDisp.entity === intent.entity || intent.entity === 'UNKNOWN') {
        return {
          status: 'RESOLVED',
          entity: singleDisp.entity,
          resolvedId: singleDisp.id,
          matchedText: singleDisp.summary,
          source: 'DISPLAYED_ITEM',
          displayedIndex: singleDisp.index,
          scope: 'SINGLE',
        };
      }
    }

    // Check if underlying dataset has exactly 1 item for the entity (ONLY for read/complete or when non-UPDATE)
    if (intent.verb !== 'UPDATE') {
      if (intent.entity === 'NOTE' && data?.notes && data.notes.length === 1) {
        const singleNote = data.notes[0];
        return {
          status: 'RESOLVED',
          entity: 'NOTE',
          resolvedId: singleNote.id,
          matchedText: singleNote.text,
          source: 'STORE_MATCH',
          scope: 'SINGLE',
        };
      }

      if (intent.entity === 'REMINDER' && data?.reminders && data.reminders.length === 1) {
        const singleRem = data.reminders[0];
        return {
          status: 'RESOLVED',
          entity: 'REMINDER',
          resolvedId: singleRem.id,
          matchedText: singleRem.text,
          source: 'STORE_MATCH',
          scope: 'SINGLE',
        };
      }
    } else {
      // For UPDATE without target, if there are multiple notes or reminders, return AMBIGUOUS with list
      if (intent.entity === 'NOTE' && data?.notes && data.notes.length > 1) {
        const candidates: CandidateItem[] = data.notes.map((n, i) => ({
          id: n.id,
          entity: 'NOTE',
          summary: n.text,
          index: i + 1,
        }));
        const candidateList = candidates.map((c, i) => `${i + 1}. "${c.summary}"`).join(', ');
        return {
          status: 'AMBIGUOUS',
          entity: 'NOTE',
          candidates,
          clarificationPrompt: `Ho trovato più note (${candidateList}). Quale nota vuoi modificare?`,
        };
      }
      if (intent.entity === 'REMINDER' && data?.reminders && data.reminders.length > 1) {
        const candidates: CandidateItem[] = data.reminders.map((r, i) => ({
          id: r.id,
          entity: 'REMINDER',
          summary: r.text,
          index: i + 1,
        }));
        const candidateList = candidates.map((c, i) => `${i + 1}. "${c.summary}"`).join(', ');
        return {
          status: 'AMBIGUOUS',
          entity: 'REMINDER',
          candidates,
          clarificationPrompt: `Ho trovato più promemoria (${candidateList}). Quale promemoria vuoi spostare o modificare?`,
        };
      }
    }
  }

  return {
    status: 'UNRESOLVED',
    entity: intent.entity,
    clarificationPrompt:
      intent.entity === 'NOTE'
        ? intent.verb === 'UPDATE'
          ? 'Quale nota vuoi modificare?'
          : intent.verb === 'DELETE'
          ? 'Quale nota vuoi eliminare?'
          : 'Quale nota vorresti selezionare?'
        : intent.entity === 'REMINDER'
        ? intent.verb === 'UPDATE'
          ? 'Quale promemoria vuoi spostare o modificare?'
          : intent.verb === 'DELETE'
          ? 'Quale promemoria vuoi eliminare?'
          : 'Quale promemoria vorresti selezionare?'
        : 'Quale elemento vorresti selezionare?',
  };
}
