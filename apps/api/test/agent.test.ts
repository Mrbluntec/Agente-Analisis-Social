// Pruebas del servicio contra un Ollama falso que habla el mismo protocolo NDJSON.
//   npm test

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { AgentService } from '../src/agent/service';
import { createApp } from '../src/app';
import { KeyStore } from '../src/keys';
import { Ollama } from '../src/ollama';

const GOOD_KEY = 'clave-buena-1234';
const ORG = 'org-1';
const BRAND = 'brand-1';

interface Seen {
  auth: string | undefined;
  body: { model: string; messages: { role: string; content: string; tool_name?: string }[]; tools?: unknown[]; think?: unknown; stream?: boolean };
}

let fake: Server;
let baseUrl: string;
const chats: Seen[] = [];
let chatDelayMs = 0;

const readBody = async (req: IncomingMessage) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
};

const MODELS: Record<string, { capabilities: string[]; thinking?: { values: (string | boolean)[]; default: string | boolean } }> = {
  'solo-texto': { capabilities: ['completion', 'tools', 'thinking'], thinking: { values: ['low', 'high'], default: 'low' } },
  'con-vision': { capabilities: ['completion', 'tools', 'thinking', 'vision'], thinking: { values: [false, 'low', 'high'], default: 'low' } },
  'sin-razonar': { capabilities: ['completion', 'tools', 'vision'] },
};

before(async () => {
  fake = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/tags') return json(200, { models: Object.keys(MODELS).map((name) => ({ name, model: name })) });
    if (req.url === '/api/show') {
      const { model } = await readBody(req);
      return MODELS[model] ? json(200, MODELS[model]) : json(404, { error: 'not found' });
    }
    const authorized = req.headers.authorization === `Bearer ${GOOD_KEY}`;
    if (req.url === '/api/me') return authorized ? json(200, { name: 'prueba' }) : json(401, { error: 'invalid credentials' });
    if (req.url === '/api/chat') {
      if (!authorized) return json(401, { error: 'Unauthorized' });
      const body = await readBody(req);
      chats.push({ auth: req.headers.authorization, body });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const line = (o: unknown) => res.write(`${JSON.stringify(o)}\n`);
      if (chatDelayMs) await new Promise((r) => setTimeout(r, chatDelayMs));
      const toolRounds = body.messages.filter((m: { role: string }) => m.role === 'tool').length;
      const wantsChart = body.messages.some((m: { role: string; content: string }) => m.role === 'user' && m.content.includes('gráfico'));
      if (wantsChart && toolRounds === 1) {
        line({ message: { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { index: 0, name: 'adjuntar_grafico', arguments: { fuente: 1, titulo: 'Alcance por red' } } }] } });
        line({ done: true, done_reason: 'stop' });
      } else if (toolRounds === 0) {
        line({ message: { role: 'assistant', thinking: 'Necesito las ' } });
        line({ message: { role: 'assistant', thinking: 'cifras del periodo.' } });
        line({ message: { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { index: 0, name: 'consultar_metricas', arguments: { days: 28 } } }] } });
        line({ done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 20 });
      } else {
        // Partido a mitad de línea a propósito: el cliente debe recomponerla.
        const whole = `${JSON.stringify({ message: { role: 'assistant', content: 'El alcance creció [1]. ' } })}\n`;
        res.write(whole.slice(0, 25));
        await new Promise((r) => setTimeout(r, 5));
        res.write(whole.slice(25));
        line({ message: { role: 'assistant', content: 'Qué haría: repetir el formato.' } });
        line({ done: true, done_reason: 'stop', prompt_eval_count: 300, eval_count: 40 });
      }
      return res.end();
    }
    return json(404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => fake.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => fake.close(() => resolve())));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'atalaya-'));
  const ollama = new Ollama(baseUrl);
  const keys = new KeyStore(dir);
  const agent = new AgentService(ollama, keys, { requiredCapabilities: ['vision', 'tools', 'thinking'], modelCacheMs: 0 });
  const app = createApp({ ollama, keys, agent });
  const call = (path: string, init?: RequestInit) => app.request(`/v1${path}`, init);
  const post = (path: string, body: unknown, method = 'POST') =>
    call(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { dir, keys, agent, call, post };
}

/** Lee el flujo de eventos completo de una ejecución. */
async function events(call: ReturnType<typeof setup>['call'], runId: string) {
  const res = await call(`/agent/runs/${runId}/events`);
  assert.equal(res.status, 200);
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.includes('data:'))
    .map((block) => JSON.parse(block.split('\n').find((l) => l.startsWith('data:'))!.slice(5)) as { type: string; [k: string]: unknown });
}

test('la clave se cifra en disco y se recupera intacta', () => {
  const { dir, keys } = setup();
  keys.set('org', GOOD_KEY, 3, true);
  const onDisk = readFileSync(join(dir, 'ollama-keys.json'), 'utf8');
  assert.ok(!onDisk.includes(GOOD_KEY), 'la clave no debe aparecer en claro');
  assert.equal(keys.reveal('org'), GOOD_KEY);
  assert.equal(keys.info('org')?.last4, '1234');
  // Un segundo almacén sobre la misma carpeta la descifra con la clave maestra local.
  assert.equal(new KeyStore(dir).reveal('org'), GOOD_KEY);
  assert.equal(keys.revoke('org'), true);
  assert.equal(keys.info('org'), null);
});

test('la clave personal tiene prioridad sobre la de la agencia', () => {
  const { keys } = setup();
  keys.set('org', GOOD_KEY, 3, true);
  assert.equal(keys.active()?.scope, 'org');
  keys.set('user', 'otra-clave-9999', 1, true);
  assert.equal(keys.active()?.scope, 'user');
});

test('una clave rechazada por Ollama no se guarda', async () => {
  const { post, keys } = setup();
  const res = await post(`/orgs/${ORG}/ollama-keys/org`, { api_key: 'clave-mala-0000' }, 'PUT');
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assert.equal(((await res.json()) as { code: string }).code, 'ollama_key_rejected');
  assert.equal(keys.info('org'), null);
});

test('una clave válida se guarda y nunca se devuelve', async () => {
  const { post, call } = setup();
  const res = await post(`/orgs/${ORG}/ollama-keys/org`, { api_key: GOOD_KEY, max_concurrency: 3 }, 'PUT');
  assert.equal(res.status, 200);
  const saved = (await res.json()) as Record<string, unknown>;
  assert.equal(saved.last4, '1234');
  assert.equal(saved.max_concurrency, 3);
  assert.ok(saved.validated_at);
  const listed = await (await call(`/orgs/${ORG}/ollama-keys`)).text();
  assert.ok(!listed.includes(GOOD_KEY));
});

test('la lista de modelos solo incluye los que tienen visión, herramientas y razonamiento', async () => {
  const { call } = setup();
  const body = (await (await call(`/orgs/${ORG}/agent/models`)).json()) as { items: { name: string; thinking: string[]; vision: boolean; audio: boolean }[] };
  assert.deepEqual(body.items.map((m) => m.name), ['con-vision']);
  assert.deepEqual(body.items[0].thinking, ['low', 'high']);
  assert.equal(body.items[0].audio, false);
});

test('sin clave no se puede preguntar', async () => {
  const { post } = setup();
  const res = await post(`/brands/${BRAND}/agent/conversations`, { question: '¿Cómo vamos?' });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, 'no_ollama_key');
});

test('un modelo fuera de la lista se rechaza', async () => {
  const { post, keys } = setup();
  keys.set('org', GOOD_KEY, 1, true);
  const res = await post(`/brands/${BRAND}/agent/conversations`, { question: '¿Cómo vamos?', model: 'solo-texto' });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { code: string }).code, 'model_not_allowed');
});

test('una pregunta recorre razonamiento, herramienta, respuesta y cita', async () => {
  const { post, call, keys } = setup();
  keys.set('org', GOOD_KEY, 1, true);
  chats.length = 0;
  const res = await post(`/brands/${BRAND}/agent/conversations`, { question: '¿Cómo fue el alcance?', think: 'high' });
  assert.equal(res.status, 202);
  const { run, conversation } = (await res.json()) as { run: { id: string; model: string; think: string }; conversation: { id: string } };
  assert.equal(run.model, 'con-vision');
  assert.equal(run.think, 'high');

  const seen = await events(call, run.id);
  const types = seen.map((e) => e.type);
  assert.deepEqual(types.slice(0, 2), ['run.queued', 'run.started']);
  assert.ok(types.indexOf('thinking.delta') < types.indexOf('tool.call'));
  assert.ok(types.indexOf('tool.call') < types.indexOf('tool.result'));
  assert.ok(types.indexOf('tool.result') < types.indexOf('answer.delta'));
  assert.ok(types.indexOf('answer.delta') < types.indexOf('citation'));
  assert.equal(types.at(-1), 'run.completed');

  const final = (await (await call(`/agent/runs/${run.id}`)).json()) as {
    status: string; answer: string; thinking: string; prompt_tokens: number; completion_tokens: number;
    tool_calls: { seq: number; tool: string; result_summary: string }[]; citations: { ref: number; tool: string }[];
  };
  assert.equal(final.status, 'succeeded');
  assert.equal(final.answer, 'El alcance creció [1]. Qué haría: repetir el formato.');
  assert.equal(final.thinking, 'Necesito las cifras del periodo.');
  assert.equal(final.tool_calls.length, 1);
  assert.match(final.tool_calls[0].result_summary, /^Alcance 184,2/);
  assert.deepEqual(final.citations.map((c) => [c.ref, c.tool]), [[1, 'consultar_metricas']]);
  assert.equal(final.prompt_tokens, 400);
  assert.equal(final.completion_tokens, 60);

  // Lo que recibió Ollama: clave, nivel de razonamiento, herramientas y el resultado numerado.
  assert.equal(chats.length, 2);
  assert.equal(chats[0].auth, `Bearer ${GOOD_KEY}`);
  assert.equal(chats[0].body.think, 'high');
  assert.equal(chats[0].body.stream, true);
  assert.ok((chats[0].body.tools ?? []).length >= 6);
  assert.equal(chats[0].body.messages[0].role, 'system');
  const toolMessage = chats[1].body.messages.find((m) => m.role === 'tool')!;
  assert.equal(toolMessage.tool_name, 'consultar_metricas');
  assert.equal(JSON.parse(toolMessage.content).herramienta_numero, 1);

  // La siguiente pregunta de la conversación lleva la anterior como contexto.
  chats.length = 0;
  const next = await post(`/agent/conversations/${conversation.id}/messages`, { question: '¿Y las interacciones?' });
  assert.equal(next.status, 202);
  await events(call, ((await next.json()) as { id: string }).id);
  const roles = chats[0].body.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
});

test('con concurrencia 1 la segunda pregunta espera a la primera', async () => {
  const { post, call, keys, agent } = setup();
  keys.set('org', GOOD_KEY, 1, true);
  chatDelayMs = 60;
  try {
    const a = (await (await post(`/brands/${BRAND}/agent/conversations`, { question: 'Primera' })).json()) as { run: { id: string } };
    const b = (await (await post(`/brands/${BRAND}/agent/conversations`, { question: 'Segunda' })).json()) as { run: { id: string } };
    await new Promise((r) => setTimeout(r, 20));
    const queue = agent.queue()!;
    assert.equal(queue.running.length, 1);
    assert.equal(queue.queued.length, 1);
    assert.equal(queue.queued[0].run_id, b.run.id);
    const [first, second] = await Promise.all([events(call, a.run.id), events(call, b.run.id)]);
    assert.equal(first.at(-1)?.type, 'run.completed');
    assert.equal(second.at(-1)?.type, 'run.completed');
  } finally {
    chatDelayMs = 0;
  }
});

test('una ejecución en curso se puede cancelar', async () => {
  const { post, call, keys } = setup();
  keys.set('org', GOOD_KEY, 1, true);
  chatDelayMs = 200;
  try {
    const { run } = (await (await post(`/brands/${BRAND}/agent/conversations`, { question: 'Cancelable' })).json()) as { run: { id: string } };
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call(`/agent/runs/${run.id}`, { method: 'DELETE' })).status, 204);
    const seen = await events(call, run.id);
    assert.equal(seen.at(-1)?.type, 'run.cancelled');
    assert.equal((await call(`/agent/runs/${run.id}`, { method: 'DELETE' })).status, 409);
  } finally {
    chatDelayMs = 0;
  }
});

test('si Ollama revoca la clave a mitad de camino, la ejecución falla con su código', async () => {
  const { post, call, keys } = setup();
  keys.set('org', 'clave-caducada-7777', 1, true);
  const { run } = (await (await post(`/brands/${BRAND}/agent/conversations`, { question: '¿Cómo vamos?' })).json()) as { run: { id: string } };
  const seen = await events(call, run.id);
  const last = seen.at(-1)!;
  assert.equal(last.type, 'run.failed');
  assert.equal(last.code, 'ollama_key_rejected');
});

test('el agente adjunta un gráfico construido con los datos de una herramienta, no con cifras del modelo', async () => {
  const { post, call, keys } = setup();
  keys.set('org', GOOD_KEY, 1, true);
  const { run } = (await (await post(`/brands/${BRAND}/agent/conversations`, { question: 'Muéstreme un gráfico por red' })).json()) as { run: { id: string } };
  const seen = await events(call, run.id);
  assert.equal(seen.at(-1)?.type, 'run.completed');
  const final = (await (await call(`/agent/runs/${run.id}`)).json()) as {
    attachments: { kind: string; title: string; ref: number; points: { label: string; value: number }[] }[];
    tool_calls: { tool: string }[];
  };
  assert.deepEqual(final.tool_calls.map((t) => t.tool), ['consultar_metricas', 'adjuntar_grafico']);
  assert.equal(final.attachments.length, 1);
  assert.equal(final.attachments[0].title, 'Alcance por red');
  assert.equal(final.attachments[0].ref, 1);
  assert.ok(final.attachments[0].points.length >= 2);
  assert.ok(final.attachments[0].points.every((p) => typeof p.label === 'string' && p.value > 0));
});
