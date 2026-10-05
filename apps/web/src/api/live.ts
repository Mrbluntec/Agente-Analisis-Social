// Cliente del servidor real (apps/api). La web lo usa cuando el servidor responde; si no
// hay servidor, las pantallas siguen con el agente simulado de mock.ts.

import { BRAND } from '@core/sample';
import type { AgentModel, AgentQueue, AgentRun, Citation, OllamaKey } from '@core/types';
import type { RunView } from './mock';

const BASE = '/v1';
const ORG = BRAND.org_id;

export type KeyScope = 'org' | 'user';
export interface Keys {
  org_key: OllamaKey | null;
  user_key: OllamaKey | null;
}

/** Error con el título y el detalle que envía el servidor (application/problem+json). */
export class ApiProblem extends Error {
  constructor(public readonly code: string, title: string, public readonly detail?: string) {
    super(title);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & { code?: string; title?: string; detail?: string }) | null;
  if (!res.ok) throw new ApiProblem(body?.code ?? 'unknown', body?.title ?? `El servidor respondió ${res.status}.`, body?.detail);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** ¿Hay servidor? Una sola comprobación corta al abrir la aplicación. */
export async function detectApi(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    return ((await res.json()) as { status?: string }).status === 'ok';
  } catch {
    return false;
  }
}

export const getKeys = () => call<Keys>(`/orgs/${ORG}/ollama-keys`);
export const putKey = (scope: KeyScope, apiKey: string, maxConcurrency: number) =>
  call<OllamaKey>(`/orgs/${ORG}/ollama-keys/${scope}`, json('PUT', { api_key: apiKey, max_concurrency: maxConcurrency }));
export const deleteKey = (scope: KeyScope) => call<void>(`/orgs/${ORG}/ollama-keys/${scope}`, { method: 'DELETE' });
export const getModels = async () => (await call<{ items: AgentModel[] }>(`/orgs/${ORG}/agent/models`)).items;
export const cancelRun = (id: string) => call<void>(`/agent/runs/${id}`, { method: 'DELETE' }).catch(() => undefined);

export async function getQueue(): Promise<AgentQueue | null> {
  try {
    return await call<AgentQueue>(`/orgs/${ORG}/agent/queue`);
  } catch {
    return null;
  }
}

export interface Question {
  question: string;
  model?: string;
  think?: string;
}

/** Envía una pregunta; abre conversación si aún no hay una. */
export async function ask(conversationId: string | null, q: Question): Promise<{ conversationId: string; run: AgentRun }> {
  if (conversationId) {
    const run = await call<AgentRun>(`/agent/conversations/${conversationId}/messages`, json('POST', q));
    return { conversationId, run };
  }
  const started = await call<{ conversation: { id: string }; run: AgentRun }>(`/brands/${BRAND.id}/agent/conversations`, json('POST', q));
  return { conversationId: started.conversation.id, run: started.run };
}

const seconds = (run: AgentRun) =>
  run.started_at && run.finished_at ? Math.max(1, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000)) : undefined;

/**
 * Sigue una ejecución por su flujo de eventos y entrega la ejecución actualizada tras
 * cada uno. Devuelve una función que deja de escuchar.
 */
export function followRun(initial: AgentRun, onUpdate: (run: RunView) => void): () => void {
  let run: RunView = { ...initial, tool_calls: [...(initial.tool_calls ?? [])], citations: [...(initial.citations ?? [])] };
  const source = new EventSource(`${BASE}/agent/runs/${initial.id}/events`);
  const push = (next: RunView) => {
    run = next;
    onUpdate(run);
  };
  const on = <T,>(type: string, handle: (data: T) => void) =>
    source.addEventListener(type, (e) => handle(JSON.parse((e as MessageEvent<string>).data) as T));
  const finish = () => source.close();

  on('run.started', () => push({ ...run, status: 'running', started_at: new Date().toISOString() }));
  on<{ text: string }>('thinking.delta', (d) => push({ ...run, thinking: (run.thinking ?? '') + d.text }));
  on<{ text: string }>('answer.delta', (d) => push({ ...run, answer: (run.answer ?? '') + d.text }));
  on<{ seq: number; tool: string; arguments: Record<string, unknown> }>('tool.call', (d) =>
    // El texto previo a una herramienta no es la respuesta final: se descarta.
    push({ ...run, answer: null, tool_calls: [...(run.tool_calls ?? []), { seq: d.seq, tool: d.tool, arguments: d.arguments, result_summary: null, duration_ms: null }] }),
  );
  on<{ seq: number; summary: string; duration_ms: number }>('tool.result', (d) =>
    push({ ...run, tool_calls: (run.tool_calls ?? []).map((t) => (t.seq === d.seq ? { ...t, result_summary: d.summary, duration_ms: d.duration_ms } : t)) }),
  );
  on<{ citation: Citation }>('citation', (d) => push({ ...run, citations: [...(run.citations ?? []), d.citation] }));
  on<{ run: AgentRun }>('run.completed', (d) => {
    push({ ...d.run, duration_s: seconds(d.run) });
    finish();
  });
  on<{ error: string; code: string }>('run.failed', (d) => {
    push({ ...run, status: 'failed', error: d.error, error_code: d.code });
    finish();
  });
  on('run.cancelled', () => {
    push({ ...run, status: 'cancelled' });
    finish();
  });
  source.onerror = () => {
    // EventSource reintenta solo; si la ejecución ya terminó, no hay nada que reintentar.
    if (run.status !== 'queued' && run.status !== 'running') finish();
  };

  return finish;
}
