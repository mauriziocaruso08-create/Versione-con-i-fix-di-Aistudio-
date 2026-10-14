import { SemanticIntent, SessionContext, VerifiedActionResult } from '../../types/context';
import { createProject, loadProjects } from '../projects/projectManager';
import { MaiaCapability } from './types';

export class ProjectCapability implements MaiaCapability {
  readonly entity = 'PROJECT' as const;
  readonly supportedVerbs = ['CREATE', 'READ'] as const;

  canHandle(intent: SemanticIntent): boolean { return intent.entity === 'PROJECT'; }

  async execute(intent: SemanticIntent, _context: SessionContext): Promise<VerifiedActionResult> {
    if (intent.verb === 'CREATE') {
      const name = String(intent.parameters.projectName || '').trim();
      if (!name) return { status: 'AMBIGUOUS', entity: 'PROJECT', verb: 'CREATE', feedbackText: 'Come vuoi chiamare il progetto?', clarificationPrompt: 'Come vuoi chiamare il progetto?', dataAffected: false };
      const existing = loadProjects().find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existing) return { status: 'SUCCESS', entity: 'PROJECT', verb: 'CREATE', feedbackText: `Il progetto "${existing.name}" esiste già. Non ho creato un duplicato.`, dataAffected: false, affectedId: existing.id };
      const project = createProject({ name, objective: String(intent.parameters.projectObjective || '') });
      if (!project) return { status: 'FAILURE', entity: 'PROJECT', verb: 'CREATE', feedbackText: 'Non sono riuscita a salvare il progetto nell’archivio locale.', dataAffected: false };
      const verified = loadProjects().some((p) => p.id === project.id && p.name === name);
      return verified
        ? { status: 'SUCCESS', entity: 'PROJECT', verb: 'CREATE', feedbackText: `Progetto "${project.name}" creato e verificato nell’archivio locale.${project.objective ? ` Obiettivo: ${project.objective}.` : ''}`, dataAffected: true, affectedId: project.id }
        : { status: 'FAILURE', entity: 'PROJECT', verb: 'CREATE', feedbackText: 'Non posso confermare il salvataggio del progetto: verifica non riuscita.', dataAffected: false };
    }
    if (intent.verb === 'READ') {
      const projects = loadProjects();
      if (!projects.length) return { status: 'SUCCESS', entity: 'PROJECT', verb: 'READ', feedbackText: 'Non ci sono progetti salvati.', dataAffected: false, affectedCount: 0 };
      return { status: 'SUCCESS', entity: 'PROJECT', verb: 'READ', feedbackText: `Ecco i progetti salvati:
${projects.map((p, i) => `${i + 1}. ${p.name}${p.objective ? ` — Obiettivo: ${p.objective}` : ''} [${p.status}]`).join('\n')}`, dataAffected: false, affectedCount: projects.length };
    }
    return { status: 'UNSUPPORTED', entity: 'PROJECT', verb: intent.verb, feedbackText: 'Questa operazione sui progetti non è ancora disponibile dalla chat.', dataAffected: false };
  }
}
