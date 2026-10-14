import {
  addProjectNote,
  createProject,
  deleteProject,
  loadProjects,
  MAIA_PROJECTS_STORAGE_KEY,
  ProjectStorage,
  updateProject,
} from './src/services/projects/projectManager';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL test_project_manager: ${message}`);
}

class MemoryStorage implements ProjectStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  seed(key: string, value: string): void { this.values.set(key, value); }
}

class FailingWriteStorage extends MemoryStorage {
  setItem(_key: string, _value: string): void { throw new Error('simulated storage write failure'); }
}

function runTests(): void {
  const storage = new MemoryStorage();
  storage.seed('maia_user_memory_v1', JSON.stringify({ projects: ['legacy project'], preferences: ['direct'] }));

  const created = createProject({ name: 'MAIA', objective: 'Sviluppare l’assistente', context: 'V7.1' }, storage, new Date('2026-10-12T10:00:00.000Z'));
  assert(created !== null, 'creates a project with objective and context');
  assert(created.name === 'MAIA' && created.status === 'active', 'initial project fields are normalized');
  assert(loadProjects(storage).length === 1, 'created project persists');
  assert(storage.getItem('maia_user_memory_v1')?.includes('legacy project'), 'does not mutate legacy personal memory');
  assert(storage.getItem(MAIA_PROJECTS_STORAGE_KEY) !== null, 'uses the dedicated project storage key');
  assert(createProject({ name: 'maia' }, storage) === null, 'prevents duplicate project names ignoring case');
  assert(createProject({ name: '   ' }, storage) === null, 'rejects empty project names');

  const withNote = addProjectNote(created.id, 'Verificare i test di regressione', storage, new Date('2026-10-12T10:01:00.000Z'));
  assert(withNote?.notes.length === 1, 'adds a note to the selected project');
  assert(withNote?.notes[0].text === 'Verificare i test di regressione', 'trims project note text');

  const updated = updateProject(created.id, { status: 'paused', context: 'Test manuali da completare' }, storage, new Date('2026-10-12T10:02:00.000Z'));
  assert(updated?.status === 'paused' && updated.context === 'Test manuali da completare', 'updates status and context');
  assert(updated?.notes.length === 1, 'preserves notes when updating project metadata');
  assert(updateProject('missing-project', { name: 'Missing' }, storage) === null, 'does not create a project when updating a missing ID');
  assert(updateProject(created.id, { status: 'invalid' as any }, storage) === null, 'rejects invalid runtime status values');
  assert(deleteProject('missing-project', storage) === false, 'does not report success when deleting a missing ID');
  assert(deleteProject(created.id, storage), 'deletes an existing project');
  assert(loadProjects(storage).length === 0, 'deletion persists');

  const corrupted = new MemoryStorage();
  corrupted.seed(MAIA_PROJECTS_STORAGE_KEY, '{invalid-json');
  assert(loadProjects(corrupted).length === 0, 'handles corrupted project storage without throwing');
  assert(corrupted.getItem(MAIA_PROJECTS_STORAGE_KEY) === '{invalid-json', 'does not overwrite corrupted data during a read');

  const failingStorage = new FailingWriteStorage();
  assert(createProject({ name: 'Cannot persist' }, failingStorage) === null, 'does not report project creation when storage write fails');
  console.log('PASS test_project_manager: all assertions passed');
}

runTests();
