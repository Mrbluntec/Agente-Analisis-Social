// Cálculos de analítica sobre los datos de muestra. Devuelven las mismas formas que el
// contrato (api/openapi.yaml). Los usan la web, como API simulada, y las herramientas
// del agente en el servidor. Cuando exista la base de datos, estas funciones se
// sustituyen por consultas y quienes las llaman no cambian.

import {
  ACTIVE_NETWORKS,
  ANNOTATIONS,
  BRAND,
  CREATIVE_READINGS,
  DAILY,
  DAYS,
  FOLLOWERS,
  LAST_DAY,
  POSTS,
  type ActiveNetwork,
  type SamplePost,
} from './sample';
import { addDays, fmtCompact, fmtInt, fmtPct, fmtSignedPct, inWords, median, sum } from './format';
import type { Alert, Annotation, BrandSummary, Briefing, Insight, Kpi, PostDetail, PostFormat, PostRow, Timeseries } from './types';

export type PeriodDays = 7 | 28;

export interface Scope {
  days: PeriodDays;
  /** Vacío = todas las redes conectadas. */
  networks: ActiveNetwork[];
}

const SAMPLE_RUN = '0c0ffee0-0000-4000-8000-0000000000f0';
const GENERATED_AT = '2026-10-05T07:02:00-05:00';

const nets = (scope: Scope) => (scope.networks.length ? scope.networks : [...ACTIVE_NETWORKS]);
const dateAt = (index: number) => addDays(LAST_DAY, index - (DAYS - 1));

function windows(days: PeriodDays) {
  const start = DAYS - days;
  return {
    start,
    prevStart: start - days,
    period: { from: dateAt(start), to: dateAt(DAYS - 1) },
    compare: { from: dateAt(start - days), to: dateAt(start - 1) },
  };
}

/** Serie diaria de una métrica sumando las redes del alcance pedido. */
function series(metric: 'reach' | 'interactions', scope: Scope): number[] {
  const selected = nets(scope);
  return Array.from({ length: DAYS }, (_, i) => sum(selected.map((n) => DAILY[n][metric][i])));
}

const slice = (values: number[], start: number, days: number) => sum(values.slice(start, start + days));
const weekly = (values: number[]) =>
  Array.from({ length: 12 }, (_, w) => slice(values, DAYS - 84 + w * 7, 7));

const insight = (text: string): Insight => ({ text, run_id: SAMPLE_RUN, generated_at: GENERATED_AT });

function postsIn(scope: Scope): SamplePost[] {
  const { period } = windows(scope.days);
  const selected = nets(scope);
  return POSTS.filter((p) => {
    const day = p.published_at.slice(0, 10);
    return selected.includes(p.network) && day >= period.from && day <= period.to;
  });
}

const interactionsOf = (p: SamplePost) => p.likes + p.comments + (p.shares ?? 0) + (p.saves ?? 0);

// ---------------------------------------------------------------------------
// Analítica
// ---------------------------------------------------------------------------

export function getBrandSummary(scope: Scope): BrandSummary {
  const w = windows(scope.days);
  const reach = series('reach', scope);
  const inter = series('interactions', scope);

  const reachNow = slice(reach, w.start, scope.days);
  const reachPrev = slice(reach, w.prevStart, scope.days);
  const interNow = slice(inter, w.start, scope.days);
  const interPrev = slice(inter, w.prevStart, scope.days);
  const rateNow = interNow / reachNow;
  const ratePrev = interPrev / reachPrev;

  const selected = nets(scope);
  const followers = sum(selected.map((n) => FOLLOWERS[n].total));
  const net = sum(selected.map((n) => (scope.days === 28 ? FOLLOWERS[n].net28 : FOLLOWERS[n].net7)));
  const weeklyNet = sum(selected.map((n) => FOLLOWERS[n].net28)) / 4;

  const reachWeeks = weekly(reach);
  const interWeeks = weekly(inter);

  const kpis: Kpi[] = [
    { metric: 'reach', value: reachNow, unit: 'count', previous: reachPrev, delta: reachNow / reachPrev - 1, delta_kind: 'relative', up_is_good: true, sparkline: reachWeeks },
    { metric: 'interactions', value: interNow, unit: 'count', previous: interPrev, delta: interNow / interPrev - 1, delta_kind: 'relative', up_is_good: true, sparkline: interWeeks },
    { metric: 'engagement_rate', value: rateNow, unit: 'percent', previous: ratePrev, delta: rateNow - ratePrev, delta_kind: 'points', up_is_good: true, sparkline: interWeeks.map((v, i) => v / reachWeeks[i]) },
    { metric: 'followers', value: followers, unit: 'count', previous: followers - net, delta: net, delta_kind: 'absolute', up_is_good: true, sparkline: Array.from({ length: 12 }, (_, i) => Math.round(followers - weeklyNet * (11 - i))) },
  ];

  const posts = postsIn(scope);
  const accountMedian = median(posts.map((p) => p.reach));
  const formats = [...new Set(posts.map((p) => p.format))];
  const format_index = formats
    .map((format) => {
      const group = posts.filter((p) => p.format === format);
      return { format, posts: group.length, index: accountMedian ? (median(group.map((p) => p.reach)) ?? 0) / accountMedian : 0 };
    })
    .sort((a, b) => b.index - a.index);

  const reachDelta = reachNow / reachPrev - 1;
  const ratePoints = rateNow - ratePrev;
  const verb = reachDelta >= 0 ? 'creció' : 'cayó';
  const pts = `${Math.abs(ratePoints * 100).toFixed(1).replace('.', ',')} puntos`;
  let text = `El alcance ${verb} ${fmtPct(Math.abs(reachDelta))}`;
  if (reachDelta >= 0 && ratePoints < -0.001) {
    text += `, pero la tasa de interacción cedió ${pts}: la cuenta llegó a gente nueva que todavía no interactúa.`;
  } else if (reachDelta >= 0) {
    text += ` y la tasa de interacción se mantuvo en ${fmtPct(rateNow)}.`;
  } else {
    text += ` frente al periodo anterior; la tasa de interacción quedó en ${fmtPct(rateNow)}.`;
  }

  return {
    period: w.period,
    compare_period: w.compare,
    insight: insight(text),
    kpis,
    by_network: selected
      .map((network) => {
        const now = slice(DAILY[network].reach, w.start, scope.days);
        const prev = slice(DAILY[network].reach, w.prevStart, scope.days);
        return { network, metric: 'reach', value: now, delta: now / prev - 1 };
      })
      .sort((a, b) => b.value - a.value),
    format_index,
    account_median_reach: accountMedian,
  };
}

export function getTimeseries(scope: Scope): Timeseries {
  const w = windows(scope.days);
  const reach = series('reach', scope);
  return {
    metric: 'reach',
    unit: 'count',
    granularity: 'day',
    points: Array.from({ length: scope.days }, (_, i) => ({
      date: dateAt(w.start + i),
      value: reach[w.start + i],
      previous_date: dateAt(w.prevStart + i),
      previous_value: reach[w.prevStart + i],
    })),
  };
}

export function listAnnotations(scope: Scope): Annotation[] {
  const { period } = windows(scope.days);
  return ANNOTATIONS.filter((a) => a.occurred_on >= period.from && a.occurred_on <= period.to);
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

const CURVE_HOURS = Array.from({ length: 13 }, (_, i) => i * 6);
const curveShape = (hours: number) => (1 - Math.exp(-hours / 22)) / (1 - Math.exp(-72 / 22));
/** Alcance acumulado a las 72 h como fracción del alcance a siete días. */
const AT_72H = 0.87;
const curve = (reach: number) => CURVE_HOURS.map((h) => Math.round(reach * AT_72H * curveShape(h)));

function toRow(p: SamplePost, accountMedian: number | null): PostRow {
  const metrics: Record<string, number> = { likes: p.likes, comments: p.comments };
  metrics[p.network === 'youtube' ? 'views' : 'reach'] = p.reach;
  if (p.shares !== null) metrics.shares = p.shares;
  if (p.saves !== null) metrics.saves = p.saves;
  return {
    id: p.id,
    network: p.network,
    format: p.format,
    published_at: p.published_at,
    title: p.title,
    permalink: null,
    thumbnail_url: null,
    pillar: p.pillar,
    metrics,
    engagement_rate: interactionsOf(p) / p.reach,
    vs_median: accountMedian ? p.reach / accountMedian : null,
    life_curve_72h: curve(p.reach),
  };
}

export type PostSort = 'reach' | 'engagement_rate' | 'saves' | 'published_at';

export interface PostFilters {
  format: PostFormat | '';
  pillar: string;
  sort: PostSort;
}

export interface PostList {
  items: PostRow[];
  total: number;
  account_median_reach: number | null;
  insight?: Insight;
  available_pillars: string[];
  available_formats: PostFormat[];
}

export function listPosts(scope: Scope, filters: PostFilters): PostList {
  const inScope = postsIn(scope);
  const accountMedian = median(inScope.map((p) => p.reach));
  const rows = inScope
    .filter((p) => (!filters.format || p.format === filters.format) && (!filters.pillar || p.pillar === filters.pillar))
    .map((p) => toRow(p, accountMedian));

  const key = (r: PostRow): number => {
    if (filters.sort === 'engagement_rate') return r.engagement_rate ?? -1;
    if (filters.sort === 'saves') return r.metrics.saves ?? -1;
    if (filters.sort === 'published_at') return Date.parse(r.published_at);
    return r.metrics.reach ?? r.metrics.views ?? 0;
  };
  rows.sort((a, b) => key(b) - key(a));

  // La lectura se redacta sobre todas las piezas del periodo, no sobre el filtro.
  let text = `${inScope.length} piezas en el periodo.`;
  if (accountMedian) {
    const top = inScope.filter((p) => p.reach >= accountMedian * 2);
    const samePillar = top.length > 1 && top.every((p) => p.pillar === top[0].pillar && p.format === top[0].format);
    if (top.length === 0) {
      text = `De ${inScope.length} piezas, ninguna duplica la mediana de la cuenta (${fmtInt(accountMedian)}).`;
    } else if (top.length === 1) {
      text = `De ${inScope.length} piezas, solo «${top[0].title}» duplica la mediana de la cuenta.`;
    } else if (samePillar) {
      text = `De ${inScope.length} piezas, ${inWords(top.length)} duplican la mediana de la cuenta, y las ${inWords(top.length)} son reels que muestran el proceso.`;
    } else {
      text = `De ${inScope.length} piezas, ${inWords(top.length)} duplican la mediana de la cuenta (${fmtInt(accountMedian)}).`;
    }
  }

  return {
    items: rows,
    total: inScope.length,
    account_median_reach: accountMedian,
    insight: insight(text),
    available_pillars: [...new Set(inScope.map((p) => p.pillar))].sort(),
    available_formats: [...new Set(inScope.map((p) => p.format))],
  };
}

export function getPost(id: string, scope: Scope): PostDetail | null {
  const p = POSTS.find((x) => x.id === id);
  if (!p) return null;
  const accountMedian = median(postsIn(scope).map((x) => x.reach));
  const points = (reach: number) => CURVE_HOURS.map((hours, i) => ({ hours, value: curve(reach)[i] }));
  const reading = CREATIVE_READINGS[p.id];
  return {
    ...toRow(p, accountMedian),
    caption: null,
    duration_seconds: p.duration_seconds,
    life_curve: {
      metric: p.network === 'youtube' ? 'views' : 'reach',
      points: points(p.reach),
      median_points: points(accountMedian ?? 0),
    },
    creative_reading: reading ? { items: reading, model: 'kimi-k3', run_id: SAMPLE_RUN } : null,
  };
}

// ---------------------------------------------------------------------------
// Briefing y alertas
// ---------------------------------------------------------------------------

export function getLatestBriefing(): Briefing {
  const week: Scope = { days: 7, networks: [] };
  const w = windows(7);
  const reach = series('reach', week);
  const inter = series('interactions', week);
  const reachNow = slice(reach, w.start, 7);
  const reachPrev = slice(reach, w.prevStart, 7);
  const interNow = slice(inter, w.start, 7);
  const interPrev = slice(inter, w.prevStart, 7);

  const month = postsIn({ days: 28, networks: [] });
  const processReels = month.filter((p) => p.format === 'reel' && p.pillar === 'Proceso');
  const rest = month.filter((p) => !processReels.includes(p));
  const weekReels = postsIn(week).filter((p) => p.format === 'reel' && p.pillar === 'Proceso');
  const weekReelReach = sum(weekReels.map((p) => p.reach));
  const share = weekReelReach / reachNow;

  return {
    id: '0c0ffee0-0000-4000-8000-0000000000b0',
    brand_id: BRAND.id,
    week_start: w.period.from,
    headline: `El alcance subió ${fmtPct(reachNow / reachPrev - 1, 0)} y el ${fmtPct(share, 0)} vino de ${inWords(weekReels.length)} reels sobre cómo se prepara el café.`,
    kpis: [
      { metric: 'reach', value: reachNow, unit: 'count', previous: reachPrev, delta: reachNow / reachPrev - 1, delta_kind: 'relative', up_is_good: true },
      { metric: 'interactions', value: interNow, unit: 'count', previous: interPrev, delta: interNow / interPrev - 1, delta_kind: 'relative', up_is_good: true },
      { metric: 'saves', value: 512, unit: 'count', previous: 391, delta: 512 / 391 - 1, delta_kind: 'relative', up_is_good: true },
      { metric: 'new_followers', value: 184, unit: 'count', previous: 151, delta: 184 / 151 - 1, delta_kind: 'relative', up_is_good: true },
    ],
    findings: [
      {
        title: 'Los reels de proceso rinden el doble que el resto.',
        evidence: `Mediana de alcance de ${fmtCompact(median(processReels.map((p) => p.reach)) ?? 0)} frente a ${fmtCompact(median(rest.map((p) => p.reach)) ?? 0)} en los últimos 28 días. Los ${inWords(weekReels.length)} de esta semana sumaron ${fmtCompact(weekReelReach)} de alcance.`,
        link: { view: 'posts' },
      },
      {
        title: 'Los guardados crecen cinco veces más rápido que los me gusta.',
        evidence: `Guardados ${fmtSignedPct(512 / 391 - 1, 0)}, me gusta +6 %. El carrusel de la receta de affogato concentra 268 guardados: la audiencia vuelve por contenido útil.`,
        link: { view: 'summary' },
      },
      {
        title: 'Las historias del jueves llegaron a un tercio menos de gente.',
        evidence: '2,05 K frente a los 3,1 K habituales. Se publicaron a las 21:00 y la franja que mejor funciona en esta cuenta es 18:30.',
        link: { view: 'agent_run' },
      },
    ],
    recommendation: 'Programe dos reels de proceso, martes y viernes a las 18:30, y convierta la receta más guardada en un segundo carrusel.',
    run_id: SAMPLE_RUN,
    created_at: GENERATED_AT,
  };
}

export function listAlerts(): Alert[] {
  return [
    {
      id: 'al1',
      severity: 'serious',
      network: 'instagram',
      metric: 'reach',
      occurred_on: '2026-10-01',
      title: 'Historias con 34 % menos alcance de lo habitual',
      diagnosis: 'Publicadas a las 21:00; la franja habitual es 18:30.',
      post_id: null,
      run_id: SAMPLE_RUN,
      acknowledged_at: null,
    },
    {
      id: 'al2',
      severity: 'warning',
      network: 'youtube',
      metric: 'views',
      occurred_on: '2026-10-01',
      title: 'El 44 % de la audiencia se va en los primeros 15 segundos',
      diagnosis: 'La cortinilla de entrada dura 9 segundos.',
      post_id: 'p05',
      run_id: null,
      acknowledged_at: null,
    },
  ];
}

