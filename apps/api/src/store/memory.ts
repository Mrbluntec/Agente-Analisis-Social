import type { AgentRun, Conversation } from '../../../../packages/core/src/types';
import type { AgentStore } from './types';

/** El comportamiento de siempre: todo en memoria, se pierde al reiniciar. */
export class MemoryAgentStore implements AgentStore {
  readonly kind = 'memory' as const;
  private readonly conversations = new Map<string, { conversation: Conversation; runIds: string[] }>();
  private readonly runs = new Map<string, AgentRun>();

  async saveConversation(conversation: Conversation) {
    if (!this.conversations.has(conversation.id)) this.conversations.set(conversation.id, { conversation, runIds: [] });
  }

  async saveRun(run: AgentRun) {
    if (!this.runs.has(run.id)) this.conversations.get(run.conversation_id ?? '')?.runIds.push(run.id);
    this.runs.set(run.id, run);
  }

  async listConversations(brandId: string) {
    return [...this.conversations.values()]
      .map((c) => c.conversation)
      .filter((c) => c.brand_id === brandId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getConversation(id: string) {
    const record = this.conversations.get(id);
    if (!record) return null;
    return { conversation: record.conversation, runs: record.runIds.map((r) => this.runs.get(r)!) };
  }

  async getRun(id: string) {
    return this.runs.get(id) ?? null;
  }
}
