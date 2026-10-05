// Formato de cifras y fechas en español. Las cifras viajan sin formato desde la API.

const THIN = ' '; // espacio fino de no separación para miles
const NBSP = ' ';

const dec = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');
const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `−${text}` : text);

export function fmtInt(n: number): string {
  const s = Math.round(Math.abs(n)).toString();
  const grouped = s.length > 4 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, THIN) : s;
  return n < 0 ? `−${grouped}` : grouped;
}

/** 184 200 → «184,2 K», 9900 → «9,9 K»; por debajo de mil, el entero. */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${dec(n / 1_000_000, 1)}${NBSP}M`;
  if (Math.abs(n) >= 1000) return `${dec(n / 1000, 1)}${NBSP}K`;
  return fmtInt(n);
}

/** Etiqueta de eje: como fmtCompact pero sin el «,0» sobrante («10 K», «7,5 K»). */
export function fmtAxis(n: number): string {
  if (n === 0) return '0';
  return fmtCompact(n).replace(/,0(?=\D)/, '');
}

const WORDS = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
/** Cantidades pequeñas en palabra dentro de una frase: 2 → «dos». */
export const inWords = (n: number) => WORDS[n] ?? String(n);

/** 0.094 → «9,4 %» */
export function fmtPct(ratio: number, digits = 1): string {
  return `${dec(ratio * 100, digits)}${NBSP}%`;
}

/** 3.2 → «3,2×» */
export function fmtTimes(x: number): string {
  return `${dec(x, 1)}×`;
}

export function fmtSignedPct(ratio: number, digits = 1): string {
  return signed(ratio, `${dec(Math.abs(ratio) * 100, digits)}${NBSP}%`);
}

export function fmtSignedPoints(ratio: number): string {
  return signed(ratio, `${dec(Math.abs(ratio) * 100, 1)}${NBSP}pt`);
}

export function fmtSignedInt(n: number): string {
  return signed(n, fmtInt(Math.abs(n)));
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Partes de una fecha ISO sin pasar por la zona horaria del navegador. */
function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** «29 sep» */
export function fmtDay(iso: string): string {
  const { m, d } = parts(iso);
  return `${d}${NBSP}${MONTHS[m - 1]}`;
}

/** «Martes 29 sep» */
export function fmtWeekdayDay(iso: string): string {
  const { weekday } = parts(iso);
  const name = WEEKDAYS[weekday];
  return `${name[0].toUpperCase()}${name.slice(1)} ${fmtDay(iso)}`;
}

/** «mar 29 sep» */
export function fmtShortWeekdayDay(iso: string): string {
  return `${WEEKDAYS[parts(iso).weekday].slice(0, 3)} ${fmtDay(iso)}`;
}

/** «7 sep – 4 oct» */
export function fmtRange(from: string, to: string): string {
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

/** Hora local escrita en el propio instante ISO: «18:32». */
export function fmtTime(isoDateTime: string): string {
  return isoDateTime.slice(11, 16);
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
