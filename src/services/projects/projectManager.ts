/**
 * MAIA project workspace storage.
 *
 * This store is intentionally separate from `maia_user_memory_v1` and the
 * legacy `UserMemory.projects` string array. It provides a low-risk data layer
 * for the Projects roadmap slice without changing existing personal memory.
 */
export type MaiaProjectStatus = 'active' | 'paused' | 'completed';

export interface MaiaProjectNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface MaiaProject {
  id: string;
  name: string;
  objective: string;
  context: string;
  status: MaiaProjectStatus;
  notes: MaiaProjectNote[];
  createdAt: string;
  updatedAt: string;
}

export const MAIA_PROJECTS_STORAGE_KEY = 'maia_projects_v1';

export interface ProjectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): ProjectStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function makeId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to a local deterministic-format ID when crypto is unavailable.
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value: string): string {
  return value.trim();
}

function isProjectStatus(value: unknown): value is MaiaProjectStatus {
  return value === 'active' || value === 'paused' || value === 'completed';
}

function normalizeProject(value: unknown): MaiaProject | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MaiaProject>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
  if (typeof candidate.objective !== 'string' || typeof candidate.context !== 'string') return null;
  if (typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string') return null;
  const notes = Array.isArray(candidate.notes)
    ? candidate.notes.filter((note): note is MaiaProjectNote =>
        Boolean(note) && typeof note.id === 'string' && typeof note.text === 'string' && typeof note.createdAt === 'string'
      )
    : [];
  return {
    id: candidate.id,
    name: candidate.name,
    objective: candidate.objective,
    context: candidate.context,
    status: isProjectStatus(candidate.status) ? candidate.status : 'active',
    notes,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

export function loadProjects(storage: ProjectStorage | null = getDefaultStorage()): MaiaProject[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(MAIA_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeProject).filter((project): project is MaiaProject => project !== null);
  } catch {
    // A read failure must not crash MAIA or mutate/clear the stored value.
    return [];
  }
}

function persistProjects(projects: MaiaProject[], storage: ProjectStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(MAIA_PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    const saved = storage.getItem(MAIA_PROJECTS_STORAGE_KEY);
    // Verify the exact serialized state, not just the item count.
    return saved === JSON.stringify(projects);
  } catch {
    return false;
  }
}

export function createProject(
  input: { name: string; objective?: string; context?: string },
  storage: ProjectStorage | null = getDefaultStorage(),
  now = new Date(),
): MaiaProject | null {
  const name = cleanText(input.name || '');
  if (!name) return null;
  const projects = loadProjects(storage);
  if (projects.some((project) => project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return null;
  const timestamp = now.toISOString();
  const project: MaiaProject = {
    id: makeId('project'),
    name,
    objective: cleanText(input.objective || ''),
    context: cleanText(input.context || ''),
    status: 'active',
    notes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return persistProjects([...projects, project], storage) ? project : null;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<MaiaProject, 'name' | 'objective' | 'context' | 'status'>>,
  storage: ProjectStorage | null = getDefaultStorage(),
  now = new Date(),
): MaiaProject | null {
  const projects = loadProjects(storage);
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) return null;
  const current = projects[index];
  if (patch.status !== undefined && !isProjectStatus(patch.status)) return null;
  const name = patch.name === undefined ? current.name : cleanText(patch.name);
  if (!name) return null;
  if (projects.some((project) => project.id !== id && project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return null;
  const updated: MaiaProject = {
    ...current,
    name,
    objective: patch.objective === undefined ? current.objective : cleanText(patch.objective),
    context: patch.context === undefined ? current.context : cleanText(patch.context),
    status: patch.status === undefined ? current.status : patch.status,
    updatedAt: now.toISOString(),
  };
  const next = [...projects];
  next[index] = updated;
  return persistProjects(next, storage) ? updated : null;
}

export function addProjectNote(
  projectId: string,
  text: string,
  storage: ProjectStorage | null = getDefaultStorage(),
  now = new Date(),
): MaiaProject | null {
  const noteText = cleanText(text);
  if (!noteText) return null;
  const projects = loadProjects(storage);
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) return null;
  const current = projects[index];
  const updated: MaiaProject = {
    ...current,
    notes: [...current.notes, { id: makeId('project_note'), text: noteText, createdAt: now.toISOString() }],
    updatedAt: now.toISOString(),
  };
  const next = [...projects];
  next[index] = updated;
  return persistProjects(next, storage) ? updated : null;
}

export function deleteProject(id: string, storage: ProjectStorage | null = getDefaultStorage()): boolean {
  const projects = loadProjects(storage);
  if (!projects.some((project) => project.id === id)) return false;
  return persistProjects(projects.filter((project) => project.id !== id), storage);
}
