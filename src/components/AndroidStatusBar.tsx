import React, { useState, useEffect } from 'react';
import { Wifi, Signal, Battery, Sparkles } from 'lucide-react';
import { AssistantState } from '../types';

interface AndroidStatusBarProps { className?: string; state?: AssistantState; }

export const AndroidStatusBar: React.FC<AndroidStatusBarProps> = ({ className = '', state = 'idle' }) => {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);
  const status = state === 'listening' ? ['IN ASCOLTO','text-emerald-400 bg-emerald-500/10 border-emerald-500/30']
    : state === 'thinking' ? ['ELABORAZIONE NEURALE','text-violet-400 bg-violet-500/10 border-violet-500/30 animate-pulse']
    : state === 'speaking' ? ['VOCE ATTIVA','text-sky-400 bg-sky-500/10 border-sky-500/30']
    : ['CORE ATTIVO','text-indigo-300 bg-indigo-500/10 border-indigo-500/20'];
  return <div className={`w-full bg-slate-950/80 backdrop-blur-md border-b border-slate-800/60 px-4 py-1.5 flex items-center justify-between text-xs select-none z-30 text-slate-400 ${className}`}>
    <div className="flex items-center gap-2 font-mono font-medium text-slate-200"><span>{time || '10:00'}</span><span className="hidden sm:inline text-[10px] text-slate-500">CET</span></div>
    <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider border flex items-center gap-1.5 transition-all duration-300 ${status[1]}`}><Sparkles className="w-2.5 h-2.5" /><span>{status[0]}</span></div>
    <div className="flex items-center gap-2.5 text-slate-300"><span className="text-[10px] font-bold text-slate-400 font-mono tracking-tighter">5G</span><Signal className="w-3 h-3" /><Wifi className="w-3.5 h-3.5" /><div className="flex items-center gap-1"><span className="text-[10px] font-mono">98%</span><Battery className="w-4 h-4 text-emerald-400" /></div></div>
  </div>;
};
