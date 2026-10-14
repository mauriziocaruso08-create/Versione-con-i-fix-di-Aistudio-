import { UserMemory } from '../types';

export interface MemoryCommandResult {
  isCommand: boolean;
  action?: 'save' | 'forget' | 'query';
  status?: 'success' | 'duplicate' | 'not_found' | 'empty';
  updatedMemory?: UserMemory;
  reply?: string;
  category?: keyof UserMemory;
  item?: string;
}

export interface AutoMemoryResult {
  hasAutoMemory: boolean;
  needsConfirmation?: boolean;
  candidateCategory?: keyof UserMemory;
  candidateItem?: string;
  updatedMemory?: UserMemory;
  confirmationPrompt?: string;
}

/**
 * Normalizes text by removing extra whitespace and punctuation at the end.
 */
function cleanText(text: string): string {
  return text.trim().replace(/[.!?;:]+$/, '').trim();
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Checks if a string is included with word boundaries or high similarity.
 */
function isFuzzyMatch(item: string, target: string): boolean {
  const normItem = item.toLowerCase().trim();
  const normTarget = target.toLowerCase().trim();

  if (normItem === normTarget) return true;
  if (normItem.includes(normTarget) || normTarget.includes(normItem)) return true;

  // Check word intersection
  const itemWords = normItem.split(/\s+/).filter((w) => w.length > 2);
  const targetWords = normTarget.split(/\s+/).filter((w) => w.length > 2);

  if (itemWords.length > 0 && targetWords.length > 0) {
    const common = itemWords.filter((w) => targetWords.includes(w));
    if (common.length >= Math.min(itemWords.length, targetWords.length)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects if a new preference contradicts an existing preference (e.g. short vs detailed responses).
 * Returns the index of the conflicting item in existingList, or -1 if none.
 */
function findConflictingPreferenceIndex(existingList: string[], newPref: string): number {
  const lowerNew = newPref.toLowerCase();

  const brevityWords = ['breve', 'brevi', 'corta', 'corte', 'sintetica', 'sintetiche', 'concisa', 'concise', 'veloce', 'veloci'];
  const detailWords = ['dettagliata', 'dettagliate', 'lunga', 'lunghe', 'approfondita', 'approfondite', 'articolata', 'articolate'];

  const isNewBrevity = brevityWords.some((w) => lowerNew.includes(w));
  const isNewDetail = detailWords.some((w) => lowerNew.includes(w));

  if (isNewBrevity || isNewDetail) {
    return existingList.findIndex((item) => {
      const lowerItem = item.toLowerCase();
      const isItemBrevity = brevityWords.some((w) => lowerItem.includes(w));
      const isItemDetail = detailWords.some((w) => lowerItem.includes(w));
      return (isNewBrevity && isItemDetail) || (isNewDetail && isItemBrevity);
    });
  }

  return -1;
}

/**
 * Checks if a message is temporary, casual, or non-memorable.
 */
function isTemporaryOrCasual(lowerText: string): boolean {
  // Starts with or contains temporary time markers
  if (
    /\b(?:oggi|ieri|domani|stamattina|stasera|stanotte|tra poco|in questo momento|adesso che)\b/i.test(
      lowerText
    )
  ) {
    return true;
  }

  // Eating, bodily states, temporary sensations
  if (
    /\b(?:ho mangiato|sto mangiando|ho bevuto|sto bevendo|ho fame|ho sete|ho sonno|sono stanco|sono stanca|ho freddo|ho caldo)\b/i.test(
      lowerText
    )
  ) {
    return true;
  }

  // Temporary movements or schedules
  if (
    /\b(?:devo andare|sto andando|sto uscendo|sono arrivato|sono arrivata|ora vado|ci vediamo dopo|vado a dormire)\b/i.test(
      lowerText
    )
  ) {
    return true;
  }

  // Pure questions or interrogatives
  if (
    lowerText.endsWith('?') ||
    /^(?:chi|cosa|come|dove|quando|perché|quanto|qual|quale)\b/i.test(lowerText)
  ) {
    return true;
  }

  // Imperative actions / tasks
  if (
    /^(?:dimmi|spiegami|traduci|traduci in|calcola|scrivi|aiutami a|cerca|raccontami|fammi|dammi)\b/i.test(
      lowerText
    )
  ) {
    return true;
  }

  // Pure greetings or small talk
  if (/^(?:ciao|buongiorno|buonasera|salve|hey|we|ciao maia|grazie|prego|ok|perfetto|bene)$/i.test(lowerText)) {
    return true;
  }

  // Sensitive information filters: credentials, banking, medical secrets
  if (
    /\b(?:password|codice pin|pin della|carta di credito|iban|codice fiscale|conto corrente|diagnosi medica|malattia intima)\b/i.test(
      lowerText
    )
  ) {
    return true;
  }

  return false;
}

export interface ExtractedProfile {
  name?: string;
  city?: string;
}

/**
 * Extracts userName and/or userCity from natural Italian expressions.
 * Accurately parses combined forms ("Mi chiamo Maurizio e vivo a Malta", "Sono Maurizio, abito a Malta")
 * and standalone forms ("Mi chiamo Maurizio", "Vivo a Malta").
 */
export function extractNameAndCity(rawText: string): ExtractedProfile | null {
  const text = cleanText(rawText);

  // Strip conversational prefixes: "ah,", "comunque,", "ciao,", "hey,"
  const stripped = text
    .replace(/^(?:ah|comunque|ciao|salve|hey)[\s,]+/i, '')
    .replace(/^(?:io)\s+/i, '')
    .trim();

  // 1. COMBINED: Name + City in the same sentence
  // Supports:
  // - "Mi chiamo Maurizio e vivo a Malta."
  // - "Mi chiamo Maurizio, vivo a Malta."
  // - "Mi chiamo Maurizio e abito a Malta."
  // - "Sono Maurizio e vivo a Malta."
  // - "Il mio nome è Maurizio e abito a Malta."
  // - "Sono Maurizio e abito a Malta."
  const combinedRegex = /^(?:mi chiamo|il mio nome è|chiamami|sono)\s+([A-Za-zÀ-ÿ\s'-]+?)(?:[,\s]+e\s+|,\s*|\s+e\s+|\s+ed\s+)(?:vivo a|abito a|risiedo a|la mia città è|sono di)\s+([A-Za-zÀ-ÿ\s'-]+)$/i;
  const combinedMatch = stripped.match(combinedRegex);
  if (combinedMatch) {
    const rawName = combinedMatch[1].trim();
    const rawCity = combinedMatch[2].trim();
    const cleanName = rawName.split(/\s+/).map(capitalize).join(' ');
    const cleanCity = rawCity.split(/\s+/).map(capitalize).join(' ');
    if (cleanName.length >= 2 && cleanCity.length >= 2) {
      return { name: cleanName, city: cleanCity };
    }
  }

  // Reverse combined: "Vivo a Malta e mi chiamo Maurizio"
  const reverseCombinedRegex = /^(?:vivo a|abito a|risiedo a|sono di)\s+([A-Za-zÀ-ÿ\s'-]+?)(?:[,\s]+e\s+|,\s*|\s+e\s+|\s+ed\s+)(?:mi chiamo|il mio nome è|chiamami|sono)\s+([A-Za-zÀ-ÿ\s'-]+)$/i;
  const reverseMatch = stripped.match(reverseCombinedRegex);
  if (reverseMatch) {
    const rawCity = reverseMatch[1].trim();
    const rawName = reverseMatch[2].trim();
    const cleanCity = rawCity.split(/\s+/).map(capitalize).join(' ');
    const cleanName = rawName.split(/\s+/).map(capitalize).join(' ');
    if (cleanName.length >= 2 && cleanCity.length >= 2) {
      return { name: cleanName, city: cleanCity };
    }
  }

  // 2. STANDALONE NAME
  // "Mi chiamo Maurizio", "Il mio nome è Maurizio"
  const nameOnlyRegex = /^(?:mi chiamo|il mio nome è|chiamami)\s+([A-Za-zÀ-ÿ\s'-]+)$/i;
  const nameMatch = stripped.match(nameOnlyRegex);
  if (nameMatch) {
    const rawName = nameMatch[1].trim();
    // Exclude accidental city or conjunction capture
    if (!/\b(?:e|ed)\s+(?:vivo|abito|risiedo)\b/i.test(rawName)) {
      const cleanName = rawName.split(/\s+/).map(capitalize).join(' ');
      if (cleanName.length >= 2) {
        return { name: cleanName };
      }
    }
  }

  // "Sono Maurizio" (only if followed by a capitalized proper name, not an adjective or statement)
  const sonoNameMatch = stripped.match(/^sono\s+([A-ZÀ-Ý][a-zà-ÿ'-]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ'-]+)?)$/);
  if (sonoNameMatch) {
    const candidate = sonoNameMatch[1].trim();
    const notNames = [
      'felice', 'contento', 'stanco', 'stanca', 'pronto', 'pronta',
      'italiano', 'italiana', 'siciliano', 'siciliana', 'qui', 'lì',
      'a', 'di', 'in', 'da', 'su', 'per', 'tra', 'fra', 'un', 'una',
    ];
    if (!notNames.includes(candidate.toLowerCase())) {
      return { name: capitalize(candidate) };
    }
  }

  // 3. STANDALONE CITY
  // "Vivo a Malta", "Abito a Malta", "Sono di Palermo"
  const cityOnlyRegex = /^(?:vivo a|abito a|mi sono trasferito a|risiedo a|sono di)\s+([A-Za-zÀ-ÿ\s'-]+)$/i;
  const cityMatch = stripped.match(cityOnlyRegex);
  if (cityMatch) {
    const rawCity = cityMatch[1].trim();
    const falsePositives = ['stento', 'mille', 'fatica', 'lungo', 'solo', 'casa', 'poco'];
    if (
      !falsePositives.includes(rawCity.toLowerCase()) &&
      !/\b(?:e|ed)\s+(?:mi chiamo|sono)\b/i.test(rawCity)
    ) {
      const cleanCity = rawCity.split(/\s+/).map(capitalize).join(' ');
      if (cleanCity.length >= 2) {
        return { city: cleanCity };
      }
    }
  }

  return null;
}

/**
 * Checks if an input confirms a pending memory prompt ("Vuoi che la salvi?").
 */
export function isConfirmationAffirmative(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!?;:,]+$/, '');
  return /^(?:s[ìi]|certo|salva|salvala|va bene|ok|d['’]accordo|confermo|volentieri|memorizza|memorizzala|s[ìi] grazie|s[ìi] certo|yes)$/i.test(
    clean
  );
}

/**
 * Checks if an input denies a pending memory prompt.
 */
export function isConfirmationNegative(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!?;:,]+$/, '');
  return /^(?:no|lascia stare|non serve|evita|non salvare|non salvarla|annulla|lascia perdere|no grazie|nope)$/i.test(
    clean
  );
}

/**
 * Processes an input text to determine if it is an explicit memory command.
 * If it is, executes the deterministic memory operation and returns the result.
 */
export function handleMemoryCommand(
  rawInput: string,
  currentMemory: UserMemory
): MemoryCommandResult {
  const input = rawInput.trim();
  const lower = input.toLowerCase();

  // 1. QUERY COMMANDS ("Cosa ricordi di me?", "Cosa hai nella tua memoria?", etc.)
  const queryPatterns = [
    /^(?:maia[,\s]+)?(?:cosa ricordi di me|cosa ti ricordi di me)\b/i,
    /^(?:maia[,\s]+)?(?:cosa hai nella tua memoria|cosa c'è nella tua memoria)\b/i,
    /^(?:maia[,\s]+)?(?:quali informazioni hai memorizzato su di me|quali informazioni hai su di me)\b/i,
    /^(?:maia[,\s]+)?(?:cosa sai di me|cosa hai memorizzato su di me)\b/i,
    /^(?:maia[,\s]+)?(?:mostrami la tua memoria|cosa ricordi\??|cosa hai memorizzato\??)$/i,
  ];

  if (queryPatterns.some((pattern) => pattern.test(lower))) {
    const totalItems =
      (currentMemory.userName ? 1 : 0) +
      (currentMemory.userCity ? 1 : 0) +
      (currentMemory.preferences?.length || 0) +
      (currentMemory.interests?.length || 0) +
      (currentMemory.projects?.length || 0) +
      (currentMemory.notes?.length || 0) +
      (currentMemory.personalFacts?.length || 0);

    if (totalItems === 0) {
      return {
        isCommand: true,
        action: 'query',
        status: 'empty',
        reply:
          'Al momento non ho ancora memorizzato informazioni personali su di te oltre a questa conversazione.\n\nSe vuoi che mi tenga a mente qualcosa per le prossime volte, basta che me lo dici (ad esempio: *"Mi chiamo..."* oppure *"Ricordati che preferisco risposte dirette"*).',
      };
    }

    const lines: string[] = [
      'Queste sono le cose che ho scelto di ricordare su di te e che posso ritrovare anche nelle prossime conversazioni:\n',
    ];

    if (currentMemory.userName) {
      lines.push(`👤 **Nome:** ${currentMemory.userName}`);
    }
    if (currentMemory.userCity) {
      lines.push(`📍 **Città:** ${currentMemory.userCity}`);
    }
    if (currentMemory.personalFacts?.length) {
      lines.push(`🧠 **Informazioni personali:**\n${currentMemory.personalFacts.map((f) => `  • ${f.rawText || `${f.key}: ${String(f.value)}`}`).join('\n')}`);
    }
    if (currentMemory.preferences?.length > 0) {
      lines.push(`⚙️ **Preferenze:**\n${currentMemory.preferences.map((p) => `  • ${p}`).join('\n')}`);
    }
    if (currentMemory.interests?.length > 0) {
      lines.push(`💡 **Interessi:**\n${currentMemory.interests.map((i) => `  • ${i}`).join('\n')}`);
    }
    if (currentMemory.projects?.length > 0) {
      lines.push(`🚀 **Progetti:**\n${currentMemory.projects.map((p) => `  • ${p}`).join('\n')}`);
    }
    if (currentMemory.notes?.length > 0) {
      lines.push(`📝 **Note personali:**\n${currentMemory.notes.map((n) => `  • ${n}`).join('\n')}`);
    }

    return {
      isCommand: true,
      action: 'query',
      status: 'success',
      reply: lines.join('\n'),
    };
  }

  // 2. FORGET COMMANDS ("Dimentica che...", "Rimuovi dalla memoria che...", etc.)
  const forgetMatch = input.match(
    /^(?:maia[,\s]+)?(?:per favore[,\s]+)?(?:dimentica che|dimenticati che|rimuovi dalla memoria che|dimmi di dimenticare che|cancella dalla memoria che|elimina dalla memoria che|scorda che)\s+(.+)$/i
  );

  if (forgetMatch) {
    const rawTarget = cleanText(forgetMatch[1]);
    const lowerTarget = rawTarget.toLowerCase();

    // Check userName
    if (
      currentMemory.userName &&
      (lowerTarget.includes(currentMemory.userName.toLowerCase()) ||
        lowerTarget.startsWith('mi chiamo') ||
        lowerTarget.startsWith('il mio nome'))
    ) {
      const removed = currentMemory.userName;
      const updated: UserMemory = { ...currentMemory, userName: '' };
      return {
        isCommand: true,
        action: 'forget',
        status: 'success',
        category: 'userName',
        item: removed,
        updatedMemory: updated,
        reply: "Fatto, ho rimosso il tuo nome dalla memoria persistente.",
      };
    }

    // Check userCity
    if (
      currentMemory.userCity &&
      (lowerTarget.includes(currentMemory.userCity.toLowerCase()) ||
        lowerTarget.startsWith('vivo a') ||
        lowerTarget.startsWith('abito a'))
    ) {
      const removed = currentMemory.userCity;
      const updated: UserMemory = { ...currentMemory, userCity: '' };
      return {
        isCommand: true,
        action: 'forget',
        status: 'success',
        category: 'userCity',
        item: removed,
        updatedMemory: updated,
        reply: "Fatto, ho rimosso l'informazione sulla tua città dalla memoria.",
      };
    }

    // Check deterministic personal facts before generic arrays.
    const personalFacts = currentMemory.personalFacts || [];
    const factIdx = personalFacts.findIndex((fact) =>
      isFuzzyMatch(fact.rawText || fact.key, rawTarget) ||
      isFuzzyMatch(fact.key.replace(/_/g, ' '), rawTarget) ||
      String(fact.value).toLowerCase() === rawTarget.toLowerCase()
    );
    if (factIdx !== -1) {
      const removed = personalFacts[factIdx];
      const updated: UserMemory = {
        ...currentMemory,
        personalFacts: personalFacts.filter((_, idx) => idx !== factIdx),
      };
      return {
        isCommand: true,
        action: 'forget',
        status: 'success',
        category: 'personalFacts',
        item: removed.rawText || `${removed.key}: ${String(removed.value)}`,
        updatedMemory: updated,
        reply: `Fatto, ho rimosso dalla memoria: "${removed.rawText || removed.key}".`,
      };
    }

    // Check arrays: preferences, interests, projects, notes
    const arrayCategories: Array<'preferences' | 'interests' | 'projects' | 'notes'> = [
      'preferences',
      'interests',
      'projects',
      'notes',
    ];

    for (const cat of arrayCategories) {
      const list = currentMemory[cat] || [];
      const foundIdx = list.findIndex((item) => isFuzzyMatch(item, rawTarget));
      if (foundIdx !== -1) {
        const removed = list[foundIdx];
        const updatedList = list.filter((_, idx) => idx !== foundIdx);
        const updated: UserMemory = { ...currentMemory, [cat]: updatedList };
        return {
          isCommand: true,
          action: 'forget',
          status: 'success',
          category: cat,
          item: removed,
          updatedMemory: updated,
          reply: `Fatto, l'ho tolto dalla memoria: "${removed}".`,
        };
      }
    }

    return {
      isCommand: true,
      action: 'forget',
      status: 'not_found',
      reply: `Non ho trovato "${rawTarget}" tra le informazioni memorizzate, quindi non c'era nulla da rimuovere.`,
    };
  }

  // 3. EXPLICIT SAVE COMMANDS ("Ricordati che...", "Tieni a mente che...", "Memorizza che...", "Ricorda che...")
  const saveMatch = input.match(
    /^(?:(?:senti(?:\s+un\s+po['’])?|ascolta(?:mi)?|ok(?:ay)?|va\s+bene|d['’]accordo|allora|no[,\s]+aspetta|aspetta|maia|per\s+favore|per\s+cortesia)[,\s:]+)*(?:ricordati che|ricorda che|tieni a mente che|memorizza che)\s+(.+)$/i
  );

  if (saveMatch) {
    const rawFact = cleanText(saveMatch[1]);
    const lowerFact = rawFact.toLowerCase();

    // Check if it's a name and/or city:
    const profile = extractNameAndCity(rawFact);
    if (profile) {
      let updated: UserMemory = { ...currentMemory };
      let anyChange = false;
      const rememberedParts: string[] = [];

      if (profile.name) {
        if (!currentMemory.userName || currentMemory.userName.toLowerCase() !== profile.name.toLowerCase()) {
          updated.userName = profile.name;
          anyChange = true;
          rememberedParts.push(`che ti chiami ${profile.name}`);
        }
      }
      if (profile.city) {
        if (!currentMemory.userCity || currentMemory.userCity.toLowerCase() !== profile.city.toLowerCase()) {
          updated.userCity = profile.city;
          anyChange = true;
          rememberedParts.push(`che vivi a ${profile.city}`);
        }
      }

      if (anyChange) {
        return {
          isCommand: true,
          action: 'save',
          status: 'success',
          category: profile.name ? 'userName' : 'userCity',
          item: [profile.name, profile.city].filter(Boolean).join(' - '),
          updatedMemory: updated,
          reply: `Memorizzato! Mi ricorderò ${rememberedParts.join(' e ')}.`,
        };
      } else {
        return {
          isCommand: true,
          action: 'save',
          status: 'duplicate',
          category: profile.name ? 'userName' : 'userCity',
          item: [profile.name, profile.city].filter(Boolean).join(' - '),
          reply: 'Lo so già! Queste informazioni sono già presenti nella mia memoria.',
        };
      }
    }

    // Categorization into preferences, interests, projects, notes
    let category: 'preferences' | 'interests' | 'projects' | 'notes' = 'notes';

    if (
      /(?:preferisco|preferirei|voglio risposte|gradisco|non voglio|rispondimi sempre|usare il dialetto|parlami in|tono|stile|lunghezza)\b/i.test(
        lowerFact
      )
    ) {
      category = 'preferences';
    } else if (
      /(?:sto lavorando|il mio progetto|sto sviluppando|sviluppo|lavoro su|progetto)\b/i.test(lowerFact)
    ) {
      category = 'projects';
    } else if (
      /(?:mi piace|mi piacciono|amo|adoro|sono appassionato|il mio hobby|passione|tifo|la mia squadra)\b/i.test(
        lowerFact
      )
    ) {
      category = 'interests';
    }

    const formattedFact = capitalize(rawFact);

    // If it's a preference, check if it contradicts an existing preference
    const existingList = currentMemory[category] || [];
    if (category === 'preferences') {
      const conflictIdx = findConflictingPreferenceIndex(existingList, formattedFact);
      if (conflictIdx !== -1) {
        const updatedList = [...existingList];
        updatedList[conflictIdx] = formattedFact;
        const updated: UserMemory = { ...currentMemory, preferences: updatedList };
        return {
          isCommand: true,
          action: 'save',
          status: 'success',
          category: 'preferences',
          item: formattedFact,
          updatedMemory: updated,
          reply: `Ho aggiornato la tua preferenza precedente con: "${formattedFact}". Me la tengo a mente.`,
        };
      }
    }

    // Duplicate check
    const isDuplicate = existingList.some((item) => isFuzzyMatch(item, formattedFact));
    if (isDuplicate) {
      return {
        isCommand: true,
        action: 'save',
        status: 'duplicate',
        category,
        item: formattedFact,
        reply: `Lo so già! Questa informazione è già presente tra le tue ${category === 'preferences' ? 'preferenze' : category === 'interests' ? 'passioni' : category === 'projects' ? 'progetti' : 'note'} memorizzate.`,
      };
    }

    const updatedList = [...existingList, formattedFact];
    const updated: UserMemory = { ...currentMemory, [category]: updatedList };

    return {
      isCommand: true,
      action: 'save',
      status: 'success',
      category,
      item: formattedFact,
      updatedMemory: updated,
      reply: 'Memorizzato. Questa me la tengo a mente anche per le prossime conversazioni.',
    };
  }

  // Not an explicit memory command
  return { isCommand: false };
}

/**
 * Automatically inspects a conversational user message to extract stable personal facts,
 * avoiding temporary statements, casual chatter, or duplicates.
 */
export function detectAutoMemory(
  rawInput: string,
  currentMemory: UserMemory
): AutoMemoryResult {
  const input = cleanText(rawInput);
  const lower = input.toLowerCase();

  // 1. Filter out temporary, casual, or non-memorable messages
  if (isTemporaryOrCasual(lower)) {
    return { hasAutoMemory: false };
  }

  // 2. High-Confidence: PROFILE (NAME and/or CITY)
  // Handles combined ("Mi chiamo Maurizio e vivo a Malta", "Sono Maurizio, abito a Malta")
  // and standalone ("Mi chiamo Maurizio", "Vivo a Malta")
  const profile = extractNameAndCity(input);
  if (profile) {
    let updated: UserMemory = { ...currentMemory };
    let hasChanges = false;
    const changedParts: string[] = [];

    if (profile.name) {
      if (!currentMemory.userName || currentMemory.userName.toLowerCase() !== profile.name.toLowerCase()) {
        updated.userName = profile.name;
        hasChanges = true;
        changedParts.push(`nome: ${profile.name}`);
      }
    }

    if (profile.city) {
      if (!currentMemory.userCity || currentMemory.userCity.toLowerCase() !== profile.city.toLowerCase()) {
        updated.userCity = profile.city;
        hasChanges = true;
        changedParts.push(`città: ${profile.city}`);
      }
    }

    if (hasChanges) {
      return {
        hasAutoMemory: true,
        candidateCategory: profile.name && !profile.city ? 'userName' : profile.city && !profile.name ? 'userCity' : 'userName',
        candidateItem: changedParts.join(', '),
        updatedMemory: updated,
      };
    }
    return { hasAutoMemory: false };
  }

  // 4. High-Confidence: INTERESTS ("Mi piace fare foto e video", "Amo la musica jazz")
  const interestPattern = /^(?:io[,\s]+)?(?:mi piace|mi piacciono|amo|adoro|la mia passione è|il mio hobby è|sono appassionato di)\s+([^.!?]+)$/i;
  const interestMatch = input.match(interestPattern);
  if (interestMatch) {
    const rawInterest = cleanText(interestMatch[1]);
    const lowerInterest = rawInterest.toLowerCase();

    // Check if it's a temporary feeling (e.g. "mi piace questo vestito", "mi piace come parli")
    const temporaryInterestTriggers = ['questo', 'questa', 'quello', 'quella', 'come parli', 'quando dici', 'oggi'];
    if (!temporaryInterestTriggers.some((t) => lowerInterest.startsWith(t))) {
      const formattedInterest = capitalize(rawInterest);
      const existing = currentMemory.interests || [];
      const alreadyPresent = existing.some((item) => isFuzzyMatch(item, formattedInterest));
      if (!alreadyPresent) {
        const updated: UserMemory = {
          ...currentMemory,
          interests: [...existing, formattedInterest],
        };
        return {
          hasAutoMemory: true,
          candidateCategory: 'interests',
          candidateItem: formattedInterest,
          updatedMemory: updated,
        };
      }
      return { hasAutoMemory: false };
    }
  }

  // 5. High-Confidence: PROJECTS ("Sto lavorando al progetto MAIA", "Il mio progetto è un'app di cucina")
  const projectPattern = /^(?:io[,\s]+)?(?:sto lavorando al?|sto sviluppando|il mio progetto è|sto creando)\s+([^.!?]+)$/i;
  const projectMatch = input.match(projectPattern);
  if (projectMatch) {
    const rawProject = cleanText(projectMatch[1]);
    const lowerProject = rawProject.toLowerCase();

    // Check false positives (e.g. "sto lavorando adesso", "sto lavorando duro")
    if (!['adesso', 'ora', 'duro', 'tanto', 'abbastanza'].includes(lowerProject)) {
      const formattedProject = capitalize(rawProject);
      const existing = currentMemory.projects || [];
      const alreadyPresent = existing.some((item) => isFuzzyMatch(item, formattedProject));
      if (!alreadyPresent) {
        const updated: UserMemory = {
          ...currentMemory,
          projects: [...existing, formattedProject],
        };
        return {
          hasAutoMemory: true,
          candidateCategory: 'projects',
          candidateItem: formattedProject,
          updatedMemory: updated,
        };
      }
      return { hasAutoMemory: false };
    }
  }

  // 6. High-Confidence: PREFERENCES & PREFERENCE UPDATES
  const prefPattern = /^(?:da adesso[,\s]+)?(?:in realtà[,\s]+)?(?:preferisco|preferirei|gradisco|voglio risposte)\s+([^.!?]+)$/i;
  const prefMatch = input.match(prefPattern);
  if (prefMatch) {
    const rawPref = cleanText(prefMatch[1]);
    // Standardize to "Preferisco ..."
    const standardizedPref = `Preferisco ${rawPref.replace(/^(?:risposte\s+)/i, 'risposte ')}`;
    const existing = currentMemory.preferences || [];

    // Check if conflicting with an existing preference (e.g. short vs detailed)
    const conflictIdx = findConflictingPreferenceIndex(existing, standardizedPref);
    if (conflictIdx !== -1) {
      const updatedList = [...existing];
      updatedList[conflictIdx] = standardizedPref;
      const updated: UserMemory = { ...currentMemory, preferences: updatedList };
      return {
        hasAutoMemory: true,
        candidateCategory: 'preferences',
        candidateItem: standardizedPref,
        updatedMemory: updated,
      };
    }

    // Check duplicate
    const alreadyPresent = existing.some((item) => isFuzzyMatch(item, standardizedPref));
    if (!alreadyPresent) {
      const updated: UserMemory = {
        ...currentMemory,
        preferences: [...existing, standardizedPref],
      };
      return {
        hasAutoMemory: true,
        candidateCategory: 'preferences',
        candidateItem: standardizedPref,
        updatedMemory: updated,
      };
    }
    return { hasAutoMemory: false };
  }

  // 7. AMBIGUOUS CANDIDATE: Needs Confirmation ("Vuoi che la salvi?")
  // e.g. "Di solito lavoro di notte", "Non bevo mai alcolici", "Sono vegetariano", "Ho un gatto"
  const habitPattern = /^(?:di solito|faccio sempre|non bevo mai|non mangio mai|sono vegetariano|sono vegano|ho un cane|ho un gatto|non sopporto)\s+([^.!?]+)$/i;
  const habitMatch = input.match(habitPattern);
  if (habitMatch) {
    const candidateItem = capitalize(input);
    const existingNotes = currentMemory.notes || [];
    const alreadyPresent = existingNotes.some((n) => isFuzzyMatch(n, candidateItem));
    if (!alreadyPresent) {
      return {
        hasAutoMemory: false,
        needsConfirmation: true,
        candidateCategory: 'notes',
        candidateItem,
        confirmationPrompt:
          'Questa informazione potrebbe essermi utile da ricordare. Vuoi che la salvi?',
      };
    }
  }

  return { hasAutoMemory: false };
}
