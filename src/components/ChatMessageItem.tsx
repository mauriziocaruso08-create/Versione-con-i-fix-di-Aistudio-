import React from 'react';
import { Message } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Bot, User, Volume2, Sparkles } from 'lucide-react';

interface ChatMessageItemProps {
  message: Message;
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  onStopSpeak?: () => void;
  onRetry?: () => void;
  isLatestModelMessage?: boolean;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ message, isSpeaking, onSpeak, onStopSpeak }) => {
  const isUser = message.role === 'user';
  const handleSpeak = () => isSpeaking ? onStopSpeak?.() : onSpeak?.(message.content);
  return (
    <div className={`flex w-full mb-4 px-3 sm:px-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex gap-3 max-w-[92%] sm:max-w-[82%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className="flex-shrink-0 mt-0.5">
          {isUser ? <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 border border-indigo-400/40 flex items-center justify-center text-white shadow-md"><User className="w-4 h-4" /></div> : <div className="w-8 h-8 rounded-full bg-slate-900 border border-indigo-500/50 flex items-center justify-center text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.25)]"><Sparkles className="w-4 h-4" /></div>}
        </div>
        <div className="flex flex-col">
          <div className={`p-3.5 sm:p-4 rounded-2xl relative shadow-md transition-all ${isUser ? 'bg-indigo-600 text-white rounded-tr-xs' : 'bg-slate-900/90 text-slate-100 border border-slate-800/80 backdrop-blur-md rounded-tl-xs'}`}>
            <MarkdownRenderer content={message.content} />
          </div>
          <div className={`flex items-center gap-2 mt-1 px-1 text-[10px] text-slate-500 font-mono ${isUser ? 'justify-end' : 'justify-start'}`}>
            <span>{message.timestamp}</span>
            {!isUser && onSpeak && <button onClick={handleSpeak} title="Ascolta con sintesi vocale" className="hover:text-indigo-400 transition-colors p-0.5 rounded flex items-center gap-1"><Volume2 className="w-3 h-3" /><span>{isSpeaking ? 'Ferma' : 'Ascolta'}</span></button>}
            {!isUser && message.modelSource && <span className="text-[9px] px-1 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">{message.modelSource}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
