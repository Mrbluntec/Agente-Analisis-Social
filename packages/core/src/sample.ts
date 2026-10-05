// Datos de muestra de una marca ficticia. Ninguna cifra pertenece a un cliente real.
// Todo lo que la interfaz enseña se calcula a partir de este archivo, de modo que
// los totales, las variaciones y las frases de lectura no pueden contradecirse.

import type { Network, PostFormat } from './types';

export const BRAND = {
  id: '0c0ffee0-0000-4000-8000-000000000001',
  org_id: '0c0ffee0-0000-4000-8000-0000000000a1',
  name: 'Café Manglar',
  slug: 'cafe-manglar',
  timezone: 'America/Guayaquil',
  networks: ['instagram', 'facebook', 'youtube'] as Network[],
};

/** Último día con datos; «hoy» en la muestra es el lunes 5 de octubre de 2026. */
export const LAST_DAY = '2026-10-04';
export const TODAY = '2026-10-05';

// Alcance diario total en miles: 28 días actuales (7 sep – 4 oct) y los 28 anteriores.
const CURRENT_K = [
  5.6, 5.9, 6.4, 7.2, 6.1, 6.6, 5.4, 5.8, 6.3, 6.9, 7.4, 6.2, 6.5, 5.3,
  5.7, 6.2, 6.8, 7.3, 6.0, 6.7, 5.6, 6.1, 8.9, 7.6, 9.4, 7.8, 6.9, 5.6,
];
const PREVIOUS_K = [
  5.0, 5.3, 5.8, 6.3, 5.5, 5.9, 4.9, 5.1, 5.5, 5.9, 6.4, 5.4, 5.8, 4.8,
  5.2, 5.4, 6.0, 6.5, 5.5, 6.0, 4.9, 5.1, 5.5, 5.9, 6.4, 5.4, 5.6, 4.6,
];
const OLDER_K = PREVIOUS_K.map((v) => Math.round(v * 0.93 * 10) / 10);

/** 84 días de alcance total, del más antiguo al más reciente. */
const TOTAL_REACH = [...OLDER_K, ...PREVIOUS_K, ...CURRENT_K].map((k) => Math.round(k * 1000));
export const DAYS = TOTAL_REACH.length;

type Split = Record<'instagram' | 'facebook' | 'youtube', number>;
const SHARE_BEFORE: Split = { instagram: 0.627, facebook: 0.24, youtube: 0.133 };
const SHARE_NOW: Split = { instagram: 0.659, facebook: 0.211, youtube: 0.13 };
const RATE_BEFORE: Split = { instagram: 0.092, facebook: 0.037, youtube: 0.058 };
const RATE_NOW: Split = { instagram: 0.082, facebook: 0.035, youtube: 0.055 };

const isNow = (dayIndex: number) => dayIndex >= DAYS - 28;

function split(network: keyof Split, table: (i: number) => Split, source: (i: number) => number): number[] {
  return TOTAL_REACH.map((_, i) => Math.round(source(i) * table(i)[network]));
}

export const ACTIVE_NETWORKS = ['instagram', 'facebook', 'youtube'] as const;
export type ActiveNetwork = (typeof ACTIVE_NETWORKS)[number];

/** Alcance e interacciones diarias por red, 84 días. */
export const DAILY: Record<ActiveNetwork, { reach: number[]; interactions: number[] }> = (() => {
  const out = {} as Record<ActiveNetwork, { reach: number[]; interactions: number[] }>;
  for (const n of ACTIVE_NETWORKS) {
    const reach = split(n, (i) => (isNow(i) ? SHARE_NOW : SHARE_BEFORE), (i) => TOTAL_REACH[i]);
    const interactions = reach.map((r, i) => Math.round(r * (isNow(i) ? RATE_NOW : RATE_BEFORE)[n]));
    out[n] = { reach, interactions };
  }
  return out;
})();

/** Seguidores al cierre del periodo y altas netas de los últimos 28 y 7 días. */
export const FOLLOWERS: Record<ActiveNetwork, { total: number; net28: number; net7: number }> = {
  instagram: { total: 18940, net28: 512, net7: 151 },
  facebook: { total: 3870, net28: 41, net7: 9 },
  youtube: { total: 1508, net28: 59, net7: 24 },
};

export const ANNOTATIONS = [
  { id: 'a1', occurred_on: '2026-09-29', label: 'Reel «Cold brew de naranjilla»', post_id: 'p01' },
  { id: 'a2', occurred_on: '2026-10-01', label: 'Campaña Día del Café', post_id: null },
];

export interface SamplePost {
  id: string;
  network: ActiveNetwork;
  format: PostFormat;
  published_at: string;
  title: string;
  pillar: string;
  duration_seconds: number | null;
  /** Alcance en Instagram y Facebook; vistas en YouTube. */
  reach: number;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
}

export const POSTS: SamplePost[] = [
  { id: 'p01', network: 'instagram', format: 'reel', published_at: '2026-09-29T18:32:00-05:00', title: 'Cold brew de naranjilla, paso a paso', pillar: 'Proceso', duration_seconds: 21, reach: 14800, likes: 815, comments: 77, shares: 187, saves: 312 },
  { id: 'p02', network: 'instagram', format: 'reel', published_at: '2026-09-17T18:30:00-05:00', title: 'Tueste de la semana: Loja', pillar: 'Proceso', duration_seconds: 28, reach: 9900, likes: 560, comments: 41, shares: 55, saves: 96 },
  { id: 'p03', network: 'instagram', format: 'reel', published_at: '2026-10-01T18:30:00-05:00', title: 'Cómo catamos un lote nuevo', pillar: 'Proceso', duration_seconds: 34, reach: 9600, likes: 540, comments: 48, shares: 49, saves: 141 },
  { id: 'p04', network: 'instagram', format: 'carousel', published_at: '2026-09-24T12:05:00-05:00', title: 'Receta: affogato de la casa', pillar: 'Recetas', duration_seconds: null, reach: 7900, likes: 352, comments: 29, shares: 46, saves: 268 },
  { id: 'p05', network: 'youtube', format: 'video', published_at: '2026-10-01T10:00:00-05:00', title: 'Día Internacional del Café', pillar: 'Marca', duration_seconds: 252, reach: 6200, likes: 290, comments: 39, shares: null, saves: null },
  { id: 'p06', network: 'instagram', format: 'reel', published_at: '2026-09-10T18:35:00-05:00', title: 'Conoce a Daniela, nuestra barista', pillar: 'Equipo', duration_seconds: 19, reach: 5400, likes: 262, comments: 33, shares: 21, saves: 58 },
  { id: 'p07', network: 'instagram', format: 'carousel', published_at: '2026-09-14T12:10:00-05:00', title: 'Tres métodos para preparar en casa', pillar: 'Recetas', duration_seconds: null, reach: 5200, likes: 268, comments: 17, shares: 31, saves: 149 },
  { id: 'p08', network: 'instagram', format: 'reel', published_at: '2026-09-20T18:40:00-05:00', title: 'Flat white en cámara lenta', pillar: 'Producto', duration_seconds: 12, reach: 4700, likes: 228, comments: 15, shares: 12, saves: 31 },
  { id: 'p09', network: 'youtube', format: 'short', published_at: '2026-09-12T10:00:00-05:00', title: 'Molienda en 30 segundos', pillar: 'Proceso', duration_seconds: 30, reach: 4500, likes: 198, comments: 11, shares: null, saves: null },
  { id: 'p10', network: 'facebook', format: 'video', published_at: '2026-09-18T17:00:00-05:00', title: 'Así llega el café de Loja', pillar: 'Proceso', duration_seconds: 95, reach: 4300, likes: 96, comments: 14, shares: 22, saves: null },
  { id: 'p11', network: 'instagram', format: 'image', published_at: '2026-09-28T10:00:00-05:00', title: 'Cumplimos tres años', pillar: 'Equipo', duration_seconds: null, reach: 4100, likes: 233, comments: 41, shares: 9, saves: 12 },
  { id: 'p12', network: 'instagram', format: 'image', published_at: '2026-09-08T11:30:00-05:00', title: 'Nuevo: tónica de cáscara', pillar: 'Producto', duration_seconds: null, reach: 3900, likes: 141, comments: 12, shares: 6, saves: 19 },
  { id: 'p13', network: 'facebook', format: 'image', published_at: '2026-09-26T09:15:00-05:00', title: 'Nuevo horario de fin de semana', pillar: 'Avisos', duration_seconds: null, reach: 3100, likes: 52, comments: 9, shares: 7, saves: null },
  { id: 'p14', network: 'instagram', format: 'image', published_at: '2026-09-22T11:40:00-05:00', title: 'Promo 2×1 en espresso tonic', pillar: 'Promoción', duration_seconds: null, reach: 2800, likes: 54, comments: 6, shares: 3, saves: 21 },
];

/** Lectura creativa de muestra para las piezas que la tienen. */
export const CREATIVE_READINGS: Record<string, { aspect: string; text: string }[]> = {
  p01: [
    { aspect: 'Gancho', text: 'El vertido aparece en el primer segundo, sin cortinilla ni logo.' },
    { aspect: 'Texto', text: 'Tres rótulos cortos que nombran cada paso; se entiende sin sonido.' },
    { aspect: 'Ritmo', text: 'Siete planos en 21 segundos; ninguno supera los cuatro.' },
  ],
  p03: [
    { aspect: 'Gancho', text: 'Abre con la cuchara rompiendo la costra; el sonido hace el trabajo.' },
    { aspect: 'Texto', text: 'Un solo rótulo al inicio; el resto depende de la voz.' },
    { aspect: 'Ritmo', text: 'Planos largos, de seis a ocho segundos; pierde ritmo a mitad.' },
  ],
  p05: [
    { aspect: 'Gancho', text: 'Nueve segundos de cortinilla antes de la primera imagen del café.' },
    { aspect: 'Texto', text: 'Rótulos legibles, pero aparecen después del segundo quince.' },
    { aspect: 'Ritmo', text: 'Montaje pausado, propio de un video largo.' },
  ],
};

/** Alcance medio de una historia según su hora de publicación; ocho semanas, 142 historias. */
export const STORIES_BY_HOUR = [
  { hour: '12:00', reach: 1900, note: '' },
  { hour: '15:00', reach: 2200, note: '' },
  { hour: '18:30', reach: 3100, note: 'habitual' },
  { hour: '21:00', reach: 2000, note: 'jueves 1 oct' },
];

/** Otras marcas de la cartera, para la lista de Inicio. */
export const PORTFOLIO = [
  { id: 'b2', initials: 'FE', name: 'Ferretería El Estero', headline: 'Semana estable. El video sobre taladros sostiene el 41 % de las vistas de YouTube.', reach: 31700, delta: 0.02 },
  { id: 'b3', initials: 'CD', name: 'Clínica Dental Samborondón', headline: 'El alcance cayó 12 % tras siete días sin publicar reels.', reach: 18900, delta: -0.12 },
];
