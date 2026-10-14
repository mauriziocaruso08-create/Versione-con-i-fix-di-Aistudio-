import { SemanticEntity } from '../../types/context';
import { MaiaCapability } from './types';
import { NoteCapability } from './noteCapability';
import { ReminderCapability } from './reminderCapability';
import { MemoryCapability } from './memoryCapability';
import { WebCapability } from './webCapability';
import { ProjectCapability } from './projectCapability';

export class CapabilityRegistry {
  private capabilities = new Map<SemanticEntity, MaiaCapability>();

  constructor() {
    this.register(new NoteCapability());
    this.register(new ReminderCapability());
    this.register(new MemoryCapability());
    this.register(new ProjectCapability());
    this.register(new WebCapability());
  }

  register(capability: MaiaCapability): void {
    this.capabilities.set(capability.entity, capability);
  }

  getCapability(entity: SemanticEntity): MaiaCapability | null {
    return this.capabilities.get(entity) || null;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
