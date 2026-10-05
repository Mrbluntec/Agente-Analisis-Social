import type { ReactNode } from 'react';
import type { Insight, Kpi } from '../api/types';
import { fmtCompact, fmtPct, fmtSignedInt, fmtSignedPct, fmtSignedPoints } from '../lib/format';
import { Sparkline } from './charts';

const PATHS = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  chart: 'M3 20h18M6 20V10M12 20V4M18 20v-7',
  grid: 'M4 5h7v7H4zM13 5h7v4h-7zM13 12h7v7h-7zM4 15h7v4H4z',
  people: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.85M15 3.15a3.5 3.5 0 0 1 0 6.7',
  spark: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  doc: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h3l8 4V6l-8 4H4a1 1 0 0 0-1 1zM18 9a4 4 0 0 1 0 6',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  chevron: 'M8 10l4 4 4-4',
  sort: 'M8 10l4-4 4 4M8 14l4 4 4-4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16v.5',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  key: 'M14.5 9.5a4 4 0 1 0-3.9 4L9 15H7v2H5v2H3v-2.5l6.1-6.1a4 4 0 0 0 5.4-.9zM16.5 7.5h.01',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Frase de lectura del agente con la que abre cada vista. */
export function InsightLine({ insight, action }: { insight?: Insight; action?: ReactNode }) {
  if (!insight) return null;
  return (
    <section className="insight" aria-label="Lectura del agente">
      <span className="agent-tag"><span className="agent-mark" />Lectura del agente</span>
      <p className="lead">{insight.text}</p>
      {action}
    </section>
  );
}

const KPI_LABEL: Record<string, string> = {
  reach: 'Alcance',
  interactions: 'Interacciones',
  engagement_rate: 'Tasa de interacción sobre alcance',
  followers: 'Seguidores',
  saves: 'Guardados',
  new_followers: 'Seguidores nuevos',
};

export const kpiLabel = (metric: string) => KPI_LABEL[metric] ?? metric;

export function kpiValue(kpi: Kpi): string {
  return kpi.unit === 'percent' ? fmtPct(kpi.value) : fmtCompact(kpi.value);
}

function kpiDelta(kpi: Kpi): string | null {
  if (kpi.delta === null || kpi.delta === undefined) return null;
  if (kpi.delta_kind === 'points') return fmtSignedPoints(kpi.delta);
  if (kpi.delta_kind === 'absolute') return fmtSignedInt(kpi.delta);
  return fmtSignedPct(kpi.delta);
}

function kpiPrevious(kpi: Kpi): string | null {
  if (kpi.previous === null || kpi.previous === undefined) return null;
  if (kpi.delta_kind === 'absolute') return 'netos en el periodo';
  return `antes ${kpi.unit === 'percent' ? fmtPct(kpi.previous) : fmtCompact(kpi.previous)}`;
}

/** Variación con flecha y signo: el color nunca va solo. */
export function Delta({ kpi }: { kpi: Kpi }) {
  const text = kpiDelta(kpi);
  if (text === null || kpi.delta === null || kpi.delta === undefined) return null;
  const up = kpi.delta > 0;
  const flat = kpi.delta === 0;
  const good = (kpi.up_is_good ?? true) === up;
  return (
    <span className="delta">
      {!flat && <Icon name={up ? 'up' : 'down'} size={14} className={good ? 'delta-good' : 'delta-bad'} />}
      <b>{text}</b>
      <span className="muted">{kpiPrevious(kpi)}</span>
    </span>
  );
}

export function KpiTile({ kpi }: { kpi: Kpi }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{kpiLabel(kpi.metric)}</span>
      <div className="kpi-row">
        <span className="kpi-value">{kpiValue(kpi)}</span>
        {kpi.sparkline && <Sparkline values={kpi.sparkline} />}
      </div>
      <Delta kpi={kpi} />
    </div>
  );
}

export function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
