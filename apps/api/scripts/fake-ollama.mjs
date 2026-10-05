// Ollama de mentira para probar el circuito completo sin clave ni créditos.
//   node scripts/fake-ollama.mjs            (escucha en el puerto 11500)
//   OLLAMA_BASE_URL=http://localhost:11500 npm run dev
// Acepta cualquier clave que empiece por «demo». Razona, pide una herramienta y
// redacta la respuesta con lo que la herramienta devuelve; no entiende la pregunta.

import { createServer } from 'node:http';

const port = Number(process.env.FAKE_OLLAMA_PORT ?? 11500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODELS = {
  'demo-vision': { capabilities: ['completion', 'tools', 'thinking', 'vision'], thinking: { values: [false, 'low', 'high'], default: 'low' } },
  'demo-solo-texto': { capabilities: ['completion', 'tools', 'thinking'], thinking: { values: ['low', 'high'], default: 'low' } },
};

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

createServer(async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const authorized = (req.headers.authorization ?? '').startsWith('Bearer demo');

  if (req.url === '/api/tags') return json(200, { models: Object.keys(MODELS).map((name) => ({ name, model: name })) });
  if (req.url === '/api/show') {
    const { model } = await body(req);
    return MODELS[model] ? json(200, MODELS[model]) : json(404, { error: 'not found' });
  }
  if (req.url === '/api/me') return authorized ? json(200, { name: 'demo' }) : json(401, { error: 'invalid credentials' });
  if (req.url !== '/api/chat') return json(404, { error: 'not found' });
  if (!authorized) return json(401, { error: 'Unauthorized' });

  const { messages } = await body(req);
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const toolResult = messages.slice(lastUser + 1).find((m) => m.role === 'tool');
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  const send = async (message, pause = 40) => {
    res.write(`${JSON.stringify({ model: 'demo-vision', message: { role: 'assistant', ...message } })}\n`);
    await sleep(pause);
  };

  if (!toolResult) {
    const stories = /historia/i.test(question);
    for (const piece of ['Para responder ', 'necesito las cifras; ', 'las pido a la herramienta ', 'antes de afirmar nada.']) await send({ thinking: piece });
    await send({
      content: '',
      tool_calls: [{ type: 'function', function: { index: 0, name: stories ? 'historias_por_franja' : 'consultar_metricas', arguments: stories ? {} : { days: 28 } } }],
    });
  } else {
    const data = JSON.parse(toolResult.content);
    const n = data.herramienta_numero;
    const reach = data.resultado?.kpis?.find((k) => k.metric === 'reach');
    const text = reach
      ? `Respuesta de demostración: el alcance del periodo fue de ${Math.round(reach.value / 100) / 10} K [${n}].\n\nEste texto lo escribe un Ollama de mentira para probar el circuito; no ha entendido la pregunta.\n\nQué haría: conectar una clave real de Ollama Cloud.`
      : `Respuesta de demostración: la herramienta ${toolResult.tool_name} devolvió sus datos [${n}].\n\nEste texto lo escribe un Ollama de mentira para probar el circuito; no ha entendido la pregunta.\n\nQué haría: conectar una clave real de Ollama Cloud.`;
    for (const piece of text.match(/[\s\S]{1,18}/g)) await send({ content: piece }, 25);
  }
  res.write(`${JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 120, eval_count: 60 })}\n`);
  res.end();
}).listen(port, () => console.log(`Ollama de mentira en http://localhost:${port}`));
