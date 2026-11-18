import { MemoryAgentStore } from './memory';
import { PostgresAgentStore } from './postgres';
import type { AgentStore } from './types';

export type { AgentStore } from './types';
export { MemoryAgentStore, PostgresAgentStore };

/** PostgreSQL si hay DATABASE_URL; si no, memoria (el comportamiento de siempre). */
export function createAgentStore(databaseUrl = process.env.DATABASE_URL): AgentStore {
  return databaseUrl ? new PostgresAgentStore(databaseUrl) : new MemoryAgentStore();
}
