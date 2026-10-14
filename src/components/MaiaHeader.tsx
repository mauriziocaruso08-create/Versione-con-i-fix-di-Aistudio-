import React from 'react';
import { Volume2, VolumeX, Trash2, Settings, StickyNote, Bell, FolderKanban } from 'lucide-react';
import { AppSettings } from '../types';

interface MaiaHeaderProps {
  settings: AppSettings;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onOpenSettings: () => void;
  onOpenNotes: () => void;
  onOpenReminders: () => void;
  onOpenProjects: () => void;
  onClearChat: () => void;
  notesCount: number;
  remindersCount: number;
  projectsCount: number;
  isFramed?: boolean;
  onToggleFrame?: () => void;
  hasMessages?: boolean;
}

export const MaiaHeader: React.FC<MaiaHeaderProps> = ({
  settings,
  onUpdateSettings,
  onOpenSettings,
  onOpenNotes,
  onOpenReminders,
  onOpenProjects,
  onClearChat,
  notesCount,
  remindersCount,
  projectsCount,
}) => (
  <header className="w-full bg-slate-950/80 border-b border-slate-800/80 px-3 sm:px-5 py-2.5 flex items-center justify-between backdrop-blur-md z-20 shrink-0">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.35)] border border-indigo-400/40 shrink-0">
        <span className="font-mono font-extrabold text-white text-xs tracking-wider">M</span>
      </div>
      <div className="min-w-0">
        <h1 className="font-bold text-sm tracking-wide text-slate-100 flex items-center gap-1.5 font-mono">
          MAIA <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </h1>
        <p className="text-[10px] text-slate-400 hidden xs:block truncate">Assistente Neurale Personale V7</p>
      </div>
    </div>

    <div className="flex items-center gap-1 sm:gap-2 mx-2 overflow-x-auto no-scrollbar">
      <button onClick={onOpenNotes} title="Gestione Note" className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 text-[11px] text-slate-300 transition-colors cursor-pointer whitespace-nowrap">
        <StickyNote className="w-3.5 h-3.5 text-indigo-400" />
        <span className="hidden sm:inline">Note</span>
        <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px]">{notesCount}</span>
      </button>
      <button onClick={onOpenReminders} title="Gestione Promemoria" className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 text-[11px] text-slate-300 transition-colors cursor-pointer whitespace-nowrap">
        <Bell className="w-3.5 h-3.5 text-amber-400" />
        <span className="hidden sm:inline">Promemoria</span>
        <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px]">{remindersCount}</span>
      </button>
      <button onClick={onOpenProjects} title="Gestione Progetti" className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-violet-500/40 text-[11px] text-slate-300 transition-colors cursor-pointer whitespace-nowrap">
        <FolderKanban className="w-3.5 h-3.5 text-violet-400" />
        <span className="hidden sm:inline">Progetti</span>
        <span className="px-1 py-0.2 rounded bg-violet-500/20 text-violet-300 font-mono text-[10px]">{projectsCount}</span>
      </button>
    </div>

    <div className="flex items-center gap-1.5 text-slate-400 shrink-0">
      <button onClick={() => onUpdateSettings({ soundEffects: !settings.soundEffects, autoSpeak: !settings.autoSpeak })} title={settings.autoSpeak ? 'Disattiva voce e suoni' : 'Attiva voce e suoni'} className="p-1.5 rounded-lg hover:bg-slate-900 hover:text-slate-200 transition-colors cursor-pointer">
        {settings.autoSpeak ? <Volume2 className="w-4 h-4 text-indigo-400" /> : <VolumeX className="w-4 h-4" />}
      </button>
      <button onClick={onClearChat} title="Cancella cronologia chat" className="p-1.5 rounded-lg hover:bg-slate-900 hover:text-rose-400 transition-colors cursor-pointer">
        <Trash2 className="w-4 h-4" />
      </button>
      <button onClick={onOpenSettings} title="Impostazioni di MAIA" className="p-1.5 rounded-lg hover:bg-slate-900 hover:text-indigo-400 transition-colors cursor-pointer">
        <Settings className="w-4 h-4" />
      </button>
    </div>
  </header>
);
