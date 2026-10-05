// Rutas HTTP. Implementa la parte del contrato (api/openapi.yaml) que da vida al agente:
// claves de Ollama, modelos, cola, conversaciones y ejecuciones con streaming.
//
// Todavía no hay inicio de sesión: el servidor atiende a un único usuario local. Las
// rutas llevan orgId y brandId para no cambiar de forma cuando llegue la autenticación.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { AgentService, ModelNotAllowedError, NoKeyError, type NewMessage } from './agent/service';
import type { KeyScope, KeyStore } from './keys';
import { OllamaError, type Ollama } from './ollama';

export interface Deps {
  ollama: Ollama;
  keys: KeyStore;
  agent: AgentService;
}

function problem(c: Context, status: 400 | 404 | 409 | 422 | 502, code: string, title: string, detail?: string) {
  return c.body(JSON.stringify({ type: `https://atalaya.example/problems/${code}`, title, status, code, detail }), status, {
    'content-type': 'application/problem+json',
  });
}

const isScope = (value: string): value is KeyScope => value === 'org' || value === 'user';

async function readMessage(c: Context): Promise<NewMessage | null> {
  const body = (await c.req.json().catch(() => null)) as Partial<NewMessage> | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 4000) return null;
  return {
    question,
    model: typeof body?.model === 'string' ? body.model : undefined,
    think: typeof body?.think === 'string' ? body.think : undefined,
  };
}

export function createApp({ ollama, keys, agent }: Deps) {
  const app = new Hono().basePath('/v1');

  // En desarrollo la web habla por el proxy de Vite; esto cubre abrirla desde otro puerto local.
  app.use('*', cors({ origin: (origin) => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null) }));

  app.get('/health', (c) => c.json({ status: 'ok', agent: 'live', has_key: keys.active() !== null }));

  // ----- Claves de Ollama -----

  app.get('/orgs/:orgId/ollama-keys', (c) => c.json({ org_key: keys.info('org'), user_key: keys.info('user') }));

  app.put('/orgs/:orgId/ollama-keys/:scope', async (c) => {
    const scope = c.req.param('scope');
    if (!isScope(scope)) return problem(c, 404, 'not_found', 'Alcance de clave desconocido.');
    const body = (await c.req.json().catch(() => null)) as { api_key?: unknown; max_concurrency?: unknown } | null;
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
    if (apiKey.length < 8) return problem(c, 422, 'invalid_body', 'La clave es demasiado corta.', 'Pegue la clave completa, tal como la muestra Ollama.');
    const concurrency = Math.min(64, Math.max(1, Math.trunc(Number(body?.max_concurrency)) || 1));
    try {
      const result = await ollama.validateKey(apiKey);
      return c.json(keys.set(scope, apiKey, concurrency, result === 'valid'));
    } catch (cause) {
      if (cause instanceof OllamaError && cause.code === 'ollama_key_rejected') {
        return problem(c, 422, 'ollama_key_rejected', 'Ollama rechazó la clave.', 'Compruebe que la copió completa y que sigue activa en su cuenta de Ollama.');
      }
      return problem(c, 502, 'ollama_unavailable', 'No se pudo comprobar la clave.', cause instanceof Error ? cause.message : undefined);
    }
  });

  app.delete('/orgs/:orgId/ollama-keys/:scope', (c) => {
    const scope = c.req.param('scope');
    if (!isScope(scope) || !keys.revoke(scope)) return problem(c, 404, 'not_found', 'No hay clave con ese alcance.');
    return c.body(null, 204);
  });

  // ----- Agente: modelos y cola -----

  app.get('/orgs/:orgId/agent/models', async (c) => {
    try {
      const models = await agent.listModels();
      return c.json({
        items: models.map((m) => ({
          name: m.name,
          // `false` significa «sin razonar»; la lista enseña solo los niveles que razonan.
          thinking: (m.thinking?.values ?? []).filter((v) => v !== false).map(String),
          thinking_default: m.thinking?.default === undefined || m.thinking?.default === null ? null : String(m.thinking.default),
          tools: m.capabilities.includes('tools'),
          vision: m.capabilities.includes('vision'),
          audio: m.capabilities.includes('audio'),
        })),
      });
    } catch (cause) {
      return problem(c, 502, 'ollama_unavailable', 'No se pudo consultar la lista de modelos.', cause instanceof Error ? cause.message : undefined);
    }
  });

  app.get('/orgs/:orgId/agent/queue', (c) => {
    const queue = agent.queue();
    return queue ? c.json(queue) : problem(c, 409, 'no_ollama_key', 'No hay clave de Ollama.', 'Registre una clave para usar el agente.');
  });

  // ----- Agente: conversaciones y ejecuciones -----

  const begin = async (c: Context, brandId: string, conversationId: string | null) => {
    const message = await readMessage(c);
    if (!message) return problem(c, 422, 'invalid_body', 'La pregunta está vacía o es demasiado larga.');
    try {
      return await agent.start(brandId, conversationId, message);
    } catch (cause) {
      if (cause instanceof NoKeyError) return problem(c, 409, 'no_ollama_key', 'No hay clave de Ollama.', 'Registre una clave para usar el agente.');
      if (cause instanceof ModelNotAllowedError) return problem(c, 422, 'model_not_allowed', 'Ese modelo no está en la lista permitida.', 'Solo se admiten modelos con visión, herramientas y razonamiento.');
      return problem(c, 502, 'ollama_unavailable', 'No se pudo preparar la ejecución.', cause instanceof Error ? cause.message : undefined);
    }
  };

  app.get('/brands/:brandId/agent/conversations', (c) => c.json({ items: agent.listConversations(c.req.param('brandId')), next_cursor: null }));

  app.post('/brands/:brandId/agent/conversations', async (c) => {
    const started = await begin(c, c.req.param('brandId'), null);
    return started instanceof Response ? started : c.json(started, 202);
  });

  app.get('/agent/conversations/:id', (c) => {
    const found = agent.getConversation(c.req.param('id'));
    return found ? c.json(found) : problem(c, 404, 'not_found', 'No existe esa conversación.');
  });

  app.post('/agent/conversations/:id/messages', async (c) => {
    const found = agent.getConversation(c.req.param('id'));
    if (!found) return problem(c, 404, 'not_found', 'No existe esa conversación.');
    const started = await begin(c, found.conversation.brand_id, found.conversation.id);
    return started instanceof Response ? started : c.json(started.run, 202);
  });

  app.get('/agent/runs/:id', (c) => {
    const run = agent.getRun(c.req.param('id'));
    return run ? c.json(run) : problem(c, 404, 'not_found', 'No existe esa ejecución.');
  });

  app.delete('/agent/runs/:id', (c) => {
    const result = agent.cancel(c.req.param('id'));
    if (result === 'missing') return problem(c, 404, 'not_found', 'No existe esa ejecución.');
    if (result === 'finished') return problem(c, 409, 'run_finished', 'La ejecución ya había terminado.');
    return c.body(null, 204);
  });

  app.get('/agent/runs/:id/events', (c) => {
    const id = c.req.param('id');
    if (!agent.getRun(id)) return problem(c, 404, 'not_found', 'No existe esa ejecución.');
    const after = Number(c.req.header('last-event-id') ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      const pending: { id: number; event: { type: string } }[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const unsubscribe = agent.subscribe(id, after, (e) => {
        pending.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });

      while (!closed) {
        const next = pending.shift();
        if (!next) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        await stream.writeSSE({ id: String(next.id), event: next.event.type, data: JSON.stringify(next.event) });
        if (['run.completed', 'run.failed', 'run.cancelled'].includes(next.event.type)) break;
      }
      unsubscribe?.();
    });
  });

  app.notFound((c) => problem(c, 404, 'not_found', 'Ruta no encontrada.'));
  app.onError((cause, c) => {
    console.error(cause);
    return problem(c, 502, 'internal_error', 'Error interno.');
  });

  return app;
}
