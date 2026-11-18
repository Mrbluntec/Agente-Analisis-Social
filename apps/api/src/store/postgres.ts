import pg from 'pg';
import type { AgentRun, Citation, Conversation, RunAttachment, ToolCall } from '../../../../packages/core/src/types';
import type { AgentStore } from './types';

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

/** Persistencia en las tablas agent_conversations, agent_runs, agent_tool_calls y agent_citations. */
export class PostgresAgentStore implements AgentStore {
  readonly kind = 'postgres' as const;
  readonly pool: pg.Pool;
  /** Las escrituras de una misma ejecución se encadenan para que no se adelanten entre sí. */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async saveConversation(c: Conversation) {
    await this.pool.query(
      `INSERT INTO agent_conversations (id, brand_id, title, mode, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.brand_id, c.title, c.mode, c.created_at],
    );
  }

  saveRun(run: AgentRun, brandId: string): Promise<void> {
    // Se copia ahora: el objeto sigue cambiando mientras la escritura espera turno.
    const snapshot: AgentRun = structuredClone(run);
    const previous = this.chains.get(run.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.writeRun(snapshot, brandId));
    this.chains.set(run.id, next);
    void next.finally(() => {
      if (this.chains.get(run.id) === next) this.chains.delete(run.id);
    }).catch(() => {});
    return next;
  }

  private async writeRun(run: AgentRun, brandId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO agent_runs (id, brand_id, conversation_id, mode, status, key_scope, model, think, question, thinking, answer,
                                 queued_at, started_at, finished_at, prompt_tokens, completion_tokens, error, attachments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, thinking = EXCLUDED.thinking, answer = EXCLUDED.answer,
           started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, prompt_tokens = EXCLUDED.prompt_tokens,
           completion_tokens = EXCLUDED.completion_tokens, error = EXCLUDED.error, attachments = EXCLUDED.attachments`,
        [
          run.id, brandId, run.conversation_id ?? null, run.mode, run.status, run.key_scope ?? null, run.model, run.think ?? null,
          run.question, run.thinking ?? null, run.answer ?? null, run.queued_at, run.started_at ?? null,
          // La tabla exige started_at si hay finished_at (una cancelada en cola nunca empezó).
          run.finished_at && !run.started_at ? null : run.finished_at ?? null,
          run.prompt_tokens ?? null, run.completion_tokens ?? null, run.error ?? null, JSON.stringify(run.attachments ?? []),
        ],
      );
      for (const t of run.tool_calls ?? []) {
        await client.query(
          `INSERT INTO agent_tool_calls (run_id, seq, tool, arguments, result_summary, duration_ms) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (run_id, seq) DO UPDATE SET result_summary = EXCLUDED.result_summary, duration_ms = EXCLUDED.duration_ms`,
          [run.id, t.seq, t.tool, JSON.stringify(t.arguments ?? {}), t.result_summary ?? null, t.duration_ms ?? null],
        );
      }
      for (const c of run.citations ?? []) {
        await client.query(
          `INSERT INTO agent_citations (run_id, ref, label, tool, query) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (run_id, ref) DO NOTHING`,
          [run.id, c.ref, c.label, c.tool, JSON.stringify(c.query ?? {})],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listConversations(brandId: string) {
    const { rows } = await this.pool.query(
      'SELECT id, brand_id, title, mode, created_at FROM agent_conversations WHERE brand_id = $1 ORDER BY created_at DESC',
      [brandId],
    );
    return rows.map(toConversation);
  }

  async getConversation(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query('SELECT id, brand_id, title, mode, created_at FROM agent_conversations WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    const runs = await this.loadRuns('conversation_id = $1', [id]);
    return { conversation: toConversation(rows[0]), runs };
  }

  async getRun(id: string) {
    if (!isUuid(id)) return null;
    return (await this.loadRuns('id = $1', [id]))[0] ?? null;
  }

  async recoverInterrupted() {
    const { rowCount } = await this.pool.query(
      `UPDATE agent_runs SET status = 'failed', error = 'El servidor se reinició durante la ejecución.',
         finished_at = CASE WHEN started_at IS NULL THEN NULL ELSE now() END
       WHERE status IN ('queued', 'running')`,
    );
    return rowCount ?? 0;
  }

  async close() {
    await Promise.allSettled([...this.chains.values()]);
    await this.pool.end();
  }

  private async loadRuns(where: string, params: unknown[]): Promise<AgentRun[]> {
    const { rows } = await this.pool.query(`SELECT * FROM agent_runs WHERE ${where} ORDER BY queued_at, id`, params);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as string);
    const [tools, cites] = await Promise.all([
      this.pool.query('SELECT * FROM agent_tool_calls WHERE run_id = ANY($1) ORDER BY seq', [ids]),
      this.pool.query('SELECT * FROM agent_citations WHERE run_id = ANY($1) ORDER BY ref', [ids]),
    ]);
    return rows.map((r): AgentRun => ({
      id: r.id,
      conversation_id: r.conversation_id,
      mode: r.mode,
      status: r.status,
      model: r.model,
      think: r.think,
      key_scope: r.key_scope ?? undefined,
      question: r.question,
      thinking: r.thinking,
      answer: r.answer,
      tool_calls: tools.rows.filter((t) => t.run_id === r.id).map((t): ToolCall => ({
        seq: t.seq, tool: t.tool, arguments: t.arguments, result_summary: t.result_summary, duration_ms: t.duration_ms,
      })),
      citations: cites.rows.filter((c) => c.run_id === r.id).map((c): Citation => ({ ref: c.ref, label: c.label, tool: c.tool, query: c.query })),
      attachments: (r.attachments ?? []) as RunAttachment[],
      queued_at: iso(r.queued_at)!,
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at) ?? (r.status === 'cancelled' || r.status === 'failed' ? iso(r.queued_at) : null),
      error: r.error,
      ...(r.prompt_tokens !== null ? { prompt_tokens: r.prompt_tokens } : {}),
      ...(r.completion_tokens !== null ? { completion_tokens: r.completion_tokens } : {}),
    }));
  }
}

function toConversation(r: Record<string, unknown>): Conversation {
  return { id: r.id as string, brand_id: r.brand_id as string, title: r.title as string, mode: r.mode as Conversation['mode'], created_at: iso(r.created_at as Date)! };
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
