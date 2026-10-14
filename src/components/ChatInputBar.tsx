import React, { useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Sparkles, AlertCircle, X } from 'lucide-react';

interface ChatInputBarProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (textToSend?: string) => void;
  isListening: boolean;
  onToggleListening: () => void;
  isLoading: boolean;
  interimTranscript: string;
  onSelectPrompt: (prompt: string) => void;
  showSuggestions?: boolean;
  voiceError?: string | null;
  onClearVoiceError?: () => void;
}

const QUICK_PROMPTS = [
  '⚡ Plan my day & priorities',
  '💡 Brainstorm innovative concepts',
  '📝 Draft a crisp, professional email',
  '🔬 Explain quantum entanglement simply',
  '⚙️ Optimize this routine or code snippet',
];

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  input,
  setInput,
  onSend,
  isListening,
  onToggleListening,
  isLoading,
  interimTranscript,
  onSelectPrompt,
  showSuggestions = true,
  voiceError,
  onClearVoiceError,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
    }
  }, [input, interimTranscript]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((input.trim() || interimTranscript.trim()) && !isLoading) {
        onSend();
      }
    }
  };

  const hasContent = Boolean(input.trim() || interimTranscript.trim());

  return (
    <div className="relative shrink-0 border-t border-cyan-950/40 bg-[#060a14]/95 backdrop-blur-xl z-20 pb-safe">
      {/* Voice Error Notification Banner */}
      {voiceError && !isListening && (
        <div className="px-3.5 py-1.5 flex items-center justify-between bg-amber-950/50 border-b border-amber-500/30 text-xs text-amber-200 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 pr-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] leading-tight">{voiceError}</span>
          </div>
          {onClearVoiceError && (
            <button
              type="button"
              onClick={onClearVoiceError}
              className="p-1 text-amber-400/80 hover:text-amber-200 transition-colors shrink-0"
              title="Chiudi avviso"
              aria-label="Chiudi avviso errore microfono"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Quick Prompt Carousel (visible when requested or chat is fresh) */}
      {showSuggestions && !isListening && (
        <div className="px-3 pt-2 pb-1 overflow-x-auto no-scrollbar flex items-center gap-1.5 scroll-smooth">
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => onSelectPrompt(prompt.replace(/^[^\w]+/, '').trim())}
              className="whitespace-nowrap shrink-0 px-3 py-1 rounded-full bg-[#0a1124] hover:bg-[#101b38] border border-cyan-500/20 hover:border-cyan-400/40 text-xs text-slate-300 hover:text-cyan-200 transition-all active:scale-95 select-none"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Live Voice Recording Status Banner */}
      {isListening && (
        <div className="px-4 py-1.5 flex items-center justify-between bg-cyan-950/30 border-b border-cyan-500/20 text-xs text-cyan-300 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="font-medium">Listening to your voice...</span>
          </div>
          <span className="text-[10px] text-cyan-400/80">Tap mic to stop</span>
        </div>
      )}

      {/* Main Input Control Bar */}
      <div className="px-3 py-2 flex items-end gap-2 max-w-3xl mx-auto">
        {/* Voice Input Button */}
        <button
          type="button"
          onClick={onToggleListening}
          className={`min-w-[44px] min-h-[44px] w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 active:scale-90 ${
            isListening
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.4)] animate-pulse'
              : 'bg-[#091122] text-cyan-400 border border-cyan-500/30 hover:border-cyan-400/60 hover:bg-[#0f1b36] shadow-[0_0_10px_rgba(6,182,212,0.15)]'
          }`}
          title={isListening ? 'Stop listening' : 'Start voice input'}
          aria-label={isListening ? 'Stop microphone' : 'Start microphone'}
        >
          {isListening ? (
            <MicOff className="w-5 h-5 text-rose-400" />
          ) : (
            <Mic className="w-5 h-5 text-cyan-400" />
          )}
        </button>

        {/* Text Input Container */}
        <div className="flex-1 relative flex items-center bg-[#090f20] border border-cyan-500/25 focus-within:border-cyan-400/70 focus-within:shadow-[0_0_15px_rgba(6,182,212,0.2)] rounded-2xl px-3.5 py-1.5 transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={isListening && interimTranscript ? interimTranscript : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? 'Listening...' : 'Message MAIA...'}
            disabled={isLoading}
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none resize-none leading-relaxed py-1 max-h-[120px]"
          />
        </div>

        {/* Send Button */}
        <button
          type="button"
          onClick={() => onSend()}
          disabled={!hasContent || isLoading}
          className={`min-w-[44px] min-h-[44px] w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all ${
            hasContent && !isLoading
              ? 'bg-gradient-to-tr from-cyan-500 to-blue-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] active:scale-95 cursor-pointer'
              : 'bg-[#091122] text-slate-400 border border-slate-800 cursor-not-allowed opacity-50'
          }`}
          title="Send message to MAIA"
          aria-label="Send message"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </div>

      {/* Android Bottom Navigation Pill */}
      <div className="pt-0.5 pb-1 flex justify-center" aria-hidden="true">
        <div className="w-32 h-1 rounded-full bg-slate-700/80 hover:bg-slate-600 transition-colors" />
      </div>
    </div>
  );
};
