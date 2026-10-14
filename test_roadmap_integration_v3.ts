// MAIA V7.1 Roadmap Integration v3 — regression checklist.
export const roadmapV3RegressionCases = [
  'Reset & Clear Chat History preserves userName/userCity and personal memory.',
  'Transient empty UserMemory cannot overwrite a valid persistent profile; explicit memory deletion can clear it.',
  'Cancella il promemoria with multiple reminders returns clarification, never ALL.',
  'Cancella tutti i promemoria explicitly still resolves ALL.',
  'Quali note ho? displays title and content when title exists.',
  'Specific note update preserves existing title.',
  'Automatic Model Router can fail over to the next configured real provider.',
  'Budget is checked before every provider attempt.',
  'Ambiguous target -> clarification -> selection -> verified action remains intact.',
  'Missing target -> NOT_FOUND recovery without side effects remains intact.',
] as const;
