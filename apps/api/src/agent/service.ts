// Servicio del agente: cola por clave, bucle de razonamiento con herramientas contra
// Ollama y registro de eventos para servirlos en streaming. El estado vive en memoria;
// pasará a la base de datos (agent_runs, agent_tool_calls, agent_citations) más adelante.

import { randomUUID } from 'node:crypto';
import { BRAND } from '../../../../packages/core/src/sample';
import type { AgentRun, Citation, Conversation } from '../../../../packages/core/src/types';
import type { KeyScope, KeyStore } from '../keys';
import { OllamaError, type ChatMessage, type Ollama, type OllamaModel, type ThinkValue, type ToolCall } from '../ollama';
import { systemPrompt } from './prompt';
import { TOOL_DEFINITIONS, runTool, type PriorResult } from './tools';

/** Carga del campo `data` de cada evento, con la forma `AgentEvent` del contrato. */
export type AgentEvent =
  | { type: 'run.queued'; position: number }
  | { type: 'run.started' | 'run.cancelled' }
  | { type: 'thinking.delta' | 'answer.delta'; text: string }
  | { type: 'tool.call'; seq: number; tool: string; arguments: Record<string, unknown> }
  | { type: 'tool.result'; seq: number; summary: string; duration_ms: number }
  | { type: 'citation'; citation: Citation }
  | { type: 'run.completed'; run: AgentRun }
  | { type: 'run.failed'; error: string; code: string };

export interface StoredEvent {
  id: number;
  event: AgentEvent;
}

const TERMINAL: AgentEvent['type'][] = ['run.completed', 'run.failed', 'run.cancelled'];
const isTerminal = (e: AgentEvent) => TERMINAL.includes(e.type);

interface RunRecord {
  run: AgentRun;
  brandId: string;
  keyScope: KeyScope;
  events: StoredEvent[];
  listeners: Set<(e: StoredEvent) => void>;
  abort: AbortController;
}

interface ConversationRecord {
  conversation: Conversation;
  runIds: string[];
}

export interface NewMessage {
  question: string;
  model?: string;
  think?: string;
}

export class NoKeyError extends Error {}
export class ModelNotAllowedError extends Error {}

export interface AgentOptions {
  /** Capacidades que un modelo debe declarar para aparecer en la lista y poder usarse. */
  requiredCapabilities: string[];
  /** Vueltas máximas de herramientas antes de forzar la respuesta. */
  maxToolRounds?: number;
  modelCacheMs?: number;
}

export class AgentService {
  private readonly runs = new Map<string, RunRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly active: Record<KeyScope, number> = { org: 0, user: 0 };
  private readonly waiting: Record<KeyScope, RunRecord[]> = { org: [], user: [] };
  private models: { at: number; items: OllamaModel[] } | null = null;

  constructor(private readonly ollama: Ollama, private readonly keys: KeyStore, private readonly options: AgentOptions) {}

  // ----- Modelos -----

  /** Modelos de Ollama que cumplen las capacidades exigidas. Se descubren, no se listan a mano. */
  async listModels(): Promise<OllamaModel[]> {
    const ttl = this.options.modelCacheMs ?? 10 * 60_000;
    if (this.models && Date.now() - this.models.at < ttl) return this.models.items;
    const names = await this.ollama.listModels();
    const shown = await Promise.allSettled(names.map((n) => this.ollama.showModel(n)));
    const items = shown
      .filter((r): r is PromiseFulfilledResult<OllamaModel> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((m) => this.options.requiredCapabilities.every((c) => m.capabilities.includes(c)))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.models = { at: Date.now(), items };
    return items;
  }

  // ----- Conversaciones y ejecuciones -----

  listConversations(brandId: string): Conversation[] {
    return [...this.conversations.values()]
      .filter((c) => c.conversation.brand_id === brandId)
      .map((c) => c.conversation)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  getConversation(id: string) {
    const record = this.conversations.get(id);
    if (!record) return null;
    return { conversation: record.conversation, runs: record.runIds.map((r) => this.runs.get(r)!.run) };
  }

  getRun(id: string): AgentRun | null {
    return this.runs.get(id)?.run ?? null;
  }

  async start(brandId: string, conversationId: string | null, message: NewMessage): Promise<{ conversation: Conversation; run: AgentRun }> {
    const key = this.keys.active();
    if (!key) throw new NoKeyError();

    const models = await this.listModels();
    const model = message.model ? models.find((m) => m.name === message.model) : models[0];
    if (!model) throw new ModelNotAllowedError(message.model ?? '');

    let conv = conversationId ? this.conversations.get(conversationId) : undefined;
    if (!conv) {
      const title = message.question.length > 60 ? `${message.question.slice(0, 57)}…` : message.question;
      conv = { conversation: { id: randomUUID(), brand_id: brandId, title, mode: 'analyst', created_at: new Date().toISOString() }, runIds: [] };
      this.conversations.set(conv.conversation.id, conv);
    }

    const record: RunRecord = {
      brandId,
      keyScope: key.scope,
      events: [],
      listeners: new Set(),
      abort: new AbortController(),
      run: {
        id: randomUUID(),
        conversation_id: conv.conversation.id,
        mode: 'analyst',
        status: 'queued',
        model: model.name,
        think: resolveThink(model, message.think),
        key_scope: key.scope,
        question: message.question,
        thinking: null,
        answer: null,
        tool_calls: [],
        citations: [],
        attachments: [],
        queued_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        error: null,
      },
    };
    this.runs.set(record.run.id, record);
    conv.runIds.push(record.run.id);

    this.waiting[key.scope].push(record);
    this.emit(record, { type: 'run.queued', position: this.waiting[key.scope].length - 1 });
    this.pump(key.scope);
    return { conversation: conv.conversation, run: record.run };
  }

  cancel(id: string): 'cancelled' | 'finished' | 'missing' {
    const record = this.runs.get(id);
    if (!record) return 'missing';
    if (record.run.status !== 'queued' && record.run.status !== 'running') return 'finished';
    const wasQueued = record.run.status === 'queued';
    record.run.status = 'cancelled';
    record.run.finished_at = new Date().toISOString();
    record.abort.abort();
    if (wasQueued) {
      this.waiting[record.keyScope] = this.waiting[record.keyScope].filter((r) => r !== record);
      this.emit(record, { type: 'run.cancelled' });
    }
    return 'cancelled';
  }

  queue() {
    const key = this.keys.active();
    if (!key) return null;
    const item = (r: RunRecord) => ({ run_id: r.run.id, mode: r.run.mode, brand_name: r.brandId === BRAND.id ? BRAND.name : r.brandId, queued_at: r.run.queued_at });
    const running = [...this.runs.values()].filter((r) => r.keyScope === key.scope && r.run.status === 'running');
    return { key_scope: key.scope, max_concurrency: key.max_concurrency, running: running.map(item), queued: this.waiting[key.scope].map(item) };
  }

  /** Reproduce los eventos posteriores a `afterId` y sigue entregando los nuevos. */
  subscribe(id: string, afterId: number, onEvent: (e: StoredEvent) => void): (() => void) | null {
    const record = this.runs.get(id);
    if (!record) return null;
    record.events.filter((e) => e.id > afterId).forEach(onEvent);
    if (record.events.some((e) => isTerminal(e.event))) return () => {};
    record.listeners.add(onEvent);
    return () => record.listeners.delete(onEvent);
  }

  // ----- Interno -----

  private emit(record: RunRecord, event: AgentEvent) {
    const stored = { id: record.events.length + 1, event };
    record.events.push(stored);
    record.listeners.forEach((listener) => listener(stored));
    if (isTerminal(event)) record.listeners.clear();
  }

  /** Arranca ejecuciones en espera mientras la clave tenga concurrencia libre. */
  private pump(scope: KeyScope) {
    const limit = this.keys.info(scope)?.max_concurrency ?? 1;
    while (this.active[scope] < limit && this.waiting[scope].length > 0) {
      const record = this.waiting[scope].shift()!;
      this.active[scope] += 1;
      void this.execute(record).finally(() => {
        this.active[scope] -= 1;
        this.pump(scope);
      });
    }
  }

  private history(record: RunRecord): ChatMessage[] {
    const conv = this.conversations.get(record.run.conversation_id ?? '');
    const previous = (conv?.runIds ?? [])
      .map((id) => this.runs.get(id)!.run)
      .filter((r) => r.id !== record.run.id && r.status === 'succeeded' && r.answer);
    return previous.flatMap((r): ChatMessage[] => [
      { role: 'user', content: r.question },
      { role: 'assistant', content: r.answer ?? '' },
    ]);
  }

  private async execute(record: RunRecord) {
    const { run } = record;
    const apiKey = this.keys.reveal(record.keyScope);
    try {
      if (!apiKey) throw new OllamaError('ollama_key_rejected', 'La clave ya no está disponible.');
      run.status = 'running';
      run.started_at = new Date().toISOString();
      this.emit(record, { type: 'run.started' });

      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt() }, ...this.history(record), { role: 'user', content: run.question }];
      const think = parseThink(run.think);
      const maxRounds = this.options.maxToolRounds ?? 6;
      let seq = 0;
      const prior: PriorResult[] = [];

      for (let round = 0; ; round += 1) {
        // Pasado el tope de vueltas se retiran las herramientas para obligar a responder.
        const allowTools = round < maxRounds;
        let content = '';
        let thinking = '';
        const calls: ToolCall[] = [];

        for await (const chunk of this.ollama.chat(apiKey, { model: run.model, messages, tools: allowTools ? TOOL_DEFINITIONS : undefined, think }, record.abort.signal)) {
          const m = chunk.message;
          if (m?.thinking) {
            thinking += m.thinking;
            run.thinking = (run.thinking ?? '') + m.thinking;
            this.emit(record, { type: 'thinking.delta', text: m.thinking });
          }
          if (m?.content) {
            content += m.content;
            run.answer = (run.answer ?? '') + m.content;
            this.emit(record, { type: 'answer.delta', text: m.content });
          }
          if (m?.tool_calls) calls.push(...m.tool_calls);
          if (chunk.done) {
            run.prompt_tokens = (run.prompt_tokens ?? 0) + (chunk.prompt_eval_count ?? 0);
            run.completion_tokens = (run.completion_tokens ?? 0) + (chunk.eval_count ?? 0);
          }
        }

        if (calls.length === 0 || !allowTools) break;

        // Texto escrito antes de pedir herramientas no forma parte de la respuesta final.
        if (content) run.answer = (run.answer ?? '').slice(0, -content.length) || null;
        if (thinking && run.thinking) run.thinking += '\n\n';

        messages.push({ role: 'assistant', content, thinking: thinking || undefined, tool_calls: calls });
        for (const call of calls) {
          seq += 1;
          const args = normalizeArguments(call.function.arguments);
          run.tool_calls!.push({ seq, tool: call.function.name, arguments: args, result_summary: null, duration_ms: null });
          this.emit(record, { type: 'tool.call', seq, tool: call.function.name, arguments: args });
          const started = Date.now();
          const result = runTool(call.function.name, args, prior);
          prior.push({ seq, tool: call.function.name, data: result.data });
          if (result.attachment) run.attachments!.push(result.attachment);
          const duration_ms = Date.now() - started;
          const entry = run.tool_calls![seq - 1];
          entry.result_summary = result.summary;
          entry.duration_ms = duration_ms;
          this.emit(record, { type: 'tool.result', seq, summary: result.summary, duration_ms });
          // El número de herramienta viaja en el resultado para que el modelo pueda citarlo como [n].
          messages.push({ role: 'tool', tool_name: call.function.name, content: JSON.stringify({ herramienta_numero: seq, resultado: result.data }) });
        }
      }

      run.thinking = run.thinking?.trim() || null;
      run.answer = run.answer?.trim() || null;
      if (!run.answer) throw new OllamaError('ollama_unavailable', 'El modelo terminó sin escribir una respuesta.');

      // Citas: cada [n] del texto que corresponde a una herramienta llamada.
      const cited = [...new Set([...run.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
      for (const ref of cited) {
        const call = run.tool_calls!.find((t) => t.seq === ref);
        if (!call) continue;
        const citation: Citation = { ref, label: call.result_summary ?? call.tool, tool: call.tool, query: call.arguments };
        run.citations!.push(citation);
        this.emit(record, { type: 'citation', citation });
      }

      run.status = 'succeeded';
      run.finished_at = new Date().toISOString();
      this.emit(record, { type: 'run.completed', run });
    } catch (cause) {
      run.finished_at = new Date().toISOString();
      if (record.abort.signal.aborted) {
        run.status = 'cancelled';
        this.emit(record, { type: 'run.cancelled' });
        return;
      }
      const code = cause instanceof OllamaError ? cause.code : 'internal_error';
      const error = cause instanceof Error ? cause.message : String(cause);
      run.status = 'failed';
      run.error = error;
      this.emit(record, { type: 'run.failed', error, code });
    }
  }
}

/** Ollama entrega los argumentos como objeto; algún modelo los manda como texto JSON. */
function normalizeArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Elige el valor de `think`: el pedido si el modelo lo admite; si no, su valor por defecto. */
function resolveThink(model: OllamaModel, requested: string | undefined): string | null {
  const values = model.thinking?.values ?? [];
  const asText = values.map(String);
  if (requested && asText.includes(requested)) return requested;
  // El agente razona siempre que el modelo lo permita: si su valor por defecto es «sin
  // razonar», se toma el primer nivel que sí razona.
  const fallback = model.thinking?.default;
  if (fallback !== null && fallback !== undefined && fallback !== false) return String(fallback);
  const firstOn = values.find((v) => v !== false);
  return firstOn === undefined ? null : String(firstOn);
}

/** `think` se guarda como texto; Ollama espera booleano o el nombre del nivel. */
function parseThink(value: string | null | undefined): ThinkValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
