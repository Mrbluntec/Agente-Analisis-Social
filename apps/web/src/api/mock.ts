// Agente simulado. Se usa cuando no hay servidor al que llamar (por ejemplo, en la vista
// publicada): reproduce el orden de eventos del contrato con respuestas escritas a mano.
// La analítica vive en packages/core y se reexporta aquí para las pantallas.

import { BRAND, STORIES_BY_HOUR } from '@core/sample';
import type { AgentQueue, AgentRun, Citation, RunAttachment, ToolCall } from '@core/types';

export * from '@core/analytics';

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------

export const AGENT_MODELS = ['deepseek-v4-pro', 'glm-5.3', 'kimi-k3'];

export function getAgentQueue(extraRunning: number): AgentQueue {
  const briefing = { run_id: 'q1', mode: 'briefing' as const, brand_name: 'Clínica Dental Samborondón', queued_at: '2026-10-05T09:10:00-05:00' };
  const mine = Array.from({ length: extraRunning }, (_, i) => ({ run_id: `me${i}`, mode: 'analyst' as const, brand_name: BRAND.name, queued_at: '2026-10-05T09:14:00-05:00' }));
  return { key_scope: 'org', max_concurrency: 3, running: [briefing, ...mine], queued: [] };
}

/** Lo que la pantalla del agente pinta: una ejecución del contrato más dos extras de la muestra. */
export interface RunView extends AgentRun {
  advice?: string;
  duration_s?: number;
  /** Código del fallo cuando la ejecución viene del servidor real. */
  error_code?: string;
}

interface Script {
  thinking: string;
  tools: Omit<ToolCall, 'seq'>[];
  answer: string;
  advice?: string;
  citations: Citation[];
  attachments?: RunAttachment[];
}

const SCRIPTS: Record<'stories' | 'facebook' | 'slots' | 'fallback', Script> = {
  stories: {
    thinking:
      'Primero confirmo que la caída es real y no ruido. Después descarto las causas baratas: menos historias que otros jueves, o un mal día para toda la cuenta. Si ninguna se cumple, miro la hora de publicación.',
    tools: [
      { tool: 'detectar_anomalias', arguments: { metric: 'reach', format: 'story', date: '2026-10-01' }, result_summary: 'Historias del 1 oct: 2,05 K, un 34 % bajo la media de los jueves.', duration_ms: 212 },
      { tool: 'comparar_periodos', arguments: { metric: 'posts', format: 'story', weekday: 4 }, result_summary: 'Cuatro historias, las mismas que los jueves anteriores.', duration_ms: 148 },
      { tool: 'consultar_metricas', arguments: { metric: 'reach', date: '2026-10-01' }, result_summary: 'Alcance total del 1 oct: 9,4 K, el más alto del periodo.', duration_ms: 96 },
      { tool: 'consultar_metricas', arguments: { metric: 'reach', format: 'story', group_by: 'publish_hour', weeks: 8 }, result_summary: 'Alcance de 142 historias según su hora de publicación, ocho semanas.', duration_ms: 301 },
    ],
    answer:
      'Por la hora: se publicaron a las 21:00 y esta cuenta rinde a las 18:30.\n\nEn las últimas ocho semanas, una historia publicada a las 18:30 llega en promedio a 3,1 K personas; una de las 21:00, a 2,0 K [1]. Las cuatro del jueves salieron a las 21:00.\n\nNo hubo menos historias que otros jueves ni fue un mal día para la cuenta: el alcance total de ese día fue el más alto del periodo [2].',
    advice: 'Mantener las historias entre las 18:00 y las 19:00. Cuando un reel ocupe esa franja, publicarlas media hora después, no dos horas y media más tarde.',
    citations: [
      { ref: 1, label: 'Historias de Instagram por hora de publicación, 10 ago – 4 oct.', tool: 'consultar_metricas', query: { metric: 'reach', format: 'story', group_by: 'publish_hour', weeks: 8 } },
      { ref: 2, label: 'Alcance diario de la cuenta, 1 oct.', tool: 'consultar_metricas', query: { metric: 'reach', date: '2026-10-01' } },
    ],
    attachments: [
      {
        kind: 'columns',
        title: 'Alcance medio de una historia según la hora de publicación',
        unit: 'count',
        ref: 1,
        points: STORIES_BY_HOUR.map((s) => ({ label: s.hour, value: s.reach, highlight: s.note === 'habitual' })),
      },
    ],
  },
  facebook: {
    thinking: 'Antes de comparar franjas compruebo si Facebook tiene suficientes historias. Con muy pocas, cualquier diferencia entre horas sería ruido.',
    tools: [
      { tool: 'consultar_metricas', arguments: { network: 'facebook', format: 'story', group_by: 'publish_hour', weeks: 8 }, result_summary: '9 historias en Facebook en ocho semanas; ninguna franja reúne más de tres.', duration_ms: 187 },
    ],
    answer:
      'No se puede afirmar todavía.\n\nFacebook solo tiene 9 historias en ocho semanas y ninguna franja reúne más de tres [1]. Con tan pocas, la diferencia entre horas no distingue un patrón de una casualidad.',
    advice: 'Si interesa saberlo, publique en dos franjas fijas durante cuatro semanas y repita la pregunta.',
    citations: [{ ref: 1, label: 'Historias de Facebook por hora de publicación, 10 ago – 4 oct.', tool: 'consultar_metricas', query: { network: 'facebook', format: 'story', group_by: 'publish_hour', weeks: 8 } }],
  },
  slots: {
    thinking: 'Agrupo las historias por día de la semana y franja, y descarto las combinaciones con menos de cinco historias para no sacar conclusiones de casos sueltos.',
    tools: [
      { tool: 'consultar_metricas', arguments: { format: 'story', group_by: ['weekday', 'publish_hour'], weeks: 8 }, result_summary: '142 historias en 28 combinaciones de día y franja; 11 tienen cinco o más.', duration_ms: 264 },
    ],
    answer:
      'De martes a viernes gana la franja de las 18:30.\n\nEn los cuatro días con datos suficientes, las 18:30 superan a la siguiente mejor franja [1]. Para lunes, sábado y domingo no hay ninguna combinación con cinco historias, así que no hay conclusión.',
    advice: 'Mantenga las 18:30 entre semana y reparta las historias del fin de semana en dos franjas fijas para poder medirlas.',
    citations: [{ ref: 1, label: 'Historias de Instagram por día de la semana y hora, 10 ago – 4 oct.', tool: 'consultar_metricas', query: { format: 'story', group_by: ['weekday', 'publish_hour'], weeks: 8 } }],
  },
  fallback: {
    thinking: '',
    tools: [],
    answer:
      'Esta es una vista de muestra: el agente real todavía no está conectado.\n\nCuando lo esté, esta pregunta se responderá con los datos de la marca y con el modelo que elija. Por ahora hay respuesta de ejemplo para las tres sugerencias que aparecen bajo cada respuesta.',
    citations: [],
  },
};

function pickScript(question: string): Script {
  const q = question.toLowerCase();
  if (q.includes('facebook')) return SCRIPTS.facebook;
  if (q.includes('franja') || q.includes('día de la semana')) return SCRIPTS.slots;
  if (q.includes('historia')) return SCRIPTS.stories;
  return SCRIPTS.fallback;
}

let runCounter = 0;

function emptyRun(question: string, model: string): RunView {
  runCounter += 1;
  return {
    id: `run-${runCounter}`,
    conversation_id: 'conv-1',
    mode: 'analyst',
    status: 'queued',
    model,
    think: 'true',
    key_scope: 'org',
    question,
    thinking: null,
    answer: null,
    tool_calls: [],
    citations: [],
    queued_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    error: null,
  };
}

/** Ejecución ya terminada, para abrir la pantalla con una conversación real. */
export function completedRun(question: string, model: string): RunView {
  const s = pickScript(question);
  return {
    ...emptyRun(question, model),
    status: 'succeeded',
    thinking: s.thinking || null,
    answer: s.answer,
    tool_calls: s.tools.map((t, i) => ({ ...t, seq: i + 1 })),
    citations: s.citations,
    attachments: s.attachments ?? [],
    advice: s.advice,
    duration_s: 14,
  };
}

/**
 * Simula el flujo de eventos de una ejecución: cola → razonamiento → herramientas →
 * respuesta → citas. Llama a `onUpdate` con la ejecución cada vez que cambia y
 * devuelve una función que la cancela.
 */
export function streamRun(question: string, model: string, onUpdate: (run: RunView) => void): () => void {
  const s = pickScript(question);
  let run = emptyRun(question, model);
  const started = Date.now();
  const timers: number[] = [];
  let at = 0;
  const step = (delay: number, change: (r: RunView) => RunView) => {
    at += delay;
    timers.push(window.setTimeout(() => {
      run = change(run);
      onUpdate(run);
    }, at));
  };

  onUpdate(run);
  step(350, (r) => ({ ...r, status: 'running', started_at: new Date().toISOString() }));

  const chunks = (text: string, size: number) => text.match(new RegExp(`[\\s\\S]{1,${size}}(?=\\s|$)`, 'g')) ?? [];
  for (const piece of chunks(s.thinking, 28)) {
    step(70, (r) => ({ ...r, thinking: (r.thinking ?? '') + piece }));
  }
  s.tools.forEach((tool, i) => {
    step(260, (r) => ({ ...r, tool_calls: [...(r.tool_calls ?? []), { ...tool, seq: i + 1, result_summary: null }] }));
    step(Math.min(tool.duration_ms ?? 200, 420), (r) => ({
      ...r,
      tool_calls: (r.tool_calls ?? []).map((t) => (t.seq === i + 1 ? { ...t, result_summary: tool.result_summary } : t)),
    }));
  });
  for (const piece of chunks(s.answer, 22)) {
    step(45, (r) => ({ ...r, answer: (r.answer ?? '') + piece }));
  }
  step(200, (r) => ({
    ...r,
    status: 'succeeded',
    citations: s.citations,
    attachments: s.attachments ?? [],
    advice: s.advice,
    finished_at: new Date().toISOString(),
    duration_s: Math.max(1, Math.round((Date.now() - started) / 1000)),
  }));

  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    if (run.status !== 'succeeded') onUpdate({ ...run, status: 'cancelled' });
  };
}
