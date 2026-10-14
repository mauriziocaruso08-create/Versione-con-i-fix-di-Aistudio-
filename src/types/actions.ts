/**
 * Taxonomical action types supported by the MAIA Action Router.
 */
export type MaiaActionType =
  // User Memory Actions
  | 'MEMORY_SAVE'
  | 'MEMORY_DELETE'
  | 'MEMORY_QUERY'
  // Notes Actions
  | 'NOTE_CREATE'
  | 'NOTE_LIST'
  | 'NOTE_DELETE'
  // Reminder Actions
  | 'REMINDER_CREATE'
  | 'REMINDER_LIST'
  | 'REMINDER_COMPLETE'
  | 'REMINDER_DELETE'
  // Future Task Actions (Reserved for subsequent phases)
  | 'TASK_CREATE'
  | 'TASK_LIST'
  | 'TASK_COMPLETE'
  | 'TASK_DELETE'
  // Future Integration Actions (Reserved for subsequent phases)
  | 'WEB_SEARCH'
  | 'OPEN_APP'
  | 'CALENDAR'
  | 'SEND_MESSAGE'
  // Fallthrough to Conversational LLM (Gemini)
  | 'CHAT_FALLTHROUGH';

/**
 * Lifecycle status of an action resolution or execution.
 */
export type ActionStatus =
  | 'DETERMINISTIC_LOCAL'    // Deterministic local action identified, ready for execution engine
  | 'EXTERNAL_TOOL'          // External tool or async capability (e.g. WEB_SEARCH)
  | 'EXECUTED_SUCCESS'      // Successfully executed (Phase 2 Executor)
  | 'EXECUTED_FAILURE'      // Execution failed (Phase 2 Executor)
  | 'AMBIGUOUS_INPUT'       // Input is ambiguous or missing required parameters, clarification needed
  | 'CONFIRMATION_REQUIRED' // Action is destructive or sensitive, explicit user confirmation needed
  | 'FALLTHROUGH_GEMINI';   // General conversational/reasoning query, should be forwarded to Gemini

/**
 * A source citation returned by web search grounding.
 */
export interface WebSearchSource {
  title: string;
  url: string;
}

/**
 * Parameters for a WEB_SEARCH action.
 */
export interface WebSearchParams {
  searchQuery: string;
  category?: 'weather' | 'news' | 'technology' | 'general';
}

/**
 * Structured result returned from the web search service.
 */
export interface WebSearchResult {
  success: boolean;
  query: string;
  summary: string;
  sources?: WebSearchSource[];
  error?: string;
}

/**
 * Structured parameters and metadata associated with an action resolution.
 */
export interface ActionPayload {
  rawText: string;
  parameters?: Record<string, unknown>;
  isDestructive?: boolean;
}

/**
 * Result returned by the Action Router when classifying user intent.
 */
export interface RouterResolution {
  actionType: MaiaActionType;
  status: ActionStatus;
  payload?: ActionPayload;
  clarificationMessage?: string;
  confirmationPrompt?: string;
}

/**
 * Result returned after an action execution attempt (used in subsequent phases).
 */
export interface ActionResult {
  success: boolean;
  actionType: MaiaActionType;
  feedbackText: string;
  sourceLabel?: string;
  dataAffected?: boolean;
  error?: string;
}
