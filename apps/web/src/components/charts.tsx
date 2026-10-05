import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** Ancho real del contenedor, para dibujar el SVG a escala 1:1 y que el texto no se deforme. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Escala «redonda»: el paso es 1, 2, 2,5 o 5 por una potencia de diez. */
function niceScale(max: number, intervals = 4) {
  if (max <= 0) return { step: 1, top: intervals };
  const raw = max / intervals;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((c) => c * pow).find((c) => c >= raw) ?? 10 * pow;
  return { step, top: step * intervals };
}

export interface ChartSeries {
  name: string;
  /** Variable CSS del color de la serie, por ejemplo `var(--series-1)`. */
  color: string;
  values: (number | null)[];
  area?: boolean;
}

interface LineChartProps {
  series: ChartSeries[];
  /** Título del tooltip para cada punto. */
  labels: string[];
  ticks: { index: number; label: string }[];
  /** Marcas verticales numeradas (anotaciones); su texto se lista fuera del gráfico. */
  marks?: { index: number; number: number }[];
  format: (n: number) => string;
  /** Formato de las etiquetas del eje; por defecto, el mismo que el de los valores. */
  formatTick?: (n: number) => string;
  ariaLabel: string;
  height?: number;
  /** Rotula el último valor de cada serie junto a su punto final. */
  endLabels?: boolean;
}

export function LineChart({ series, labels, ticks, marks = [], format, formatTick = format, ariaLabel, height = 260, endLabels = false }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<number | null>(null);
  const tipId = useId();

  const n = labels.length;
  const m = { l: 48, r: endLabels ? 56 : 14, t: marks.length ? 26 : 12, b: 28 };
  const plotW = width - m.l - m.r;
  const plotH = height - m.t - m.b;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const { step, top } = niceScale(Math.max(...all, 0));
  const x = (i: number) => m.l + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const y = (v: number) => m.t + plotH - (v / top) * plotH;
  const base = m.t + plotH;

  const path = (values: (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const nearest = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left - m.l) / plotW;
    return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setHover(nearest(e.clientX, e.currentTarget));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    setHover((h) => {
      const from = h ?? n - 1;
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return n - 1;
      return Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };

  const yTicks = Array.from({ length: 5 }, (_, i) => i * step);
  // En pantallas estrechas las etiquetas del eje se pisan: una etiqueta solo se muestra si
  // queda a 64 px o más de la anterior, y la última siempre gana a su vecina.
  const lastTick = ticks[ticks.length - 1];
  const shownTicks = ticks.reduce<typeof ticks>((kept, t) => {
    const prev = kept[kept.length - 1];
    if (!prev) return [t];
    if (t === lastTick) {
      const clear = kept.filter((k, i) => i === 0 || x(t.index) - x(k.index) >= 64);
      return [...clear, t];
    }
    return x(t.index) - x(prev.index) >= 64 ? [...kept, t] : kept;
  }, []);
  const flip = hover !== null && x(hover) > width / 2;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={hover !== null ? tipId : undefined}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? n - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'chart-axis' : 'chart-grid'} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" className="chart-tick">{formatTick(v)}</text>
          </g>
        ))}
        {shownTicks.map((t, i) => (
          <text
            key={t.index}
            x={x(t.index)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : t.index === n - 1 ? 'end' : 'middle'}
            className="chart-tick"
          >
            {t.label}
          </text>
        ))}
        {marks.map((mark) => (
          <g key={mark.number}>
            <line x1={x(mark.index)} x2={x(mark.index)} y1={m.t} y2={base} className="chart-mark" />
            <circle cx={x(mark.index)} cy={11} r={9} className="chart-mark-dot" />
            <text x={x(mark.index)} y={15} textAnchor="middle" className="chart-mark-num">{mark.number}</text>
          </g>
        ))}
        {series.filter((s) => s.area).map((s) => (
          <path key={`area-${s.name}`} d={`${path(s.values)} L${x(n - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`} fill={s.color} fillOpacity={0.1} stroke="none" />
        ))}
        {[...series].reverse().map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {endLabels &&
          series.map((s) => {
            const last = s.values[n - 1];
            if (last === null || last === undefined) return null;
            return (
              <g key={`end-${s.name}`}>
                <circle cx={x(n - 1)} cy={y(last)} r={4.5} fill={s.color} className="chart-dot" />
                <text x={x(n - 1) + 9} y={y(last) + 4} className="chart-end">{format(last)}</text>
              </g>
            );
          })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={base} className="chart-cross" />
            {series.map((s) => {
              const v = s.values[hover];
              return v === null || v === undefined ? null : (
                <circle key={s.name} cx={x(hover)} cy={y(v)} r={4.5} fill={s.color} className="chart-dot" />
              );
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          id={tipId}
          role="status"
          className="chart-tip"
          style={flip ? { right: width - x(hover) + 12, top: m.t } : { left: x(hover) + 12, top: m.t }}
        >
          <span className="chart-tip-title">{labels[hover]}</span>
          {series.map((s) => {
            const v = s.values[hover];
            return (
              <span key={s.name} className="chart-tip-row">
                <span className="key-line" style={{ background: s.color }} />
                <span>{s.name}</span>
                <b>{v === null || v === undefined ? 'sin dato' : format(v)}</b>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span key={item.name} className="legend-item">
          <span className="key-line" style={{ background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

/** Tendencia en gris con el último punto en el color de la serie. */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const px = (i: number) => 3 + (i * (width - 8)) / (values.length - 1);
  const py = (v: number) => height - 5 - ((v - lo) / span) * (height - 10);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden="true" className="spark">
      <path d={d} fill="none" stroke="var(--ink-muted)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={px(last)} cy={py(values[last])} r={3.5} fill="var(--series-1)" className="chart-dot" />
    </svg>
  );
}

/** Dos líneas en miniatura para una fila de tabla: la pieza y la mediana de la cuenta. */
export function MiniCurve({ values, reference, top }: { values: number[]; reference: number[]; top: number }) {
  const w = 76;
  const h = 22;
  const px = (i: number) => 2 + (i * (w - 4)) / (values.length - 1);
  const py = (v: number) => h - 2 - (v / (top || 1)) * (h - 4);
  const d = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={d(reference)} fill="none" stroke="var(--series-compare)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d(values)} fill="none" stroke="var(--series-1)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface BarRow {
  key: string;
  label: string;
  note?: string;
  value: number;
  display: string;
  detail?: string;
}

/** Barras horizontales de una sola serie, con línea de referencia opcional. */
export function BarList({ rows, max, reference }: { rows: BarRow[]; max?: number; reference?: { value: number; label: string } }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), reference?.value ?? 0);
  const pct = (v: number) => `${Math.min(100, (v / (top || 1)) * 100)}%`;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.key} className="bar-row" title={`${r.label}: ${r.display}${r.detail ? ` (${r.detail})` : ''}`}>
          <span className="bar-head">
            <span>
              {r.label}
              {r.note && <span className="muted"> · {r.note}</span>}
            </span>
            <span className="bar-value">
              {r.display}
              {r.detail && <span className="muted"> {r.detail}</span>}
            </span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: pct(r.value) }} />
            {reference && <span className="bar-ref" style={{ left: pct(reference.value) }} />}
          </span>
        </div>
      ))}
      {reference && (
        <span className="bar-ref-row" aria-hidden="true">
          <span className="bar-ref-label" style={{ left: pct(reference.value) }}>{reference.label}</span>
        </span>
      )}
    </div>
  );
}

/** Columnas para pocas categorías, con una resaltada y el resto en gris. */
export function Columns({ items, format }: { items: { key: string; label: string; note?: string; value: number; emphasis?: boolean }[]; format: (n: number) => string }) {
  const top = Math.max(...items.map((i) => i.value));
  return (
    <div className="cols" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div key={item.key} className="col" title={`${item.label}: ${format(item.value)}`}>
          <span className={item.emphasis ? 'col-value strong' : 'col-value'}>{format(item.value)}</span>
          <span className={item.emphasis ? 'col-bar col-bar-on' : 'col-bar'} style={{ height: `${Math.round((item.value / top) * 124)}px` }} />
          <span className={item.emphasis ? 'col-label strong' : 'col-label'}>
            {item.label}
            {item.note && <span className="muted"> · {item.note}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
