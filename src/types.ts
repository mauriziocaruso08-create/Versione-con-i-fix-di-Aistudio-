export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  error?: boolean;
  modelSource?: string;
}

export type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type ToneSetting = 'balanced' | 'concise' | 'analytical' | 'creative';

export interface AppSettings {
  tone: ToneSetting;
  autoSpeak: boolean;
  speechRate: number;
  speechPitch: number;
  soundEffects: boolean;
}

export type PreferenceCategory =
  | 'response_style'
  | 'language'
  | 'tone'
  | 'verbosity'
  | 'formatting'
  | 'interaction'
  | 'development'
  | 'workflow'
  | 'interests';

export type PreferenceSource = 'EXPLICIT' | 'CONFIRMED' | 'LEARNED';

export interface MaiaPreference {
  id: string;
  key: string;
  value: unknown;
  category: PreferenceCategory;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  source: PreferenceSource;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  rawText?: string;
  scope?: string; // Optional domain scope, e.g. "development", "casual"
}

export interface MaiaPersonalFact {
  id: string;
  key: string;
  value: unknown;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  source: 'EXPLICIT' | 'CONFIRMED' | 'LEARNED';
  createdAt: number;
  updatedAt: number;
  rawText?: string;
}

export interface UserMemory {
  userName?: string;
  userCity?: string;
  preferences: string[];
  interests: string[];
  projects: string[];
  notes: string[];
  structuredPreferences?: MaiaPreference[];
  /** Deterministic personal facts, separate from behavioral preferences. */
  personalFacts?: MaiaPersonalFact[];
}

export interface MaiaNote {
  id: string;
  /** Optional human-readable title; content remains in text for backward compatibility. */
  title?: string;
  text: string;
  createdAt: string;
}

export interface MaiaReminder {
  id: string;
  text: string;
  dueAt: string; // ISO 8601 string in absolute time
  createdAt: string;
  completed: boolean;
  notified?: boolean;
  originalInput?: string;
}

export const DEFAULT_USER_MEMORY: UserMemory = {
  userName: '',
  userCity: '',
  preferences: [],
  interests: [],
  projects: [],
  notes: [],
  structuredPreferences: [],
  personalFacts: [],
};

