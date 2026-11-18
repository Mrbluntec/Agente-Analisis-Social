// Almacén de conversaciones y ejecuciones del agente. Dos implementaciones:
// en memoria (por defecto y en pruebas) y PostgreSQL (si hay DATABASE_URL).
// Los eventos en vivo del streaming no pasan por aquí: siguen en memoria.

import type { AgentRun, Conversation } from '../../../../packages/core/src/types';

export interface AgentStore {
  readonly kind: 'memory' | 'postgres';
  saveConversation(conversation: Conversation): Promise<void>;
  /** Inserta o actualiza la ejecución completa: estado, herramientas, citas y adjuntos. */
  saveRun(run: AgentRun, brandId: string): Promise<void>;
  listConversations(brandId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<{ conversation: Conversation; runs: AgentRun[] } | null>;
  getRun(id: string): Promise<AgentRun | null>;
  /** Ejecuciones que quedaron a medias al apagarse el servidor pasan a fallidas. */
  recoverInterrupted?(): Promise<number>;
  close?(): Promise<void>;
}
