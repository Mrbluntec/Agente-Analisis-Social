// Herramientas del agente. El modelo no calcula: pide las cifras a estas funciones, que
// leen del almacén (hoy, los datos de muestra) y devuelven datos más un resumen de una
// línea para enseñar en pantalla.

import { getBrandSummary, getLatestBriefing, getPost, getTimeseries, listAlerts, listPosts, type PostSort, type Scope } from '../../../../packages/core/src/analytics';
import { fmtCompact, fmtDay, fmtPct, fmtSignedPct, fmtTimes } from '../../../../packages/core/src/format';
import { ACTIVE_NETWORKS, STORIES_BY_HOUR, type ActiveNetwork } from '../../../../packages/core/src/sample';
import type { PostFormat, RunAttachment } from '../../../../packages/core/src/types';
import type { ToolDefinition } from '../ollama';

export interface ToolResult {
  data: unknown;
  summary: string;
  /** Gráfico que la herramienta adjunta a la respuesta final. */
  attachment?: RunAttachment;
}

/** Resultado de una herramienta ya ejecutada en esta ejecución, por su número. */
export interface PriorResult {
  seq: number;
  tool: string;
  data: unknown;
}

type Args = Record<string, unknown>;

const FORMATS: PostFormat[] = ['reel', 'carousel', 'image', 'story', 'video', 'short', 'text', 'link'];
const SORTS: PostSort[] = ['reach', 'engagement_rate', 'saves', 'published_at'];

// Los modelos a veces envían números como texto o valores fuera de rango: se normaliza
// todo aquí para que una llamada imperfecta dé un resultado útil y no un error.
function scopeOf(args: Args): Scope {
  const days = Number(args.days) === 7 ? 7 : 28;
  const raw = Array.isArray(args.networks) ? args.networks : [];
  const networks = raw.filter((n): n is ActiveNetwork => (ACTIVE_NETWORKS as readonly unknown[]).includes(n));
  return { days, networks };
}

const scopeProperties = {
  days: { type: 'integer', enum: [7, 28], description: 'Días del periodo, contados hasta el último día con datos. Por defecto 28.' },
  networks: { type: 'array', items: { type: 'string', enum: [...ACTIVE_NETWORKS] }, description: 'Redes a incluir. Sin este campo, todas.' },
};

interface Tool {
  definition: ToolDefinition;
  run: (args: Args, prior: PriorResult[]) => ToolResult;
}

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: Tool['run']): Tool => ({
  definition: { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } },
  run,
});

const TOOLS: Tool[] = [
  tool(
    'consultar_metricas',
    'Indicadores del periodo con su comparación frente al periodo anterior de igual duración: alcance, interacciones, tasa de interacción y seguidores, más el alcance por red.',
    scopeProperties,
    [],
    (args) => {
      const s = getBrandSummary(scopeOf(args));
      const reach = s.kpis.find((k) => k.metric === 'reach')!;
      const rate = s.kpis.find((k) => k.metric === 'engagement_rate')!;
      return {
        data: { period: s.period, compare_period: s.compare_period, kpis: s.kpis.map(({ sparkline: _s, ...k }) => k), by_network: s.by_network },
        summary: `Alcance ${fmtCompact(reach.value)} (${fmtSignedPct(reach.delta ?? 0)}); tasa de interacción ${fmtPct(rate.value)}.`,
      };
    },
  ),
  tool(
    'serie_diaria',
    'Alcance día a día del periodo y del periodo anterior, alineados. Sirve para localizar picos y caídas en fechas concretas.',
    scopeProperties,
    [],
    (args) => {
      const t = getTimeseries(scopeOf(args));
      const peak = t.points.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
      return {
        data: t.points,
        summary: `Alcance diario de ${t.points.length} días; máximo ${fmtCompact(peak.value ?? 0)} el ${fmtDay(peak.date)}.`,
      };
    },
  ),
  tool(
    'contenido_destacado',
    'Publicaciones del periodo con alcance, tasa de interacción, guardados y relación con la mediana de la cuenta. Admite filtro por formato y pilar, y orden.',
    {
      ...scopeProperties,
      format: { type: 'string', enum: FORMATS, description: 'Formato de la pieza.' },
      pillar: { type: 'string', description: 'Pilar de contenido, por ejemplo Proceso, Recetas, Producto, Equipo.' },
      sort: { type: 'string', enum: SORTS, description: 'Orden descendente. Por defecto reach.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de piezas. Por defecto 8.' },
    },
    [],
    (args) => {
      const format = FORMATS.includes(args.format as PostFormat) ? (args.format as PostFormat) : '';
      const sort = SORTS.includes(args.sort as PostSort) ? (args.sort as PostSort) : 'reach';
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
      const list = listPosts(scopeOf(args), { format, pillar: typeof args.pillar === 'string' ? args.pillar : '', sort });
      const items = list.items.slice(0, limit).map((p) => ({
        id: p.id,
        title: p.title,
        network: p.network,
        format: p.format,
        pillar: p.pillar,
        published_at: p.published_at,
        metrics: p.metrics,
        engagement_rate: p.engagement_rate,
        vs_median: p.vs_median,
      }));
      const first = list.items[0];
      return {
        data: { total_in_period: list.total, matching: list.items.length, account_median_reach: list.account_median_reach, pillars: list.available_pillars, items },
        summary: first
          ? `${list.items.length} piezas; la primera es «${first.title}» con ${fmtCompact(first.metrics.reach ?? first.metrics.views ?? 0)}${first.vs_median ? `, ${fmtTimes(first.vs_median)} la mediana` : ''}.`
          : 'Ninguna pieza coincide con esos filtros.',
      };
    },
  ),
  tool(
    'detalle_pieza',
    'Detalle de una publicación por su id: métricas, curva de vida acumulada en 72 horas frente a la mediana de la cuenta y lectura creativa si existe.',
    { post_id: { type: 'string', description: 'Identificador de la pieza, tal como lo devuelve contenido_destacado.' } },
    ['post_id'],
    (args) => {
      const post = getPost(String(args.post_id ?? ''), { days: 28, networks: [] });
      if (!post) return { data: { error: 'No existe una pieza con ese id.' }, summary: 'No existe una pieza con ese id.' };
      const at24 = post.life_curve.points.find((p) => p.hours === 24)?.value ?? 0;
      return { data: post, summary: `«${post.title}»: ${fmtCompact(at24)} a las 24 horas.` };
    },
  ),
  tool(
    'indice_formatos',
    'Rendimiento relativo de cada formato: alcance mediano del formato dividido entre la mediana de la cuenta, con el número de piezas de cada uno.',
    scopeProperties,
    [],
    (args) => {
      const s = getBrandSummary(scopeOf(args));
      const best = s.format_index[0];
      return {
        data: { account_median_reach: s.account_median_reach, formats: s.format_index },
        summary: best ? `${s.format_index.length} formatos; el mejor es ${best.format} con ${fmtTimes(best.index)} la mediana.` : 'No hay piezas en el periodo.',
      };
    },
  ),
  tool(
    'historias_por_franja',
    'Alcance medio de las historias de Instagram según su hora de publicación en las últimas ocho semanas, con el detalle del jueves 1 de octubre.',
    {},
    [],
    () => ({
      data: {
        network: 'instagram',
        period: { from: '2026-08-10', to: '2026-10-04' },
        stories: 142,
        by_publish_hour: STORIES_BY_HOUR.map((s) => ({ hour: s.hour, mean_reach: s.reach })),
        thursday_2026_10_01: { publish_hour: '21:00', stories: 4, mean_reach: 2050, usual_thursday_mean_reach: 3100, usual_thursday_stories: 4 },
      },
      summary: 'Alcance de 142 historias según su hora de publicación, ocho semanas.',
    }),
  ),
  tool('alertas', 'Alertas abiertas de la marca con su diagnóstico.', {}, [], () => {
    const alerts = listAlerts();
    return { data: alerts, summary: `${alerts.length} alertas abiertas.` };
  }),
  tool('briefing_semanal', 'Último briefing semanal: titular, indicadores de la semana, hallazgos y recomendación.', {}, [], () => {
    const b = getLatestBriefing();
    return { data: b, summary: `Briefing de la semana del ${fmtDay(b.week_start)}.` };
  }),
];

// Gráficos que se pueden construir, por herramienta de origen. El modelo nunca escribe los
// puntos: salen del resultado de la herramienta citada, así que cada cifra sigue siendo trazable.
type Points = RunAttachment['points'];
const CHART_SOURCES: Record<string, { unit?: RunAttachment['unit']; points: (data: any) => Points }> = {
  consultar_metricas: { unit: 'count', points: (d) => (d.by_network as { network: string; value: number }[]).map((n) => ({ label: n.network, value: n.value })) },
  indice_formatos: { points: (d) => (d.formats as { format: string; index: number }[]).map((f, i) => ({ label: f.format, value: Number(f.index.toFixed(2)), highlight: i === 0 })) },
  historias_por_franja: { unit: 'count', points: (d) => (d.by_publish_hour as { hour: string; mean_reach: number }[]).map((h) => ({ label: h.hour, value: h.mean_reach })) },
};

TOOLS.push(
  tool(
    'adjuntar_grafico',
    `Adjunta a la respuesta un gráfico de columnas hecho con los datos de una herramienta que ya llamó. Úsela una vez, solo cuando el gráfico aclare la conclusión. Fuentes admitidas: ${Object.keys(CHART_SOURCES).join(', ')}.`,
    {
      fuente: { type: 'integer', minimum: 1, description: 'El «herramienta_numero» de la herramienta cuyos datos se grafican.' },
      titulo: { type: 'string', description: 'Título del gráfico, en una frase.' },
    },
    ['fuente', 'titulo'],
    (args, prior) => {
      const source = prior.find((p) => p.seq === Number(args.fuente));
      if (!source) return { data: { error: 'No hay una herramienta con ese número en esta conversación.' }, summary: 'La fuente del gráfico no existe.' };
      const spec = CHART_SOURCES[source.tool];
      if (!spec) return { data: { error: `Esa herramienta no se puede graficar. Admitidas: ${Object.keys(CHART_SOURCES).join(', ')}.` }, summary: `${source.tool} no se puede graficar.` };
      const points = spec.points(source.data);
      if (points.length === 0) return { data: { error: 'La fuente no trae datos que graficar.' }, summary: 'La fuente no trae datos.' };
      const title = typeof args.titulo === 'string' && args.titulo.trim() ? args.titulo.trim().slice(0, 120) : 'Gráfico';
      return {
        data: { ok: true, puntos: points.length },
        summary: `Gráfico «${title}» con ${points.length} columnas, de la herramienta ${source.seq}.`,
        attachment: { kind: 'columns', title, unit: spec.unit, ref: source.seq, points },
      };
    },
  ),
);

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((t) => t.definition);

export function runTool(name: string, args: Args, prior: PriorResult[] = []): ToolResult {
  const found = TOOLS.find((t) => t.definition.function.name === name);
  if (!found) {
    const known = TOOLS.map((t) => t.definition.function.name).join(', ');
    return { data: { error: `No existe la herramienta ${name}. Disponibles: ${known}.` }, summary: `Herramienta desconocida: ${name}.` };
  }
  try {
    return found.run(args ?? {}, prior);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { data: { error: message }, summary: `La herramienta falló: ${message}` };
  }
}
