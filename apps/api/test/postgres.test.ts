// Pruebas del almacén PostgreSQL. Se saltan si no hay DATABASE_URL.
// Usan una base desechable: borran las filas del agente de la marca de muestra.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { BRAND } from '../../../packages/core/src/sample';
import { AgentService } from '../src/agent/service';
import { createApp } from '../src/app';
import { KeyStore } from '../src/keys';
import { Ollama } from '../src/ollama';
import { PostgresAgentStore } from '../src/store';
import { migrate } from '../src/store/migrate';

const url = process.env.DATABASE_URL;
const skip = url ? false : 'DATABASE_URL no está definida';
const KEY = 'clave-buena-1234';

let fake: Server;
let baseUrl = '';
const stores: PostgresAgentStore[] = [];

const readBody = async (req: IncomingMessage) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
};

before(async () => {
  if (!url) return;
  await migrate(url, true, () => {});
  const store = new PostgresAgentStore(url);
  await store.pool.query('DELETE FROM agent_conversations WHERE brand_id = $1', [BRAND.id]);
  await store.close();

  fake = createServer(async (req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/tags') return json({ models: [{ name: 'm', model: 'm' }] });
    if (req.url === '/api/show') return json({ capabilities: ['tools', 'thinking', 'vision'], thinking: { values: ['low'], default: 'low' } });
    if (req.url === '/api/me') return json({ name: 'x' });
    const body = await readBody(req);
    const rounds = body.messages.filter((m: { role: string }) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const line = (o: unknown) => res.write(`${JSON.stringify(o)}\n`);
    if (rounds === 0) {
      line({ message: { role: 'assistant', thinking: 'Busco cifras.', content: '', tool_calls: [{ function: { name: 'consultar_metricas', arguments: { days: 28 } } }] } });
    } else if (rounds === 1) {
      line({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'adjuntar_grafico', arguments: { fuente: 1, titulo: 'Alcance por red' } } }] } });
    } else {
      line({ message: { role: 'assistant', content: 'El alcance creció [1].' } });
    }
    line({ done: true, prompt_eval_count: 10, eval_count: 5 });
    res.end();
  });
  await new Promise<void>((resolve) => fake.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

after(async () => {
  await Promise.all(stores.map((s) => s.close()));
  if (fake) await new Promise<void>((resolve) => fake.close(() => resolve()));
});

function boot(dir: string) {
  const store = new PostgresAgentStore(url!);
  stores.push(store);
  const ollama = new Ollama(baseUrl);
  const keys = new KeyStore(dir);
  const agent = new AgentService(ollama, keys, { requiredCapabilities: ['tools'], modelCacheMs: 0, store });
  const app = createApp({ ollama, keys, agent });
  return { store, keys, call: (path: string, init?: RequestInit) => app.request(`/v1${path}`, init) };
}

test('las conversaciones y ejecuciones sobreviven a un reinicio', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atalaya-pg-'));
  const first = boot(dir);
  first.keys.set('org', KEY, 1, true);
  const res = await first.call(`/brands/${BRAND.id}/agent/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '¿Cómo vamos?' }),
  });
  assert.equal(res.status, 202);
  const { conversation, run } = (await res.json()) as { conversation: { id: string }; run: { id: string } };
  await (await first.call(`/agent/runs/${run.id}/events`)).text();

  // Un servidor nuevo, sin nada en memoria, lee lo mismo desde PostgreSQL.
  const second = boot(dir);
  assert.equal(await second.store.recoverInterrupted(), 0);
  const list = (await (await second.call(`/brands/${BRAND.id}/agent/conversations`)).json()) as { items: { id: string }[] };
  assert.ok(list.items.some((c) => c.id === conversation.id));

  const saved = (await (await second.call(`/agent/runs/${run.id}`)).json()) as Record<string, any>;
  assert.equal(saved.status, 'succeeded');
  assert.equal(saved.answer, 'El alcance creció [1].');
  assert.equal(saved.key_scope, 'org');
  assert.equal(saved.prompt_tokens, 30);
  assert.deepEqual(saved.tool_calls.map((t: { tool: string }) => t.tool), ['consultar_metricas', 'adjuntar_grafico']);
  assert.equal(saved.citations[0].ref, 1);
  assert.deepEqual(saved.citations[0].query, { days: 28 });
  assert.equal(saved.attachments.length, 1);
  assert.equal(saved.attachments[0].kind, 'columns');

  const conv = (await (await second.call(`/agent/conversations/${conversation.id}`)).json()) as { runs: { id: string }[] };
  assert.deepEqual(conv.runs.map((r) => r.id), [run.id]);

  const replay = await (await second.call(`/agent/runs/${run.id}/events`)).text();
  assert.match(replay, /event: run.completed/);
  assert.equal((await second.call(`/agent/runs/${run.id}`, { method: 'DELETE' })).status, 409);
});

test('una ejecución a medias se marca como fallida al arrancar', { skip }, async () => {
  const store = new PostgresAgentStore(url!);
  stores.push(store);
  const id = crypto.randomUUID();
  const conversation = { id: crypto.randomUUID(), brand_id: BRAND.id, title: 'x', mode: 'analyst' as const, created_at: new Date().toISOString() };
  await store.saveConversation(conversation);
  await store.saveRun({ id, conversation_id: conversation.id, mode: 'analyst', status: 'running', model: 'm', question: 'q', queued_at: new Date().toISOString(), started_at: new Date().toISOString() } as never, BRAND.id);
  assert.ok((await store.recoverInterrupted()) >= 1);
  const run = await store.getRun(id);
  assert.equal(run?.status, 'failed');
  assert.ok(run?.finished_at);
});
