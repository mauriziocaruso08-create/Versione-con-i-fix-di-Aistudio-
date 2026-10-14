import React, { useEffect, useState } from 'react';
import { AppSettings, ToneSetting, UserMemory, MaiaNote, MaiaReminder } from '../types';
import { formatFriendlyDueTime } from '../utils/reminderManager';
import { addProjectNote, createProject, deleteProject, loadProjects, MaiaProject, updateProject } from '../services/projects/projectManager';
import {
  X,
  Volume2,
  Sliders,
  Bell,
  RefreshCw,
  Cpu,
  Brain,
  Plus,
  Trash2,
  Edit2,
  Check,
  User,
  MapPin,
  Tag,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Circle,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'generali' | 'voce' | 'note' | 'promemoria' | 'memoria' | 'progetti' | 'info';
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onClearHistory: () => void;
  systemInfo: {
    status: string;
    model: string;
    liveEngine: string;
    hasApiKey: boolean;
    modelRouter?: {
      mode?: string;
      selectedProvider?: string;
      providerDisplayName?: string;
      configured?: boolean;
      providerManager?: { registered?: string[]; configured?: string[]; automaticOrder?: string[] };
      budget?: { totalRequests?: number; globalDailyLimit?: number; providerRequests?: Record<string, number>; providerDailyLimits?: Record<string, number> };
    };
  } | null;
  memory: UserMemory;
  onUpdateMemory: (newMemory: Partial<UserMemory>) => void;
  onClearMemory: () => void;
  notes?: MaiaNote[];
  onDeleteNote?: (id: string) => void;
  reminders?: MaiaReminder[];
  onDeleteReminder?: (id: string) => void;
  onToggleCompleteReminder?: (id: string) => void;
  notificationPermission?: NotificationPermission | 'unsupported';
  onRequestNotificationPermission?: () => void;
}

type MemoryCategory = 'preferences' | 'interests' | 'projects' | 'personalNotes' | 'personalFacts' | 'notes' | 'reminders';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'generali',
  settings,
  onUpdateSettings,
  onClearHistory,
  systemInfo,
  memory,
  onUpdateMemory,
  onClearMemory,
  notes = [],
  onDeleteNote,
  reminders = [],
  onDeleteReminder,
  onToggleCompleteReminder,
  notificationPermission = 'default',
  onRequestNotificationPermission,
}) => {
  // Keep all hooks unconditional; the shortcut-selected tab is synchronized
  // every time the sheet is opened or the requested section changes.
  const [activeCategory, setActiveCategory] = useState<MemoryCategory>(
    initialTab === 'note' ? 'notes' : initialTab === 'promemoria' ? 'reminders' : initialTab === 'progetti' ? 'projects' : initialTab === 'memoria' ? 'personalNotes' : 'preferences'
  );
  useEffect(() => {
    if (!isOpen) return;
    if (initialTab === 'note') setActiveCategory('notes');
    else if (initialTab === 'promemoria') setActiveCategory('reminders');
    else if (initialTab === 'progetti') setActiveCategory('projects');
    else if (initialTab === 'memoria') setActiveCategory('personalNotes');
    else setActiveCategory('preferences');
  }, [initialTab, isOpen]);
  const [newItemText, setNewItemText] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [projects, setProjects] = useState<MaiaProject[]>([]);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projectObjectiveInput, setProjectObjectiveInput] = useState('');
  const [projectContextInput, setProjectContextInput] = useState('');
  const [projectNoteInputs, setProjectNoteInputs] = useState<Record<string, string>>({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [editingProjectObjective, setEditingProjectObjective] = useState('');
  const [editingProjectContext, setEditingProjectContext] = useState('');

  const refreshProjects = () => setProjects(loadProjects());
  useEffect(() => {
    if (isOpen) refreshProjects();
  }, [isOpen, activeCategory]);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    const created = createProject({ name: projectNameInput, objective: projectObjectiveInput, context: projectContextInput });
    if (!created) return;
    refreshProjects();
    setProjectNameInput('');
    setProjectObjectiveInput('');
    setProjectContextInput('');
  };

  const handleBeginProjectEdit = (project: MaiaProject) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
    setEditingProjectObjective(project.objective);
    setEditingProjectContext(project.context);
  };

  const handleSaveProjectEdit = (projectId: string) => {
    const updated = updateProject(projectId, { name: editingProjectName, objective: editingProjectObjective, context: editingProjectContext });
    if (!updated) return;
    refreshProjects();
    setEditingProjectId(null);
  };

  const handleAddProjectNote = (e: React.FormEvent, projectId: string) => {
    e.preventDefault();
    const noteText = projectNoteInputs[projectId] || '';
    if (!addProjectNote(projectId, noteText)) return;
    refreshProjects();
    setProjectNoteInputs((current) => ({ ...current, [projectId]: '' }));
  };

  const handleDeleteProject = (projectId: string) => {
    if (!deleteProject(projectId)) return;
    refreshProjects();
    if (editingProjectId === projectId) setEditingProjectId(null);
  };

  // Editable user profile fields
  const [userNameInput, setUserNameInput] = useState(memory.userName || '');
  const [userCityInput, setUserCityInput] = useState(memory.userCity || '');

  useEffect(() => {
    setUserNameInput(memory.userName || '');
    setUserCityInput(memory.userCity || '');
  }, [memory.userName, memory.userCity]);

  if (!isOpen) return null;

  const pendingRemindersCount = (reminders || []).filter((r) => !r.completed).length;

  const categories: Array<{ id: MemoryCategory; label: string; icon: string; count: number }> = [
    { id: 'preferences', label: 'Preferenze', icon: '⚙️', count: memory.preferences?.length || 0 },
    { id: 'interests', label: 'Interessi', icon: '💡', count: memory.interests?.length || 0 },
    { id: 'projects', label: 'Progetti', icon: '🚀', count: projects.length },
    { id: 'personalFacts', label: 'Informazioni personali', icon: '🧠', count: memory.personalFacts?.length || 0 },
    { id: 'personalNotes', label: 'Personali', icon: '📌', count: memory.notes?.length || 0 },
    { id: 'notes', label: 'Note', icon: '📝', count: (notes || []).length },
    { id: 'reminders', label: 'Promemoria', icon: '⏰', count: pendingRemindersCount },
  ];

  const totalMemoryItems =
    (memory.userName ? 1 : 0) +
    (memory.userCity ? 1 : 0) +
    (memory.preferences?.length || 0) +
    (memory.interests?.length || 0) +
    (memory.notes?.length || 0) +
    (memory.personalFacts?.length || 0);

  const getMemoryCategoryItems = (cat: MemoryCategory): string[] => {
    if (cat === 'notes' || cat === 'reminders' || cat === 'projects') return [];
    if (cat === 'personalNotes') return memory.notes || [];
    if (cat === 'personalFacts') return (memory.personalFacts || []).map((f) => f.rawText || `${f.key}: ${String(f.value)}`);
    return (memory[cat] as string[]) || [];
  };

  const currentCategoryItems = getMemoryCategoryItems(activeCategory);
  const handleSaveProfile = () => {
    onUpdateMemory({
      userName: userNameInput.trim(),
      userCity: userCityInput.trim(),
    });
  };

  // Add new item to current category
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeCategory === 'notes' || activeCategory === 'reminders' || activeCategory === 'personalFacts' || activeCategory === 'projects' || !newItemText.trim()) return;
    const storageCategory = activeCategory === 'personalNotes' ? 'notes' : activeCategory;
    const currentList = (memory[storageCategory] || []) as string[];
    onUpdateMemory({
      [storageCategory]: [...currentList, newItemText.trim()],
    });
    setNewItemText('');
  };

  // Start editing an item
  const handleStartEdit = (index: number, text: string) => {
    setEditingIndex(index);
    setEditingText(text);
  };

  // Save edited item
  const handleSaveEdit = (index: number) => {
    if (activeCategory === 'notes' || activeCategory === 'reminders' || activeCategory === 'personalFacts' || activeCategory === 'projects') return;
    if (!editingText.trim()) {
      handleDeleteItem(index);
      return;
    }
    const storageCategory = activeCategory === 'personalNotes' ? 'notes' : activeCategory;
    const currentList = [...((memory[storageCategory] || []) as string[])];
    currentList[index] = editingText.trim();
    onUpdateMemory({
      [storageCategory]: currentList,
    });
    setEditingIndex(null);
    setEditingText('');
  };

  // Delete a single item
  const handleDeleteItem = (index: number) => {
    if (activeCategory === 'notes' || activeCategory === 'reminders' || activeCategory === 'personalFacts' || activeCategory === 'projects') return;
    const storageCategory = activeCategory === 'personalNotes' ? 'notes' : activeCategory;
    const currentList = ((memory[storageCategory] || []) as string[]).filter((_, i) => i !== index);
    onUpdateMemory({
      [storageCategory]: currentList,
    });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingText('');
    }
  };

  const toneOptions: Array<{ id: ToneSetting; label: string; desc: string }> = [
    { id: 'balanced', label: 'Neutral', desc: 'No preset personality; adapts to the request and context' },
    { id: 'concise', label: 'Concise', desc: 'Direct, crisp, zero fluff' },
    { id: 'analytical', label: 'Analytical', desc: 'Deep technical rigor and structured breakdown' },
    { id: 'creative', label: 'Creative', desc: 'Inventive, expressive, and nuanced' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full sm:max-w-lg bg-[#080d1b] border-t sm:border border-cyan-500/25 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Android Sheet Drag Handle (Mobile) */}
        <div className="sm:hidden pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-cyan-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h2 id="settings-title" className="text-base font-semibold text-white">
              MAIA Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-6 text-sm">
          {/* Section: Memoria di MAIA */}
          <div className="bg-[#0b1226]/90 border border-cyan-500/20 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-sm text-white flex items-center gap-1.5">
                  🧠 Memoria di MAIA
                </h3>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-cyan-300">
                {totalMemoryItems} {totalMemoryItems === 1 ? 'ricordo' : 'ricordi'}
              </span>
            </div>

            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Informazioni persistenti salvate in locale sul tuo dispositivo. MAIA le usa come contesto a lungo termine, anche cancellando la cronologia chat.
            </p>

            {/* Profile fields: Nome e Città */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3.5">
              <div className="bg-[#070b16] border border-slate-800 rounded-xl px-2.5 py-1.5 flex items-center gap-2 focus-within:border-cyan-500/50">
                <User className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
                <input
                  type="text"
                  placeholder="Il tuo nome..."
                  value={userNameInput}
                  onChange={(e) => setUserNameInput(e.target.value)}
                  onBlur={handleSaveProfile}
                  className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
              <div className="bg-[#070b16] border border-slate-800 rounded-xl px-2.5 py-1.5 flex items-center gap-2 focus-within:border-cyan-500/50">
                <MapPin className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
                <input
                  type="text"
                  placeholder="Città / Luogo..."
                  value={userCityInput}
                  onChange={(e) => setUserCityInput(e.target.value)}
                  onBlur={handleSaveProfile}
                  className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Category tabs */}
            <div className="grid grid-cols-6 gap-1 p-1 bg-[#060a14] rounded-xl border border-slate-800/80 mb-3">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setEditingIndex(null);
                  }}
                  className={`py-1.5 px-0.5 rounded-lg text-center transition-all ${
                    activeCategory === cat.id
                      ? 'bg-cyan-950/70 border border-cyan-400/50 text-cyan-200 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="text-[11px] font-medium flex items-center justify-center gap-0.5 sm:gap-1">
                    <span>{cat.icon}</span>
                    <span className="hidden sm:inline">{cat.label}</span>
                  </div>
                  <div className="text-[10px] font-mono text-cyan-400/70 mt-0.5">
                    {cat.count}
                  </div>
                </button>
              ))}
            </div>

            {/* Category Items List */}
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5 mb-3">
              {activeCategory === 'projects' ? (
                projects.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-xl bg-[#060a14]/40">
                    Nessun progetto creato. Crea un progetto con obiettivo, contesto e note dedicate.
                  </div>
                ) : projects.map((project) => (
                  <div key={project.id} className="bg-[#060a14] border border-slate-800/90 rounded-xl px-3 py-3 space-y-2">
                    {editingProjectId === project.id ? (
                      <div className="space-y-2">
                        <input value={editingProjectName} onChange={(e) => setEditingProjectName(e.target.value)} aria-label="Nome progetto" placeholder="Nome progetto" className="w-full bg-slate-900 border border-cyan-500/40 rounded-lg px-2.5 py-2 text-xs text-white" />
                        <input value={editingProjectObjective} onChange={(e) => setEditingProjectObjective(e.target.value)} aria-label="Obiettivo progetto" placeholder="Obiettivo" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white" />
                        <textarea value={editingProjectContext} onChange={(e) => setEditingProjectContext(e.target.value)} aria-label="Contesto progetto" placeholder="Contesto" rows={2} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white resize-y" />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingProjectId(null)} className="px-2 py-1 text-xs text-slate-400">Annulla</button>
                          <button type="button" onClick={() => handleSaveProjectEdit(project.id)} className="px-2 py-1 rounded-lg bg-cyan-600/30 border border-cyan-400/40 text-xs text-cyan-200">Salva</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-cyan-200 break-words">{project.name}</div>
                            {project.objective && <div className="text-xs text-slate-300 mt-1 break-words">{project.objective}</div>}
                            {project.context && <div className="text-[11px] text-slate-500 mt-1 break-words">{project.context}</div>}
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => handleBeginProjectEdit(project)} className="p-1 text-slate-400 hover:text-cyan-400" aria-label={`Modifica ${project.name}`}><Edit2 className="w-3 h-3" /></button>
                            <button type="button" onClick={() => handleDeleteProject(project.id)} className="p-1 text-slate-400 hover:text-rose-400" aria-label={`Elimina ${project.name}`}><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-500">{project.notes.length} {project.notes.length === 1 ? 'nota' : 'note'}</span>
                          <select aria-label={`Stato ${project.name}`} value={project.status} onChange={(e) => { if (updateProject(project.id, { status: e.target.value as 'active' | 'paused' | 'completed' })) refreshProjects(); }} className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                            <option value="active">Attivo</option><option value="paused">In pausa</option><option value="completed">Completato</option>
                          </select>
                        </div>
                        {project.notes.map((note) => <div key={note.id} className="border-l-2 border-violet-500/40 pl-2 text-[11px] text-slate-400 break-words">{note.text}</div>)}
                        <form onSubmit={(e) => handleAddProjectNote(e, project.id)} className="flex gap-1.5 pt-1">
                          <input value={projectNoteInputs[project.id] || ''} onChange={(e) => setProjectNoteInputs((current) => ({ ...current, [project.id]: e.target.value }))} placeholder="Aggiungi una nota al progetto..." aria-label={`Nuova nota per ${project.name}`} className="min-w-0 flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-500" />
                          <button type="submit" disabled={!(projectNoteInputs[project.id] || '').trim()} className="px-2 rounded-lg bg-violet-600/20 border border-violet-400/30 text-violet-200 disabled:opacity-40" aria-label="Aggiungi nota"><Plus className="w-3 h-3" /></button>
                        </form>
                      </>
                    )}
                  </div>
                ))
              ) : activeCategory === 'personalNotes' ? (
                currentCategoryItems.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-xl bg-[#060a14]/40">
                    Nessuna nota personale salvata. Puoi dire a MAIA <span className="text-slate-400 italic">"Ricordati che..."</span>.
                  </div>
                ) : (
                  currentCategoryItems.map((item, index) => (
                    <div key={`${item}-${index}`} className="group bg-[#060a14] border border-slate-800/90 hover:border-cyan-500/30 rounded-xl px-3 py-2 flex items-center justify-between gap-2 transition-colors">
                      {editingIndex === index ? (
                        <div className="flex-1 flex items-center gap-1.5">
                          <input value={editingText} onChange={(e) => setEditingText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(index); if (e.key === 'Escape') { setEditingIndex(null); setEditingText(''); } }} autoFocus className="flex-1 bg-slate-900 border border-cyan-500/60 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                          <button type="button" onClick={() => handleSaveEdit(index)} className="p-1 text-cyan-400 hover:text-white rounded" aria-label="Salva"><Check className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => { setEditingIndex(null); setEditingText(''); }} className="p-1 text-slate-500 hover:text-slate-300 rounded" aria-label="Annulla"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-slate-200 break-words flex-1 leading-snug">{item}</span>
                          <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => handleStartEdit(index, item)} className="p-1 text-slate-400 hover:text-cyan-400 rounded" aria-label="Modifica"><Edit2 className="w-3 h-3" /></button>
                            <button type="button" onClick={() => handleDeleteItem(index)} className="p-1 text-slate-400 hover:text-rose-400 rounded" aria-label="Elimina"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )
              ) : activeCategory === 'reminders' ? (
                <div>
                  {/* Notification permission prompt banner */}
                  {notificationPermission === 'granted' ? (
                    <div className="mb-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-emerald-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Notifiche attive sul browser</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                        Attivo
                      </span>
                    </div>
                  ) : notificationPermission === 'denied' ? (
                    <div className="mb-2 p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-[11px] text-rose-200 leading-snug">
                        <span className="font-semibold block text-rose-300">Notifiche bloccate nelle impostazioni di Chrome</span>
                        <span className="text-[10px] text-rose-300/80 block mt-0.5">
                          Tocca l'icona del lucchetto/impostazioni nella barra dell'indirizzo di Chrome e imposta le Notifiche su "Consenti".
                        </span>
                      </div>
                    </div>
                  ) : notificationPermission === 'unsupported' ? (
                    <div className="mb-2 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-2">
                      <Bell className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="text-[11px] text-slate-400">
                        Notifiche non supportate su questo browser
                      </span>
                    </div>
                  ) : (
                    <div className="mb-2 p-2 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-cyan-200 flex items-center gap-2">
                        <Bell className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Abilita notifiche browser</span>
                      </div>
                      <button
                        type="button"
                        onClick={onRequestNotificationPermission}
                        className="min-h-[44px] min-w-[72px] px-3 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-[#070b16] font-bold text-xs flex items-center justify-center transition-all cursor-pointer shadow-sm"
                      >
                        Attiva
                      </button>
                    </div>
                  )}

                  {(!reminders || reminders.length === 0) ? (
                    <div className="text-center py-4 text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-xl bg-[#060a14]/40">
                      Nessun promemoria salvato. Puoi crearne uno in chat dicendo <span className="text-slate-400 italic">"Ricordami di... tra 10 minuti"</span>.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {reminders.map((rem) => {
                        const isExpired = !rem.completed && new Date(rem.dueAt).getTime() <= Date.now();
                        return (
                          <div
                            key={rem.id}
                            className={`group bg-[#060a14] border ${
                              rem.completed
                                ? 'border-slate-800/50 opacity-60'
                                : isExpired
                                ? 'border-amber-500/40'
                                : 'border-slate-800/90 hover:border-cyan-500/30'
                            } rounded-xl px-3 py-2 flex items-center justify-between gap-2 transition-colors`}
                          >
                            <button
                              type="button"
                              onClick={() => onToggleCompleteReminder?.(rem.id)}
                              className="text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
                              title={rem.completed ? 'Segna come non completato' : 'Segna come completato'}
                            >
                              {rem.completed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Circle className="w-4 h-4 text-slate-500 hover:text-cyan-400" />
                              )}
                            </button>

                            <div className="flex-1 min-w-0 pr-2">
                              <span
                                className={`text-xs break-words leading-snug block ${
                                  rem.completed ? 'line-through text-slate-400' : 'text-slate-200'
                                }`}
                              >
                                {rem.text}
                              </span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-cyan-400/80 flex items-center gap-1 font-mono">
                                  <Clock className="w-3 h-3" />
                                  {formatFriendlyDueTime(rem.dueAt)}
                                </span>
                                {rem.completed ? (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 font-medium">
                                    Fatto
                                  </span>
                                ) : isExpired ? (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 font-medium">
                                    In scadenza
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => onDeleteReminder?.(rem.id)}
                                className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors"
                                title="Elimina promemoria"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeCategory === 'notes' ? (
                (!notes || notes.length === 0) ? (
                  <div className="text-center py-4 text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-xl bg-[#060a14]/40">
                    Nessuna nota salvata. Puoi crearne una in chat dicendo <span className="text-slate-400 italic">"Annota che..."</span>.
                  </div>
                ) : (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className="group bg-[#060a14] border border-slate-800/90 hover:border-cyan-500/30 rounded-xl px-3 py-2 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        {note.title && (
                          <span className="text-xs font-semibold text-cyan-300 block mb-0.5">
                            {note.title}
                          </span>
                        )}
                        <span className="text-xs text-slate-200 break-words leading-snug block">
                          {note.text}
                        </span>
                        {note.createdAt && (
                          <span className="text-[10px] text-slate-500 mt-0.5 block font-mono">
                            {new Date(note.createdAt).toLocaleDateString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => onDeleteNote?.(note.id)}
                          className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors"
                          title="Elimina nota"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )
              ) : (!currentCategoryItems || currentCategoryItems.length === 0) ? (
                <div className="text-center py-4 text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-xl bg-[#060a14]/40">
                  Nessun elemento memorizzato in <span className="text-slate-400 capitalize">{activeCategory}</span>.
                </div>
              ) : (
                currentCategoryItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="group bg-[#060a14] border border-slate-800/90 hover:border-cyan-500/30 rounded-xl px-3 py-2 flex items-center justify-between gap-2 transition-colors"
                  >
                    {editingIndex === idx ? (
                      <div className="flex-1 flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(idx);
                            if (e.key === 'Escape') setEditingIndex(null);
                          }}
                          autoFocus
                          className="flex-1 bg-slate-900 border border-cyan-500/60 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(idx)}
                          className="p-1 text-cyan-400 hover:text-white rounded"
                          title="Salva modifica"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingIndex(null)}
                          className="p-1 text-slate-500 hover:text-slate-300 rounded"
                          title="Annulla"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-xs text-slate-200 break-words flex-1 leading-snug">
                          {item}
                        </span>
                        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(idx, item)}
                            className="p-1 text-slate-400 hover:text-cyan-400 rounded transition-colors"
                            title="Modifica"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(idx)}
                            className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors"
                            title="Elimina"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Add Item Input Form for persistent UserMemory categories */}
            {activeCategory === 'projects' ? (
              <form onSubmit={handleCreateProject} className="space-y-1.5">
                <input value={projectNameInput} onChange={(e) => setProjectNameInput(e.target.value)} placeholder="Nome progetto (obbligatorio)" aria-label="Nome nuovo progetto" className="w-full bg-[#060a14] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50" />
                <input value={projectObjectiveInput} onChange={(e) => setProjectObjectiveInput(e.target.value)} placeholder="Obiettivo (facoltativo)" aria-label="Obiettivo nuovo progetto" className="w-full bg-[#060a14] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50" />
                <textarea value={projectContextInput} onChange={(e) => setProjectContextInput(e.target.value)} placeholder="Contesto iniziale (facoltativo)" aria-label="Contesto nuovo progetto" rows={2} className="w-full bg-[#060a14] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 resize-y" />
                <button type="submit" disabled={!projectNameInput.trim()} className="w-full px-3 py-2 rounded-xl bg-violet-600/30 border border-violet-400/40 text-violet-100 hover:bg-violet-600/50 text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-3.5 h-3.5" /><span>Crea progetto</span></button>
              </form>
            ) : activeCategory !== 'notes' && activeCategory !== 'reminders' && activeCategory !== 'personalFacts' && (
              <form onSubmit={handleAddItem} className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder={activeCategory === 'personalNotes' ? 'Aggiungi una nota personale...' : `Aggiungi a ${activeCategory}...`}
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  className="flex-1 bg-[#060a14] border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  type="submit"
                  disabled={!newItemText.trim()}
                  className="px-3 py-1.5 rounded-xl bg-cyan-600/30 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-600/50 text-xs font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Aggiungi</span>
                </button>
              </form>
            )}

            {/* Clear All Memory button with confirmation */}
            <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between">
              {showClearConfirm ? (
                <div className="flex-1 flex items-center justify-between gap-2 p-2 bg-rose-950/30 border border-rose-500/40 rounded-xl">
                  <div className="flex items-center gap-1.5 text-[11px] text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Confermi di voler cancellare tutta la memoria?</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onClearMemory();
                        setUserNameInput('');
                        setUserCityInput('');
                        setShowClearConfirm(false);
                      }}
                      className="px-2 py-1 bg-rose-600 text-white rounded-lg text-[10px] font-semibold hover:bg-rose-500"
                    >
                      Sì, cancella
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(false)}
                      className="px-2 py-1 bg-slate-800 text-slate-300 rounded-lg text-[10px] hover:bg-slate-700"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={totalMemoryItems === 0}
                  className="text-[11px] text-rose-400/80 hover:text-rose-300 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Svuota tutta la memoria di MAIA</span>
                </button>
              )}
            </div>
          </div>

          {/* Tone Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-cyan-400/90 mb-2">
              Response Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              {toneOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onUpdateSettings({ tone: opt.id })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.tone === opt.id
                      ? 'bg-cyan-950/40 border-cyan-400/60 text-white shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                      : 'bg-[#0b1226] border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="font-medium text-xs text-cyan-200">{opt.label}</div>
                  <div className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-tight">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Voice Preferences */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-cyan-400/90 mb-2">
              Audio & Speech
            </label>
            <div className="space-y-3 bg-[#0b1226] border border-slate-800 rounded-xl p-3.5">
              {/* Auto speak toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="font-medium text-xs text-slate-200">Auto-Read Responses</div>
                    <div className="text-[11px] text-slate-400">MAIA vocalizes answers aloud</div>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.autoSpeak}
                  onClick={() => onUpdateSettings({ autoSpeak: !settings.autoSpeak })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 relative ${
                    settings.autoSpeak ? 'bg-cyan-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      settings.autoSpeak ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Sound effects toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div className="flex items-center gap-2.5">
                  <Bell className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="font-medium text-xs text-slate-200">Futuristic Audio Cues</div>
                    <div className="text-[11px] text-slate-400">Subtle acoustic feedback for mic & actions</div>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={settings.soundEffects}
                  onClick={() => onUpdateSettings({ soundEffects: !settings.soundEffects })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 relative ${
                    settings.soundEffects ? 'bg-cyan-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      settings.soundEffects ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Speech rate slider */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300">Speech Speed</span>
                  <span className="text-cyan-400 font-mono font-medium">
                    {settings.speechRate.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.4"
                  step="0.05"
                  value={settings.speechRate}
                  onChange={(e) => onUpdateSettings({ speechRate: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Engine Status */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-cyan-400/90 mb-2">
              System Core
            </label>
            <div className="bg-[#0b1226] border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" /> Model Architecture
                </span>
                <span className="font-mono text-cyan-300">
                  {systemInfo?.model || 'gemini-3.8-flash'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Active Engine</span>
                <span className="text-slate-200">
                  {systemInfo?.liveEngine || 'MAIA Neural Engine'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Platform</span>
                <span className="text-slate-200">Android Smartphone Touch PWA</span>
              </div>
            </div>
          </div>

          {/* Model Router / AI Budget — roadmap visibility layer */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-cyan-400/90 mb-2">
              AI Router & Budget
            </label>
            <div className="bg-[#0b1226] border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Modalità</span>
                <span className="text-cyan-300 font-mono">{systemInfo?.modelRouter?.mode || 'automatic'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Provider attivo</span>
                <span className="text-slate-200">{systemInfo?.modelRouter?.providerDisplayName || 'Non disponibile'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Configurato</span>
                <span className={systemInfo?.modelRouter?.configured ? 'text-emerald-300' : 'text-amber-300'}>
                  {systemInfo?.modelRouter?.configured ? 'Sì' : 'No'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-slate-400">Richieste oggi</span>
                <span className="font-mono text-slate-200">
                  {systemInfo?.modelRouter?.budget?.totalRequests ?? 0}
                  {systemInfo?.modelRouter?.budget?.globalDailyLimit ? ` / ${systemInfo.modelRouter.budget.globalDailyLimit}` : ' / ∞'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                MAIA controlla provider e limiti prima di usare un motore AI. In modalità automatica può passare al prossimo provider reale configurato se quello corrente non è disponibile.
              </div>
            </div>
          </div>

          {/* Reset / Clear Chat History (Separate from Memory) */}
          <div className="pt-2">
            <button
              onClick={() => {
                onClearHistory();
                onClose();
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-rose-500/30 text-rose-300 hover:bg-rose-950/30 hover:border-rose-500/50 flex items-center justify-center gap-2 text-xs font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset & Clear Chat History (La memoria resta intatta)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
