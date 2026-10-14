// Audio and Speech Utilities for MAIA

class SoundManager {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Soft futuristic startup chime for listening
  playListenStart(enabled = true) {
    if (!enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.23);
    } catch (e) {
      // Audio autoplay policy catch
    }
  }

  // Listening stop / send sound
  playListenEnd(enabled = true) {
    if (!enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.14);

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    } catch (e) {}
  }

  // Futuristic gentle tick on message send
  playSendClick(enabled = true) {
    if (!enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1050, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  }
}

export const sounds = new SoundManager();

// Speech Recognition
export interface SpeechRecognitionHandlers {
  onStart?: () => void;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export type VoiceRecognitionState = 'idle' | 'starting' | 'listening' | 'stopping';

export class VoiceRecognitionManager {
  private recognition: any = null;
  private cleanupInstance: any = null;
  private state: VoiceRecognitionState = 'idle';
  private currentLanguage = 'it-IT';
  private pendingStartHandlers: SpeechRecognitionHandlers | null = null;
  private restartTimer: any = null;

  constructor(defaultLang = 'it-IT') {
    this.currentLanguage = defaultLang;
  }

  private isMobileOrAndroid(): boolean {
    const nav = (typeof window !== 'undefined' && (window as any).navigator)
      ? (window as any).navigator
      : (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav) return false;
    const ua = nav.userAgent || '';
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  }

  private getSpeechRecognitionClass(): any {
    if (typeof window === 'undefined') return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
  }

  private formatErrorMessage(error: string): string {
    switch (error) {
      case 'not-allowed':
        return 'Accesso al microfono negato o bloccato dal browser / Preview. Verifica i permessi o le restrizioni sandbox dell\'iframe.';
      case 'service-not-allowed':
        return 'Servizio di trascrizione vocale non consentito dal browser o dal contesto di sicurezza dell\'iframe.';
      case 'audio-capture':
        return 'Nessun microfono rilevato o dispositivo audio non disponibile.';
      case 'network':
        return 'Errore di connessione di rete verso il motore vocale.';
      case 'no-speech':
        // Routine timeout on mobile/Android when no speech is detected; return empty to avoid disruptive banner
        return '';
      case 'language-not-supported':
        return `La lingua impostata (${this.currentLanguage}) non è supportata dal motore vocale del dispositivo.`;
      case 'aborted':
        return '';
      default:
        return `Errore di riconoscimento vocale: ${error || 'sconosciuto'}`;
    }
  }

  private teardownInstance(instance: any) {
    if (!instance) return;

    try {
      instance.onstart = null;
      instance.onaudiostart = null;
      instance.onsoundstart = null;
      instance.onspeechstart = null;
      instance.onresult = null;
      instance.onspeechend = null;
      instance.onsoundend = null;
      instance.onaudioend = null;
      instance.onerror = null;
      instance.onend = null;
    } catch (e) {}

    try {
      if (typeof instance.abort === 'function') {
        instance.abort();
      } else if (typeof instance.stop === 'function') {
        instance.stop();
      }
    } catch (e) {}

    if (this.recognition === instance) {
      this.recognition = null;
    }
    if (this.cleanupInstance === instance) {
      this.cleanupInstance = null;
    }
  }

  private createRecognition(handlers: SpeechRecognitionHandlers): any {
    const SpeechRecognitionClass = this.getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) return null;

    const instance = new SpeechRecognitionClass();
    // On Android and mobile devices, native SpeechRecognizer works best with single-utterance (continuous = false)
    const isMobile = this.isMobileOrAndroid();
    instance.continuous = !isMobile;
    instance.interimResults = true;
    instance.lang = this.currentLanguage;

    instance.onstart = () => {
      if (this.recognition !== instance) return;
      this.state = 'listening';
      console.log('[MAIA Voice] Recognition started (listening active)');
      handlers.onStart?.();
    };

    // Lightweight diagnostic lifecycle events
    instance.onaudiostart = () => {
      console.log('[MAIA Voice] onaudiostart (hardware capture active)');
    };

    instance.onspeechstart = () => {
      console.log('[MAIA Voice] onspeechstart (voice detected)');
    };

    instance.onspeechend = () => {
      console.log('[MAIA Voice] onspeechend (voice utterance completed)');
    };

    instance.onaudioend = () => {
      console.log('[MAIA Voice] onaudioend (hardware capture closed)');
    };

    instance.onresult = (event: any) => {
      if (this.recognition !== instance) return;
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = 0; i < event.results.length; ++i) {
        const item = event.results[i];
        if (!item || !item[0]) continue;
        const text = item[0].transcript;
        if (item.isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + text.trim();
        } else {
          interimTranscript += (interimTranscript ? ' ' : '') + text.trim();
        }
      }

      // Preserve both final and interim tokens without dropping either
      const combined = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
      handlers.onResult?.(combined, Boolean(finalTranscript));
    };

    instance.onerror = (event: any) => {
      // Discard errors from old/detached instances
      if (this.recognition !== instance && this.cleanupInstance !== instance) return;

      console.warn('[MAIA Voice] onerror:', event.error);
      const errorMsg = this.formatErrorMessage(event.error);

      // Cancel any pending restart on error
      this.pendingStartHandlers = null;
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }

      // Completely teardown this instance and reset state to idle
      this.teardownInstance(instance);
      this.state = 'idle';

      if (errorMsg) {
        handlers.onError?.(errorMsg);
      }
    };

    instance.onend = () => {
      // Discard callbacks from old/detached instances
      const isCurrent = this.recognition === instance;
      const isCleaning = this.cleanupInstance === instance;
      if (!isCurrent && !isCleaning) return;

      console.log('[MAIA Voice] onend (session ended)');
      this.teardownInstance(instance);
      this.state = 'idle';

      handlers.onEnd?.();

      // Handle queued restart on a FRESH asynchronous event loop turn with a NEW instance
      const nextHandlers = this.pendingStartHandlers;
      this.pendingStartHandlers = null;

      if (nextHandlers) {
        if (this.restartTimer) {
          clearTimeout(this.restartTimer);
        }
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.state === 'idle') {
            this.start(nextHandlers);
          }
        }, 50);
      }
    };

    return instance;
  }

  setLanguage(lang: string) {
    this.currentLanguage = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  getLanguage(): string {
    return this.currentLanguage;
  }

  isSupported(): boolean {
    return Boolean(this.getSpeechRecognitionClass());
  }

  getState(): VoiceRecognitionState {
    return this.state;
  }

  isListening(): boolean {
    return this.state === 'listening';
  }

  isBusy(): boolean {
    return this.state !== 'idle';
  }

  getListeningState(): boolean {
    return this.state === 'listening';
  }

  start(handlers: SpeechRecognitionHandlers) {
    const SpeechRecognitionClass = this.getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) {
      handlers.onError?.('Il riconoscimento vocale Web Speech non è supportato in questo browser o ambiente.');
      return;
    }

    // 1. Prevent duplicate start if already starting or listening
    if (this.state === 'starting' || this.state === 'listening') {
      return;
    }

    // 2. If stopping, queue restart cleanly for when previous instance terminates
    if (this.state === 'stopping') {
      this.pendingStartHandlers = handlers;
      return;
    }

    // 3. Clear any pending restart timer
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // 4. Force clean teardown of any previous instance before creating a fresh one
    if (this.recognition) {
      this.teardownInstance(this.recognition);
    }

    this.state = 'starting';
    this.pendingStartHandlers = null;

    try {
      const freshInstance = this.createRecognition(handlers);
      if (!freshInstance) {
        this.state = 'idle';
        handlers.onError?.('Impossibile inizializzare il motore vocale.');
        return;
      }

      this.recognition = freshInstance;
      freshInstance.start();
    } catch (err: any) {
      if (this.recognition) {
        this.teardownInstance(this.recognition);
      }
      this.state = 'idle';
      this.pendingStartHandlers = null;
      const msg = err?.message || String(err);
      handlers.onError?.(`Impossibile avviare il microfono: ${msg}`);
    }
  }

  stop() {
    this.pendingStartHandlers = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.state === 'idle' && !this.recognition) {
      return;
    }

    const currentInst = this.recognition;
    this.state = 'stopping';

    if (currentInst) {
      this.cleanupInstance = currentInst;
      this.recognition = null;

      try {
        if (typeof currentInst.abort === 'function') {
          currentInst.abort();
        } else if (typeof currentInst.stop === 'function') {
          currentInst.stop();
        }
      } catch (err) {
        this.teardownInstance(currentInst);
        this.state = 'idle';
      }
    } else {
      this.state = 'idle';
    }
  }
}

export const voiceManager = new VoiceRecognitionManager();

// Text-to-Speech (Synthesis)
export function speakText(
  text: string,
  options: { rate?: number; pitch?: number } = {},
  onStart?: () => void,
  onEnd?: () => void
): SpeechSynthesisUtterance | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return null;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Strip markdown symbols for natural speech
  const cleanText = text
    .replace(/```[\s\S]*?```/g, 'Code block omitted.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();

  if (!cleanText) return null;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = options.rate ?? 1.05;
  utterance.pitch = options.pitch ?? 1.0;

  // Attempt to select an articulate voice
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(
    (v) =>
      v.lang.startsWith('en') &&
      (v.name.toLowerCase().includes('natural') ||
        v.name.toLowerCase().includes('google') ||
        v.name.toLowerCase().includes('samantha') ||
        v.name.toLowerCase().includes('karen') ||
        v.name.toLowerCase().includes('female'))
  ) || voices.find((v) => v.lang.startsWith('en')) || voices[0];

  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  utterance.onstart = () => {
    onStart?.();
  };

  utterance.onend = () => {
    onEnd?.();
  };

  utterance.onerror = () => {
    onEnd?.();
  };

  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
