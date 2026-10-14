import {
  SemanticIntent,
  SessionContext,
  VerifiedActionResult,
} from '../../types/context';
import { handleMemoryCommand } from '../../utils/memoryManager';
import { loadUserMemory, saveUserMemory } from '../router/actionExecutor';
import { TargetResolutionResult } from '../router/targetResolver';
import { MaiaCapability } from './types';
import {
  formatPreferencesForDisplay,
  isPreferenceQuery,
  isPreferenceReset,
  isSensitiveInformation,
  parsePreferenceStatement,
  recordLearningEvidence,
  removePreferenceByKeyOrText,
  saveOrUpdatePreference,
  saveOrUpdatePersonalFact,
} from '../learning/preferenceManager';
import {
  setPendingPreferenceCandidate,
  setTemporaryPreference,
} from '../context/sessionContext';
import { NOTES_STORAGE_KEY, loadNotes } from '../../utils/notesManager';
import { REMINDERS_STORAGE_KEY, loadReminders } from '../../utils/reminderManager';

function toUserPerspective(text: string): string {
  return text
    .replace(/\bIl mio\b/gi, 'Il tuo')
    .replace(/\bLa mia\b/gi, 'La tua')
    .replace(/\bI miei\b/gi, 'I tuoi')
    .replace(/\bLe mie\b/gi, 'Le tue')
    .replace(/\bMi piace\b/gi, 'Ti piace')
    .replace(/\bPreferisco\b/gi, 'Preferisci');
}

function _contextLastMemoryKey(context: SessionContext): string | undefined {
  const id = context.lastSuccessfulAction?.affectedId;
  return id || undefined;
}

export class MemoryCapability implements MaiaCapability {
  readonly entity = 'MEMORY' as const;
  readonly supportedVerbs = ['CREATE', 'READ', 'DELETE'] as const;

  canHandle(intent: SemanticIntent): boolean {
    return intent.entity === 'MEMORY';
  }

  async execute(
    intent: SemanticIntent,
    _context: SessionContext,
    target?: TargetResolutionResult
  ): Promise<VerifiedActionResult> {
    const currentMemory = loadUserMemory();

    // 0. SENSITIVE DATA PROTECTION GUARD (Phase 6H Requirement 13)
    const textToCheck = intent.parameters.text || intent.rawQuery;
    if (intent.verb === 'CREATE' && isSensitiveInformation(textToCheck)) {
      return {
        status: 'FAILURE',
        entity: 'MEMORY',
        verb: 'CREATE',
        feedbackText: 'Per motivi di sicurezza e riservatezza, non posso memorizzare password o dati sensibili.',
        dataAffected: false,
        error: 'Security rejection: sensitive information not permitted in memory',
      };
    }

    // 1. RESET ALL PREFERENCES (DELETE ALL with subcategory === 'preferences' or target === 'preferenze')
    const isPrefReset =
      intent.parameters.subcategory === 'preferences' ||
      intent.target.rawReference?.toLowerCase().includes('preferenz') ||
      isPreferenceReset(intent.rawQuery);

    if (
      intent.verb === 'DELETE' &&
      isPrefReset &&
      (intent.target.type === 'ALL' || target?.scope === 'ALL')
    ) {
      const updatedMemory = {
        ...currentMemory,
        preferences: [],
        structuredPreferences: [],
        personalFacts: [],
      };
      saveUserMemory(updatedMemory);
      // DO -> VERIFY -> REPORT
      const after = loadUserMemory();
      const isCleared =
        (!after.preferences || after.preferences.length === 0) &&
        (!after.structuredPreferences || after.structuredPreferences.length === 0) &&
        (!after.personalFacts || after.personalFacts.length === 0);

      if (isCleared) {
        return {
          status: 'SUCCESS',
          entity: 'MEMORY',
          verb: 'DELETE',
          feedbackText: 'Tutte le tue preferenze sono state resettate.',
          dataAffected: true,
        };
      }

      return {
        status: 'FAILURE',
        entity: 'MEMORY',
        verb: 'DELETE',
        feedbackText: 'Errore durante il reset delle preferenze.',
        dataAffected: false,
        error: 'Verification failed: preferences not empty after reset',
      };
    }

    // 2. DELETE ALL MEMORY (scope ALL)
    if (intent.verb === 'DELETE' && (intent.target.type === 'ALL' || target?.scope === 'ALL')) {
      const emptyMemory = {
        userName: '',
        userCity: '',
        preferences: [],
        interests: [],
        projects: [],
        notes: [],
        structuredPreferences: [],
        personalFacts: [],
      };
      saveUserMemory(emptyMemory, true);
      // Clear every persistent MAIA store, not only UserMemory.
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(NOTES_STORAGE_KEY);
          localStorage.removeItem(REMINDERS_STORAGE_KEY);
        } catch (_) {}
      }
      // DO -> VERIFY -> REPORT
      const after = loadUserMemory();
      const isCleared =
        !after.userName &&
        !after.userCity &&
        (!after.preferences || after.preferences.length === 0) &&
        (!after.interests || after.interests.length === 0) &&
        (!after.projects || after.projects.length === 0) &&
        (!after.notes || after.notes.length === 0) &&
        (!after.structuredPreferences || after.structuredPreferences.length === 0) &&
        (!after.personalFacts || after.personalFacts.length === 0);

      if (isCleared) {
        return {
          status: 'SUCCESS',
          entity: 'MEMORY',
          verb: 'DELETE',
          feedbackText: 'Tutta la memoria a lungo termine è stata cancellata.',
          dataAffected: true,
        };
      }

      return {
        status: 'FAILURE',
        entity: 'MEMORY',
        verb: 'DELETE',
        feedbackText: 'Errore durante la cancellazione della memoria.',
        dataAffected: false,
        error: 'Verification failed: memory not empty after delete all',
      };
    }

    // 2a. DIRECT PROFILE FIELD DELETE (profile fields are not personalFacts).
    // Resolve exact stored values (e.g. "Cancella Malta") to the profile field
    // before attempting generic personal-fact deletion.
    const deleteQuery = String(intent.parameters.text || intent.target.rawReference || '').trim().toLocaleLowerCase('it');
    const inferredProfileField = !intent.parameters.profileField && intent.verb === 'DELETE'
      ? (currentMemory.userName && deleteQuery === currentMemory.userName.trim().toLocaleLowerCase('it')
          ? 'userName'
          : currentMemory.userCity && deleteQuery === currentMemory.userCity.trim().toLocaleLowerCase('it')
            ? 'userCity'
            : undefined)
      : undefined;
    const directProfileField = (intent.parameters.profileField as 'userName' | 'userCity' | undefined) || inferredProfileField;
    if (intent.verb === 'DELETE' && directProfileField) {
      const field = directProfileField;
      const currentValue = currentMemory[field] || '';
      if (!currentValue) {
        return { status: 'NOT_FOUND', entity: 'MEMORY', verb: 'DELETE', feedbackText: `Non ho trovato un'informazione personale su ${field === 'userName' ? 'nome' : 'città'}.`, dataAffected: false };
      }
      const updatedMemory = { ...currentMemory, [field]: '' };
      const saveOk = saveUserMemory(updatedMemory, true);
      const after = loadUserMemory();
      const verified = saveOk && !after[field];
      return verified
        ? { status: 'SUCCESS', entity: 'MEMORY', verb: 'DELETE', feedbackText: `Fatto, ho dimenticato ${field === 'userName' ? 'il tuo nome' : 'la tua città'} (${currentValue}).`, dataAffected: true, affectedId: field }
        : { status: 'FAILURE', entity: 'MEMORY', verb: 'DELETE', feedbackText: 'Errore durante la rimozione dell’informazione personale.', dataAffected: false, error: 'Verification failed: profile field still present' };
    }

    // 2b. DIRECT PROFILE / PERSONAL-FACT READS.
    // These are deterministic local reads and must never fall through to Gemini.
    if (intent.verb === 'READ' && intent.parameters.profileField) {
      const field = intent.parameters.profileField as 'userName' | 'userCity';
      const value = field === 'userName' ? currentMemory.userName : currentMemory.userCity;
      const label = field === 'userName' ? 'Il tuo nome è' : 'Vivi a';
      return {
        status: 'SUCCESS',
        entity: 'MEMORY',
        verb: 'READ',
        feedbackText: value ? `${label} ${value}.` : (field === 'userName' ? 'Non ho ancora memorizzato il tuo nome.' : 'Non ho ancora memorizzato la tua città.'),
        dataAffected: false,
      };
    }

    if (intent.verb === 'READ' && intent.parameters.personalFactQuery) {
      const requested = String(intent.parameters.personalFactQuery).toLowerCase().trim();
      const prefs = currentMemory.structuredPreferences || [];
      const legacy = currentMemory.preferences || [];

      if (requested === '__last_memory__') {
        const key = _contextLastMemoryKey(_context);
        const pref = key ? prefs.find((p) => p.key === key) : undefined;
        const exactLegacy = key ? legacy.find((p) => p.toLowerCase() === key.toLowerCase()) : undefined;
        const exactNote = key ? (currentMemory.notes || []).find((n) => n.toLowerCase() === key.toLowerCase()) : undefined;
        const fallback = key ? legacy.find((p) => p.toLowerCase().includes(key.toLowerCase())) : undefined;
        const answer = pref
          ? pref.rawText || `La tua preferenza ${pref.key} è ${String(pref.value)}.`
          : exactLegacy || exactNote || fallback;
        return {
          status: 'SUCCESS', entity: 'MEMORY', verb: 'READ',
          feedbackText: answer ? toUserPerspective(`${answer}`) : 'Non riesco a determinare quale informazione personale intendi.',
          dataAffected: false,
        };
      }

      const personalFacts = currentMemory.personalFacts || [];
      const factMatch = personalFacts.find((fact) => {
        const key = fact.key.toLowerCase();
        const raw = (fact.rawText || '').toLowerCase();
        return key === requested || key.includes(requested.replace(/\s+/g, '_')) || requested.split(/\s+/).filter((t) => t.length > 2).every((t) => key.includes(t) || raw.includes(t));
      });
      if (factMatch) {
        return {
          status: 'SUCCESS', entity: 'MEMORY', verb: 'READ',
          feedbackText: toUserPerspective(`${factMatch.rawText || factMatch.key}.`),
          dataAffected: false,
        };
      }

      const candidates = [
        ...prefs.map((p) => p.rawText || `${p.key}: ${String(p.value)}`),
        ...legacy,
        ...(currentMemory.notes || []),
      ];
      const tokens = requested.split(/\s+/).filter((t) => t.length > 2);
      const match = candidates.find((item) => {
        const low = item.toLowerCase();
        return tokens.length > 0 && tokens.every((t) => low.includes(t));
      });
      return {
        status: 'SUCCESS', entity: 'MEMORY', verb: 'READ',
        feedbackText: match ? toUserPerspective(match) : `Non ho ancora memorizzato un'informazione su ${requested}.`,
        dataAffected: false,
      };
    }

    // 3. READ PREFERENCES
    const isPrefRead =
      intent.parameters.subcategory === 'preferences' ||
      intent.target.rawReference?.toLowerCase().includes('preferenz') ||
      isPreferenceQuery(intent.rawQuery);

    if (intent.verb === 'READ' && isPrefRead) {
      const prefs = currentMemory.structuredPreferences || [];
      const prefStrings = currentMemory.preferences || [];
      const formatted = formatPreferencesForDisplay(prefs, prefStrings);
      return {
        status: 'SUCCESS',
        entity: 'MEMORY',
        verb: 'READ',
        feedbackText: formatted,
        dataAffected: false,
      };
    }

    // 4. FORGET SPECIFIC PERSONAL FACT
    if (intent.verb === 'DELETE' && intent.parameters.subcategory === 'personal_facts') {
      const queryOrText = String(intent.parameters.text || intent.target.rawReference || '').trim().toLowerCase();
      const facts = currentMemory.personalFacts || [];
      const matches = facts.filter((fact) => {
        const key = fact.key.toLowerCase();
        const raw = (fact.rawText || '').toLowerCase();
        return key === queryOrText || key.includes(queryOrText.replace(/\s+/g, '_')) || raw.includes(queryOrText);
      });
      if (matches.length === 0) {
        return { status: 'NOT_FOUND', entity: 'MEMORY', verb: 'DELETE', feedbackText: `Non ho trovato un'informazione personale su ${queryOrText}.`, dataAffected: false };
      }
      const updatedMemory = { ...currentMemory, personalFacts: facts.filter((fact) => !matches.some((m) => m.id === fact.id)) };
      saveUserMemory(updatedMemory);
      const after = loadUserMemory();
      const stillPresent = (after.personalFacts || []).some((fact) => matches.some((m) => m.id === fact.id));
      return stillPresent
        ? { status: 'FAILURE', entity: 'MEMORY', verb: 'DELETE', feedbackText: 'Errore durante la rimozione dell’informazione personale.', dataAffected: false, error: 'Verification failed: personal fact still present' }
        : { status: 'SUCCESS', entity: 'MEMORY', verb: 'DELETE', feedbackText: `Fatto, ho dimenticato questa informazione personale: ${matches[0].rawText || matches[0].key}.`, dataAffected: true, affectedId: matches[0].id };
    }

    // 5. FORGET SPECIFIC PREFERENCE
    if (
      intent.verb === 'DELETE' &&
      (intent.parameters.subcategory === 'preferences' ||
        intent.parameters.text?.toLowerCase().includes('preferisc') ||
        intent.rawQuery?.toLowerCase().includes('preferisc'))
    ) {
      const queryOrText = intent.parameters.text || intent.target.rawReference || intent.rawQuery;
      const removeRes = removePreferenceByKeyOrText(queryOrText, currentMemory);
      if (removeRes.wasRemoved) {
        saveUserMemory(removeRes.updatedMemory);
        // DO -> VERIFY -> REPORT
        const after = loadUserMemory();
        const stillInStruct = after.structuredPreferences?.some((p) =>
          p.key.toLowerCase().includes(queryOrText.toLowerCase())
        );
        const stillInStrings = after.preferences?.some((s) =>
          s.toLowerCase().includes(queryOrText.toLowerCase())
        );

        if (!stillInStruct && !stillInStrings) {
          return {
            status: 'SUCCESS',
            entity: 'MEMORY',
            verb: 'DELETE',
            feedbackText: `Fatto, ho rimosso questa preferenza dalla memoria: "${removeRes.removedItem || queryOrText}".`,
            dataAffected: true,
            affectedId: removeRes.removedItem,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'MEMORY',
          verb: 'DELETE',
          feedbackText: 'Errore durante la rimozione della preferenza dalla memoria.',
          dataAffected: false,
          error: 'Verification failed: preference still present after delete',
        };
      }
    }

    // 5. TEMPORARY PREFERENCE OVERRIDE (Volatile SessionContext only)
    if (intent.verb === 'CREATE' && intent.parameters.isTemporary) {
      const key = (intent.parameters.key as string) || 'response_style';
      const val = intent.parameters.value ?? intent.parameters.text;
      setTemporaryPreference(key, val);
      return {
        status: 'SUCCESS',
        entity: 'MEMORY',
        verb: 'CREATE',
        feedbackText: 'D’accordo, terrò conto di questa preferenza solo per questa risposta.',
        dataAffected: false,
      };
    }

    // 6. BEHAVIORAL EVIDENCE (Phase 6H Learning & Proposing Confirmation)
    if (intent.verb === 'CREATE' && intent.parameters.isBehavioralEvidence) {
      const key = (intent.parameters.key as string) || 'verbosity';
      const val = intent.parameters.value ?? 'concise';
      const evidenceRes = recordLearningEvidence(key, val, _context);
      if (evidenceRes.shouldProposeConfirmation) {
        setPendingPreferenceCandidate(evidenceRes.candidatePreference);
        return {
          status: 'SUCCESS',
          entity: 'MEMORY',
          verb: 'CREATE',
          feedbackText:
            'Ho notato che preferisci spesso risposte brevi. Vuoi che lo ricordi come preferenza generale?',
          dataAffected: false,
        };
      } else {
        setTemporaryPreference(key, val);
        return {
          status: 'SUCCESS',
          entity: 'MEMORY',
          verb: 'CREATE',
          feedbackText: 'Ricevuto, imposto questa modalità per la risposta.',
          dataAffected: false,
        };
      }
    }

    // 6b. DIRECT PROFILE CREATE (name/city).
    if (intent.verb === 'CREATE' && intent.parameters.profileName && intent.parameters.profileCity) {
      const name = String(intent.parameters.profileName).trim();
      const city = String(intent.parameters.profileCity).trim();
      const updatedMemory = { ...currentMemory, userName: name, userCity: city };
      saveUserMemory(updatedMemory);
      const after = loadUserMemory();
      const verified = after.userName === name && after.userCity === city;
      return {
        status: verified ? 'SUCCESS' : 'FAILURE', entity: 'MEMORY', verb: 'CREATE',
        feedbackText: verified ? `Memorizzato: il tuo nome è ${name} e vivi a ${city}.` : 'Errore durante il salvataggio del profilo.',
        dataAffected: verified, affectedId: name,
        ...(verified ? {} : { error: 'Verification failed: combined profile not persisted' }),
      };
    }

    if (intent.verb === 'CREATE' && intent.parameters.profileField && intent.parameters.profileValue) {
      const field = intent.parameters.profileField as 'userName' | 'userCity';
      const value = String(intent.parameters.profileValue).trim();
      const updatedMemory = { ...currentMemory, [field]: value };
      saveUserMemory(updatedMemory);
      const after = loadUserMemory();
      const verified = after[field] === value;
      return {
        status: verified ? 'SUCCESS' : 'FAILURE', entity: 'MEMORY', verb: 'CREATE',
        feedbackText: verified ? `Memorizzato: ${field === 'userName' ? `il tuo nome è ${value}` : `vivi a ${value}`}.` : 'Errore durante il salvataggio del profilo.',
        dataAffected: verified, affectedId: value,
        ...(verified ? {} : { error: 'Verification failed: profile field not persisted' }),
      };
    }

    // 7. PERSONAL FACT CREATE / UPDATE. This is Core-owned memory and must not
    // be delegated to the model provider.
    if (intent.verb === 'CREATE' && intent.parameters.subcategory === 'personal_facts' && intent.parameters.personalFactKey) {
      const key = String(intent.parameters.personalFactKey);
      const value = String(intent.parameters.personalFactValue ?? '');
      const rawText = String(intent.parameters.text || intent.rawQuery);
      const syncResult = saveOrUpdatePersonalFact({ key, value, rawText, confidence: 'HIGH' }, currentMemory);
      saveUserMemory(syncResult.updatedMemory);
      const after = loadUserMemory();
      const saved = after.personalFacts?.find((fact) => fact.key === key);
      const verified = !!saved && String(saved.value) === value;
      return {
        status: verified ? 'SUCCESS' : 'FAILURE',
        entity: 'MEMORY',
        verb: 'CREATE',
        feedbackText: verified
          ? (syncResult.wasUpdated ? `Ho aggiornato questa informazione personale: ${rawText}.` : `Ho memorizzato questa informazione personale: ${rawText}.`)
          : 'Errore durante il salvataggio dell’informazione personale.',
        dataAffected: verified,
        affectedId: key,
        ...(verified ? {} : { error: 'Verification failed: personal fact not persisted' }),
      };
    }

    // 7. EXPLICIT PREFERENCE CREATE / UPDATE (Deterministic Persistence & Deduplication)
    const parsedPref = parsePreferenceStatement(intent.parameters.text || intent.rawQuery);
    if (
      intent.verb === 'CREATE' &&
      (intent.parameters.subcategory === 'preferences' || (parsedPref.isPreference && parsedPref.key))
    ) {
      const key = (intent.parameters.key as string) || parsedPref.key || 'response_style';
      const value = intent.parameters.value ?? parsedPref.value ?? intent.parameters.text;
      const category = (intent.parameters.category as any) || parsedPref.category || 'response_style';
      const scope = (intent.parameters.scope as string | undefined) || parsedPref.scope;
      const standardizedText = parsedPref.standardizedText;

      const syncResult = saveOrUpdatePreference(
        {
          key,
          value,
          category,
          scope,
          rawText: intent.parameters.text || intent.rawQuery,
          standardizedText,
          source: 'EXPLICIT',
          confidence: 'HIGH',
        },
        currentMemory
      );

      const saveOk = saveUserMemory(syncResult.updatedMemory);
      // DO -> VERIFY -> REPORT: an older preference with the same key is not
      // proof that the requested new value was actually persisted.
      const after = loadUserMemory();
      const savedPreference = after.structuredPreferences?.find(
        (p) => p.key === key && (p.scope || '') === (scope || '')
      );
      const isSaved = Boolean(
        saveOk && savedPreference &&
        JSON.stringify(savedPreference.value) === JSON.stringify(value)
      );

      if (isSaved) {
        // One natural-language sentence can express two independent durable
        // preferences (e.g. "risposte più articolate e dirette"). Persist and
        // verify both structured keys instead of silently dropping the second.
        const originalPreferenceText = String(intent.rawQuery || intent.parameters.text || '');
        const asksForDetail = /\b(?:dettagliat[aoei]|approfondit[aoei]|lunghe|articolat[aoei])\b/i.test(originalPreferenceText);
        const asksForDirectness = /\b(?:dirett[aoei]|senza\s+girarci\s+intorno|senza\s+fare\s+giri\s+di\s+parole)\b/i.test(originalPreferenceText);
        if (key === 'verbosity' && value === 'detailed' && asksForDetail && asksForDirectness) {
          const latestMemory = loadUserMemory();
          const secondary = saveOrUpdatePreference({
            key: 'tone', value: 'direct', category: 'tone', source: 'EXPLICIT', confidence: 'HIGH',
            rawText: originalPreferenceText, standardizedText: 'Preferisco che tu sia diretto',
          }, latestMemory);
          const secondarySaveOk = saveUserMemory(secondary.updatedMemory);
          const secondaryAfter = loadUserMemory();
          const secondarySaved = Boolean(secondarySaveOk && secondaryAfter.structuredPreferences?.some(
            (p) => p.key === 'tone' && p.value === 'direct' && (p.scope || '') === ''
          ));
          if (!secondarySaved) {
            return {
              status: 'FAILURE', entity: 'MEMORY', verb: 'CREATE',
              feedbackText: 'Ho salvato la preferenza sulla risposta articolata, ma non riesco a verificare quella sulla risposta diretta.',
              dataAffected: true, affectedId: key,
              error: 'Verification failed: compound tone preference not persisted',
            };
          }
        }

        const desc = standardizedText || syncResult.affectedPreference.rawText || key;
        return {
          status: 'SUCCESS',
          entity: 'MEMORY',
          verb: 'CREATE',
          feedbackText: syncResult.wasUpdated
            ? `Ho aggiornato la tua preferenza: ${desc}.`
            : `Ho memorizzato la tua preferenza: ${desc}.`,
          dataAffected: true,
          affectedId: key,
        };
      }

      return {
        status: 'FAILURE',
        entity: 'MEMORY',
        verb: 'CREATE',
        feedbackText: 'Errore durante il salvataggio della preferenza.',
        dataAffected: false,
        error: 'Verification failed: preference not found in storage after write',
      };
    }

    // 8. GENERAL MEMORY COMMANDS (Names, Cities, Projects, Interests, Notes)
    const commandText =
      intent.verb === 'CREATE' && intent.parameters.text
        ? `ricordati che ${intent.parameters.text}`
        : intent.verb === 'DELETE' && intent.parameters.text
        ? `dimentica che ${intent.parameters.text}`
        : intent.rawQuery;
    const result = handleMemoryCommand(commandText, currentMemory);

    if (!result.isCommand) {
      return {
        status: 'UNSUPPORTED',
        entity: 'MEMORY',
        verb: intent.verb,
        feedbackText: 'Comando memoria non riconosciuto.',
        dataAffected: false,
      };
    }

    if (result.action === 'save') {
      if (result.updatedMemory) {
        let finalMemory = result.updatedMemory;
        if (result.category === 'preferences' && result.item) {
          const pref = parsePreferenceStatement(result.item);
          if (pref.isPreference && pref.key) {
            const syncResult = saveOrUpdatePreference(
              {
                key: pref.key,
                value: pref.value,
                category: pref.category,
                scope: pref.scope,
                rawText: result.item,
                standardizedText: pref.standardizedText,
                source: 'EXPLICIT',
              },
              finalMemory
            );
            finalMemory = syncResult.updatedMemory;
          }
        }

        saveUserMemory(finalMemory);
        // DO -> VERIFY -> REPORT
        const after = loadUserMemory();
        return {
          status: 'SUCCESS',
          entity: 'MEMORY',
          verb: 'CREATE',
          feedbackText: result.reply || 'Informazione salvata nella memoria a lungo termine.',
          dataAffected: true,
          affectedId: result.item,
        };
      }
      return {
        status: 'SUCCESS',
        entity: 'MEMORY',
        verb: 'CREATE',
        feedbackText: result.reply || 'Questa informazione è già presente nella memoria.',
        dataAffected: false,
      };
    }

    if (result.action === 'query') {
      return {
        status: 'SUCCESS',
        entity: 'MEMORY',
        verb: 'READ',
        feedbackText: result.reply || 'Memoria letta con successo.',
        dataAffected: false,
      };
    }

    if (result.action === 'forget') {
      if (result.status === 'success' && result.updatedMemory) {
        let finalMemory = result.updatedMemory;
        if (result.item && finalMemory.structuredPreferences) {
          finalMemory = {
            ...finalMemory,
            structuredPreferences: finalMemory.structuredPreferences.filter(
              (p) =>
                !p.rawText?.toLowerCase().includes(result.item!.toLowerCase()) &&
                !p.key.toLowerCase().includes(result.item!.toLowerCase())
            ),
          };
        }

        saveUserMemory(
  finalMemory,
  result.category === 'userName' || result.category === 'userCity'
);
        // DO -> VERIFY -> REPORT
        const after = loadUserMemory();
        const stillPresent =
          Boolean(result.item && (
            (result.category === 'userName' && after.userName === result.item) ||
            (result.category === 'userCity' && after.userCity === result.item) ||
            (result.category !== 'userName' && result.category !== 'userCity' && (
              (after.preferences && after.preferences.includes(result.item)) ||
              (after.interests && after.interests.includes(result.item)) ||
              (after.projects && after.projects.includes(result.item)) ||
              (after.notes && after.notes.includes(result.item))
            ))
          ));

        if (!stillPresent) {
          return {
            status: 'SUCCESS',
            entity: 'MEMORY',
            verb: 'DELETE',
            feedbackText: result.reply || 'Informazione rimossa dalla memoria.',
            dataAffected: true,
            affectedId: result.item,
          };
        }

        return {
          status: 'FAILURE',
          entity: 'MEMORY',
          verb: 'DELETE',
          feedbackText: 'Errore durante la rimozione dell\'informazione dalla memoria.',
          dataAffected: false,
          error: 'Verification failed: item still present in memory after delete',
        };
      }
      return {
        status: 'NOT_FOUND',
        entity: 'MEMORY',
        verb: 'DELETE',
        feedbackText: result.reply || 'Nessuna informazione corrispondente trovata nella memoria.',
        dataAffected: false,
      };
    }

    return {
      status: 'UNSUPPORTED',
      entity: 'MEMORY',
      verb: intent.verb,
      feedbackText: 'Operazione di memoria non supportata.',
      dataAffected: false,
    };
  }
}

