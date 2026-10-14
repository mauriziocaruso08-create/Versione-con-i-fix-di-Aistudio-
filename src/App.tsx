import { loadProjects } from './services/projects/projectManager';
import React, { useState, useEffect, useRef } from 'react';
import { Message, AssistantState, AppSettings, UserMemory, DEFAULT_USER_MEMORY, MaiaNote, MaiaReminder } from './types';
import { AndroidStatusBar } from './components/AndroidStatusBar';
import { MaiaHeader } from './components/MaiaHeader';
import { MaiaNeuralCore } from './components/MaiaNeuralCore';
import { ChatMessageItem } from './components/ChatMessageItem';
import { ChatInputBar } from './components/ChatInputBar';
import { SettingsModal } from './components/SettingsModal';
import { sounds, voiceManager, speakText, stopSpeaking } from './utils/audio';
import {
  detectAutoMemory,
  isConfirmationAffirmative,
  isConfirmationNegative,
} from './utils/memoryManager';
import { loadNotes, saveNotes } from './utils/notesManager';
import {
  loadReminders,
  deleteReminder,
  completeReminder,
  checkDueReminders,
  markAsNotified,
} from './utils/reminderManager';
import {
  getNotificationPermission,
  requestNotificationPermission,
  showReminderNotification,
  registerNotificationServiceWorker,
  isNotificationSupported,
} from './utils/notificationManager';
import { maiaCore } from './services/core/maiaCore';
import { loadUserMemory, saveUserMemory } from './services/router/actionExecutor';
import { clearPendingConfirmation } from './services/router/confirmationManager';
import { resetContext } from './services/context/sessionContext';
import { Sparkles } from 'lucide-react';

const CHAT_STORAGE_KEY = 'maia_chat_gemini_v1';
const MEMORY_STORAGE_KEY = 'maia_user_memory_v1';
const PROFILE_STORAGE_KEY = 'maia_user_profile_v1';

const INITIAL_GREETING: Message = {
  id: 'init-1',
  role: 'model',
  content:
    "Sono **MAIA**, un assistente AI. Posso aiutarti con domande, testi, analisi, programmazione, note, promemoria e progetti.\n\nPuoi scrivere qui il tuo messaggio oppure usare il microfono.",
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  modelSource: 'MAIA Core',
};

export default function App() {
  // Messages state with local persistence and automatic purge of previous test mocks
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      // Purge old mock test chat history if found
      localStorage.removeItem('maia_chat_history');

      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [INITIAL_GREETING];
  });

  // Persistent User Memory (Separate from chat history)
  const [memory, setMemory] = useState<UserMemory>(() => {
    try {
      const saved = localStorage.getItem(MEMORY_STORAGE_KEY);
      const savedProfile = localStorage.getItem(PROFILE_STORAGE_KEY);
      const parsedProfile = savedProfile ? JSON.parse(savedProfile) : {};
      if (saved || savedProfile) {
        const parsed = saved ? JSON.parse(saved) : {};
        if (parsed && typeof parsed === 'object') {
          return {
            userName: typeof parsedProfile?.userName === 'string' && parsedProfile.userName.trim() ? parsedProfile.userName : typeof parsed.userName === 'string' ? parsed.userName : '',
            userCity: typeof parsedProfile?.userCity === 'string' && parsedProfile.userCity.trim() ? parsedProfile.userCity : typeof parsed.userCity === 'string' ? parsed.userCity : '',
            preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
            interests: Array.isArray(parsed.interests) ? parsed.interests : [],
            projects: Array.isArray(parsed.projects) ? parsed.projects : [],
            notes: Array.isArray(parsed.notes) ? parsed.notes : [],
            structuredPreferences: Array.isArray(parsed.structuredPreferences)
              ? parsed.structuredPreferences
              : [],
            personalFacts: Array.isArray(parsed.personalFacts) ? parsed.personalFacts : [],
          };
        }
      }
    } catch (e) {
      console.error('Error loading memory:', e);
    }
    return DEFAULT_USER_MEMORY;
  });

  const [input, setInput] = useState('');
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [notes, setNotes] = useState<MaiaNote[]>(() => loadNotes());
  const [reminders, setReminders] = useState<MaiaReminder[]>(() => loadReminders());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isFramed, setIsFramed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'generali' | 'voce' | 'note' | 'promemoria' | 'memoria' | 'progetti' | 'info'>('generali');
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [pendingMemoryCandidate, setPendingMemoryCandidate] = useState<{
    category: keyof UserMemory;
    item: string;
  } | null>(null);

  // Auto-dismiss voice error notification banner after 8 seconds
  useEffect(() => {
    if (voiceError) {
      const timer = setTimeout(() => {
        setVoiceError(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [voiceError]);

  // Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('maia_settings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    // Legacy storage value `balanced` now represents the neutral, unpersonalized baseline.
    return {
      tone: 'balanced',
      autoSpeak: false,
      speechRate: 1.05,
      speechPitch: 1.0,
      soundEffects: true,
    };
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  // Monotonic chat-session generation. Any in-flight AI response belongs to
  // the generation that created it and must never leak into a newer chat.
  const chatSessionGenerationRef = useRef(0);

  // Persist messages using the canonical chat key.
  // The storage event below keeps multiple same-origin MAIA runtimes/tabs in sync.
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  // Cross-runtime synchronization for Preview/Standalone instances that share
  // the same browser origin. This deliberately does not merge different
  // origins: browser localStorage is isolated by origin by design.
  // IMPORTANT: deletion events have newValue === null, so they must also be
  // handled; otherwise a cleared chat/memory could remain visible in another tab.
  useEffect(() => {
    const parseStoredMemory = (value: string | null): UserMemory => {
      try {
        const parsed = value ? JSON.parse(value) : {};
        const profileRaw = localStorage.getItem(PROFILE_STORAGE_KEY);
        const profile = profileRaw ? JSON.parse(profileRaw) : {};
        if (parsed && typeof parsed === 'object') {
          return {
            userName: typeof profile?.userName === 'string' && profile.userName.trim() ? profile.userName : typeof parsed.userName === 'string' ? parsed.userName : '',
            userCity: typeof profile?.userCity === 'string' && profile.userCity.trim() ? profile.userCity : typeof parsed.userCity === 'string' ? parsed.userCity : '',
            preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
            interests: Array.isArray(parsed.interests) ? parsed.interests : [],
            projects: Array.isArray(parsed.projects) ? parsed.projects : [],
            notes: Array.isArray(parsed.notes) ? parsed.notes : [],
            structuredPreferences: Array.isArray(parsed.structuredPreferences)
              ? parsed.structuredPreferences
              : [],
            personalFacts: Array.isArray(parsed.personalFacts) ? parsed.personalFacts : [],
          };
        }
      } catch (_) {}
      return DEFAULT_USER_MEMORY;
    };

    const handleStorageSync = (event: StorageEvent) => {
      try {
        if (event.key === CHAT_STORAGE_KEY) {
          if (!event.newValue) {
            setMessages([INITIAL_GREETING]);
          } else {
            const parsed = JSON.parse(event.newValue);
            setMessages(Array.isArray(parsed) && parsed.length > 0 ? parsed : [INITIAL_GREETING]);
          }
        }

        if (event.key === MEMORY_STORAGE_KEY || event.key === PROFILE_STORAGE_KEY) {
          setMemory(parseStoredMemory(localStorage.getItem(MEMORY_STORAGE_KEY)));
        }

        if (event.key === 'maia_settings') {
          if (!event.newValue) {
            setSettings((prev) => ({
              ...prev,
              tone: 'balanced',
              autoSpeak: false,
              speechRate: 1.05,
              speechPitch: 1.0,
              soundEffects: true,
            }));
          } else {
            const parsed = JSON.parse(event.newValue);
            if (parsed && typeof parsed === 'object') {
              setSettings((prev) => ({ ...prev, ...parsed }));
            }
          }
        }

        if (event.key === 'maia_notes_v1') setNotes(loadNotes());
        if (event.key === 'maia_reminders_v1') setReminders(loadReminders());
      } catch (error) {
        console.warn('[MAIA] Cross-runtime storage sync failed:', error);
      }
    };

    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  // Persist memory independently from chat.
  // saveUserMemory protects the dedicated profile from transient empty identity values.
  useEffect(() => {
    saveUserMemory(memory);
  }, [memory]);

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem('maia_settings', JSON.stringify(settings));
    } catch (e) {}
  }, [settings]);

  // Fetch server status on mount
  useEffect(() => {
    fetch('/api/status')
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(`Status endpoint returned ${contentType || 'non-JSON'} (${res.status}).`);
        }
        return res.json();
      })
      .then((data) => setSystemInfo(data))
      .catch(() => {
        setSystemInfo({
          status: 'online',
          model: 'gemini-3.8-flash',
          liveEngine: 'Gemini 3.8 Flash',
          hasApiKey: false,
          modelRouter: { mode: 'automatic', selectedProvider: 'none', providerDisplayName: 'Nessun provider disponibile', configured: false, budget: { totalRequests: 0, globalDailyLimit: 0 } },
        });
      });
  }, []);

  // Auto scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior,
      });
    }
  };

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, assistantState]);

  // Update settings handler
  const handleUpdateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  // Memory handlers
  const handleUpdateMemory = (newMemory: Partial<UserMemory>) => {
    setMemory((prev) => ({ ...prev, ...newMemory }));
  };

  const handleClearMemory = () => {
    try {
      localStorage.removeItem(MEMORY_STORAGE_KEY);
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      localStorage.removeItem('maia_notes_v1');
      localStorage.removeItem('maia_reminders_v1');
    } catch (e) {}
    setMemory(DEFAULT_USER_MEMORY);
    setNotes([]);
    setReminders([]);
  };

  const handleDeleteNote = (id: string) => {
    const current = loadNotes();
    const remaining = current.filter((n) => n.id !== id);
    saveNotes(remaining);
    setNotes(loadNotes());
  };

  const handleDeleteReminder = (id: string) => {
    const target = loadReminders().find((reminder) => reminder.id === id);
    if (!target) {
      setReminders(loadReminders());
      return;
    }
    // UI deletion is destructive too: ask for confirmation just like chat deletion.
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Vuoi eliminare il promemoria "${target.text}"?`)
      : false;
    if (!confirmed) return;
    const deleted = deleteReminder(id);
    if (deleted) setReminders(loadReminders());
  };

  const handleToggleCompleteReminder = (id: string) => {
    const target = reminders.find((r) => r.id === id);
    if (target) {
      completeReminder(id, !target.completed);
      setReminders(loadReminders());
    }
  };

  const handleRequestNotificationPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
  };

  // Check notification permission & bootstrap service worker on mount
  useEffect(() => {
    setNotificationPermission(getNotificationPermission());
    if (isNotificationSupported()) {
      registerNotificationServiceWorker().catch(() => {});
    }
  }, []);

  // Periodic check for due reminders while MAIA is active
  useEffect(() => {
    const checkReminders = async () => {
      const due = checkDueReminders();
      if (due.length > 0) {
        for (const rem of due) {
          await showReminderNotification(rem);
          markAsNotified(rem.id);
          sounds.playListenStart(settings.soundEffects);
        }
        setReminders(loadReminders());
      }
    };

    checkReminders();
    const interval = setInterval(checkReminders, 15000);

    const handleSyncState = () => {
      setNotificationPermission(getNotificationPermission());
      if (document.visibilityState === 'visible') {
        checkReminders();
      }
    };

    document.addEventListener('visibilitychange', handleSyncState);
    window.addEventListener('focus', handleSyncState);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleSyncState);
      window.removeEventListener('focus', handleSyncState);
    };
  }, [settings.soundEffects]);

  // Clear conversation & storage (Memory remains untouched)
  const handleClearChat = () => {
    // Invalidate every in-flight response before resetting the visible chat.
    // This prevents an old Gemini response from being appended to the new chat.
    chatSessionGenerationRef.current += 1;
    stopSpeaking();
    setSpeakingMessageId(null);
    setAssistantState('idle');
    setPendingMemoryCandidate(null);
    clearPendingConfirmation();
    resetContext();
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
      localStorage.removeItem('maia_chat_history');
    } catch (e) {}
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: 'model',
        content: "Memoria di sessione azzerata. Pronta per il prossimo giro, dimmi tutto.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelSource: 'MAIA Core',
      },
    ]);
  };

  // Speak aloud handler
  const handleSpeak = (text: string, messageId?: string) => {
    if (speakingMessageId === messageId) {
      stopSpeaking();
      setSpeakingMessageId(null);
      setAssistantState('idle');
      return;
    }

    setSpeakingMessageId(messageId || 'adhoc');
    setAssistantState('speaking');

    speakText(
      text,
      { rate: settings.speechRate, pitch: settings.speechPitch },
      () => setAssistantState('speaking'),
      () => {
        setSpeakingMessageId(null);
        setAssistantState('idle');
      }
    );
  };

  const handleStopSpeak = () => {
    stopSpeaking();
    setSpeakingMessageId(null);
    setAssistantState('idle');
  };

  // Helper to dispatch assistant responses from local actions, confirmations, or system guards
  const dispatchAssistantReply = (content: string, sourceLabel: string = 'MAIA Actions') => {
    const modelMessageId = `model-${Date.now()}`;
    const modelMessage: Message = {
      id: modelMessageId,
      role: 'model',
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelSource: sourceLabel,
    };

    setMessages((prev) => [...prev, modelMessage]);
    setAssistantState('idle');

    if (settings.autoSpeak) {
      handleSpeak(content, modelMessageId);
    }
  };

  // Send message to MAIA
  const handleSendMessage = async (textToSend?: string) => {
    const rawQuery = textToSend ?? input;
    const cleanQuery = rawQuery.trim();
    // Capture the active chat generation. If the user starts a new chat while
    // this request is in flight, the response must be discarded.
    const requestChatGeneration = chatSessionGenerationRef.current;
    if (!cleanQuery || assistantState === 'thinking') return;

    // If currently listening or starting, stop
    if (isListening || voiceManager.isBusy()) {
      voiceManager.stop();
      setIsListening(false);
      setInterimTranscript('');
    }

    // Sound effect
    sounds.playSendClick(settings.soundEffects);

    const userMessage: Message = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: cleanQuery,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setInterimTranscript('');

    // =========================================================================
    // STEP 1: CHECK HEURISTIC AUTO-MEMORY CANDIDATE CONFIRMATION (Isolated)
    // =========================================================================
    if (pendingMemoryCandidate) {
      if (isConfirmationAffirmative(cleanQuery)) {
        const cat = pendingMemoryCandidate.category;
        const item = pendingMemoryCandidate.item;
        let updated: UserMemory = { ...memory };
        if (cat === 'userName') {
          updated.userName = item;
        } else if (cat === 'userCity') {
          updated.userCity = item;
        } else {
          const existing = (updated[cat] as string[]) || [];
          updated = { ...updated, [cat]: [...existing, item] };
        }

        setMemory(updated);
        try {
          localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {}
        setPendingMemoryCandidate(null);

        dispatchAssistantReply(
          'Memorizzato. Questa me la tengo a mente anche per le prossime conversazioni.',
          'MAIA Memory Engine'
        );
        return;
      } else if (isConfirmationNegative(cleanQuery)) {
        setPendingMemoryCandidate(null);
        dispatchAssistantReply(
          "D'accordo, non salvo nulla. Di cosa stavamo parlando?",
          'MAIA Memory Engine'
        );
        return;
      }
      // If user says something completely different, dismiss pending candidate and proceed
      setPendingMemoryCandidate(null);
    }

    // =========================================================================
    // STEP 2: MAIA SEMANTIC ORCHESTRATOR (PHASE 6D SINGLE SOURCE OF TRUTH)
    // Pipeline: Input -> SessionContext -> 6B Intent -> 6C Target -> 6D Capability
    // =========================================================================
    const orchResult = await maiaCore.processInput(cleanQuery);

    if (orchResult.type === 'HANDLED_LOCAL' || orchResult.type === 'CONFIRMATION_REQUIRED') {
      if (orchResult.dataAffected) {
        setNotes(loadNotes());
        setReminders(loadReminders());
        setMemory(loadUserMemory());
      }
      dispatchAssistantReply(
        orchResult.feedbackText || 'Operazione completata.',
        orchResult.sourceLabel || 'MAIA Actions'
      );
      return;
    }

    // =========================================================================
    // STEP 3: FALLTHROUGH TO CONVERSATIONAL GEMINI PIPELINE (Cognitive Queries)
    // =========================================================================
    // Check for heuristic automatic intelligent memory candidate (on conversation)
    let currentEffectiveMemory = memory;
    const autoResult = detectAutoMemory(cleanQuery, memory);
    if (autoResult.needsConfirmation && autoResult.candidateCategory && autoResult.candidateItem) {
      setPendingMemoryCandidate({
        category: autoResult.candidateCategory,
        item: autoResult.candidateItem,
      });
      const promptText =
        autoResult.confirmationPrompt ||
        'Questa informazione potrebbe essermi utile da ricordare. Vuoi che la salvi?';
      dispatchAssistantReply(promptText, 'MAIA Memory Engine');
      return;
    } else if (autoResult.hasAutoMemory && autoResult.updatedMemory) {
      currentEffectiveMemory = autoResult.updatedMemory;
      setMemory(autoResult.updatedMemory);
      saveUserMemory(autoResult.updatedMemory);
    }

    setAssistantState('thinking');

    try {
      const generation = await maiaCore.generateConversation({
        messages: newMessages,
        tone: settings.tone,
        memory: currentEffectiveMemory,
      });

      // The user may have started a new chat while the provider was thinking.
      // Never leak the previous request into the new session.
      if (requestChatGeneration !== chatSessionGenerationRef.current) return;

      const replyText = generation.reply;
      if (generation.modelRouter) {
        setSystemInfo((prev: any) => ({ ...(prev || {}), modelRouter: generation.modelRouter }));
      }
      const modelMessageId = `model-${Date.now()}`;
      const modelMessage: Message = {
        id: modelMessageId,
        role: 'model',
        content: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelSource: generation.modelId || generation.providerId || 'MAIA AI',
      };

      setMessages((prev) => [...prev, modelMessage]);
      setAssistantState('idle');

      // Auto-speak if enabled
      if (settings.autoSpeak) {
        handleSpeak(replyText, modelMessageId);
      }
    } catch (err: any) {
      // Ignore failures from requests that belong to a chat session the user
      // has already discarded. The new chat should remain clean.
      if (requestChatGeneration !== chatSessionGenerationRef.current) return;

      console.warn('Chat warning/error:', err?.message || err);
      const errorMessage: Message = {
        id: `err-${Date.now()}`,
        role: 'model',
        content: `⚠️ ${err?.message || 'Errore di connessione a Gemini API. Verifica la configurazione o riprova.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        error: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
      setAssistantState('idle');
    }
  };

  // Toggle voice recognition
  const handleToggleListening = () => {
    // If currently listening or in transition (starting/stopping), treat click as stop
    if (isListening || voiceManager.isBusy()) {
      voiceManager.stop();
      setIsListening(false);
      setAssistantState('idle');
      sounds.playListenEnd(settings.soundEffects);

      if (interimTranscript.trim()) {
        handleSendMessage(interimTranscript);
      }
      return;
    }

    // Clear any previous error banner
    setVoiceError(null);

    // Stop speech playback if speaking
    if (assistantState === 'speaking') {
      stopSpeaking();
      setSpeakingMessageId(null);
    }

    setInterimTranscript('');

    // Start recognition with state machine protection
    voiceManager.start({
      onStart: () => {
        setIsListening(true);
        setAssistantState('listening');
        setVoiceError(null);
        sounds.playListenStart(settings.soundEffects);
      },
      onResult: (transcript, isFinal) => {
        setInterimTranscript(transcript);
        if (isFinal && transcript.trim()) {
          voiceManager.stop();
          setIsListening(false);
          setAssistantState('idle');
          sounds.playListenEnd(settings.soundEffects);
          handleSendMessage(transcript);
        }
      },
      onError: (err) => {
        console.warn('Voice recognition error:', err);
        setIsListening(false);
        setAssistantState('idle');
        setInterimTranscript('');
        setVoiceError(err);
      },
      onEnd: () => {
        setIsListening(false);
        setAssistantState((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
  };

  // Retry last query on error
  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      setMessages((prev) => prev.filter((m) => !m.error));
      handleSendMessage(lastUserMsg.content);
    }
  };

  // Quick prompt select
  const handleSelectPrompt = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const openSettingsTab = (tab: 'generali' | 'voce' | 'note' | 'promemoria' | 'memoria' | 'progetti' | 'info') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  // App Layout Frame
  return (
    <div className="min-h-screen w-full bg-[#03060d] flex items-center justify-center sm:p-4 text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Container: Either Android Smartphone Mockup or Full Screen */}
      <div
        className={`w-full transition-all duration-300 flex flex-col overflow-hidden bg-[#070b16] ${
          isFramed
            ? 'sm:max-w-[430px] sm:h-[880px] sm:max-h-[95vh] sm:rounded-[44px] sm:border-[8px] sm:border-slate-800/80 sm:shadow-[0_0_60px_rgba(6,182,212,0.18)] sm:ring-1 sm:ring-cyan-500/30 h-screen'
            : 'h-screen max-w-4xl mx-auto sm:border sm:border-cyan-500/20 sm:rounded-2xl'
        }`}
      >
        {/* Android Status Bar */}
        <AndroidStatusBar state={assistantState} />

        {/* Top App Bar Header */}
        <MaiaHeader
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onOpenSettings={() => openSettingsTab('generali')}
          onOpenNotes={() => openSettingsTab('note')}
          onOpenReminders={() => openSettingsTab('promemoria')}
          onOpenProjects={() => openSettingsTab('progetti')}
          onClearChat={handleClearChat}
          notesCount={notes.length}
          remindersCount={reminders.filter((r) => !r.completed).length}
          projectsCount={loadProjects().length}
          isFramed={isFramed}
          onToggleFrame={() => setIsFramed(!isFramed)}
          hasMessages={messages.length > 1}
        />

        {/* Central Chat Viewport */}
        <main
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto px-4 py-2 space-y-1 relative"
        >
          {/* Subtle Cybernetic Grid Glow Backdrop */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:24px_24px]"
            aria-hidden="true"
          />

          {/* Neural Core Widget */}
          <div className="relative z-10">
            <MaiaNeuralCore
              state={assistantState}
              onCoreClick={() => {
                if (assistantState === 'speaking') {
                  handleStopSpeak();
                } else {
                  handleToggleListening();
                }
              }}
              isCompact={messages.length > 3}
            />
          </div>

          {/* Conversation Stream */}
          <div className="relative z-10 pb-4">
            {messages.map((msg, index) => (
              <ChatMessageItem
                key={msg.id}
                message={msg}
                isSpeaking={speakingMessageId === msg.id}
                onSpeak={(text) => handleSpeak(text, msg.id)}
                onStopSpeak={handleStopSpeak}
                onRetry={handleRetry}
                isLatestModelMessage={
                  index === messages.length - 1 && msg.role === 'model'
                }
              />
            ))}

            {/* Thinking / Synthesizing State Indicator */}
            {assistantState === 'thinking' && (
              <div className="flex items-center gap-2.5 my-3 text-xs text-cyan-300">
                <div className="w-7 h-7 rounded-full bg-cyan-950/60 border border-cyan-400/40 flex items-center justify-center animate-pulse">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-300 animate-spin" />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#090e1c] border border-cyan-500/20">
                  <span className="font-medium text-slate-300">MAIA is thinking</span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"
                      style={{ animationDelay: '0.15s' }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"
                      style={{ animationDelay: '0.3s' }}
                    />
                  </span>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Bottom Input Area */}
        <ChatInputBar
          input={input}
          setInput={setInput}
          onSend={handleSendMessage}
          isListening={isListening}
          onToggleListening={handleToggleListening}
          isLoading={assistantState === 'thinking'}
          interimTranscript={interimTranscript}
          onSelectPrompt={handleSelectPrompt}
          showSuggestions={messages.length <= 2}
          voiceError={voiceError}
          onClearVoiceError={() => setVoiceError(null)}
        />

        {/* Preferences & Settings Drawer */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialTab={settingsTab}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onClearHistory={handleClearChat}
          systemInfo={systemInfo}
          memory={memory}
          onUpdateMemory={handleUpdateMemory}
          onClearMemory={handleClearMemory}
          notes={notes}
          onDeleteNote={handleDeleteNote}
          reminders={reminders}
          onDeleteReminder={handleDeleteReminder}
          onToggleCompleteReminder={handleToggleCompleteReminder}
          notificationPermission={notificationPermission}
          onRequestNotificationPermission={handleRequestNotificationPermission}
        />
      </div>
    </div>
  );
}
