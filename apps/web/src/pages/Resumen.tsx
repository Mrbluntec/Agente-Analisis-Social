import { useState } from 'react';
import { getBrandSummary, getTimeseries, listAnnotations, listPosts, type Scope } from '../api/mock';
import { FORMAT_LABEL, FORMAT_TAG, NETWORK_LABEL } from '../api/types';
import { BarList, Legend, LineChart } from '../components/charts';
import { InsightLine, KpiTile } from '../components/ui';
import { fmtAxis, fmtCompact, fmtDay, fmtInt, fmtRange, fmtSignedPct, fmtTimes, fmtWeekdayDay } from '../lib/format';

export function Resumen({ scope }: { scope: Scope }) {
  const [asTable, setAsTable] = useState(false);
  const summary = getBrandSummary(scope);
  const series = getTimeseries(scope);
  const annotations = listAnnotations(scope);
  const best = listPosts(scope, { format: '', pillar: '', sort: 'reach' });

  const points = series.points;
  const currentName = fmtRange(summary.period.from, summary.period.to);
  const previousName = summary.compare_period ? fmtRange(summary.compare_period.from, summary.compare_period.to) : 'Anterior';
  const chartSeries = [
    { name: currentName, color: 'var(--series-1)', values: points.map((p) => p.value), area: true },
    { name: previousName, color: 'var(--series-compare)', values: points.map((p) => p.previous_value ?? null) },
  ];
  const tickEvery = points.length > 14 ? 7 : 1;
  const ticks = points
    .map((p, index) => ({ index, label: fmtDay(p.date) }))
    .filter((t) => t.index % tickEvery === 0 || t.index === points.length - 1)
    // Evita que la penúltima etiqueta se monte sobre la última.
    .filter((t) => t.index === points.length - 1 || points.length - 1 - t.index >= Math.ceil(tickEvery / 2));
  const marks = annotations
    .map((a, i) => ({ index: points.findIndex((p) => p.date === a.occurred_on), number: i + 1 }))
    .filter((m) => m.index >= 0);

  return (
    <div className="stack-xl">
      <InsightLine insight={summary.insight} action={<a className="link" href="#agente">Preguntar sobre esto</a>} />

      <div className="kpis">
        {summary.kpis.map((kpi) => <KpiTile key={kpi.metric} kpi={kpi} />)}
      </div>

      <div className="split">
        <section className="card panel split-main">
          <div className="panel-head">
            <div className="stack">
              <h2 className="heading">Alcance diario</h2>
              <span className="secondary">Cuentas alcanzadas por día, sumando las redes seleccionadas</span>
            </div>
            <button type="button" className="btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? 'Ver gráfico' : 'Ver tabla'}
            </button>
          </div>
          {asTable ? (
            <div className="table-wrap table-short">
              <table className="table">
                <thead>
                  <tr><th scope="col">Día</th><th scope="col" className="num">Actual</th><th scope="col">Día anterior</th><th scope="col" className="num">Anterior</th></tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.date}>
                      <td>{fmtWeekdayDay(p.date)}</td>
                      <td className="num">{p.value === null ? 'sin dato' : fmtCompact(p.value)}</td>
                      <td className="muted">{p.previous_date ? fmtDay(p.previous_date) : ''}</td>
                      <td className="num">{p.previous_value === null || p.previous_value === undefined ? '' : fmtCompact(p.previous_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <Legend items={chartSeries} />
              <LineChart
                series={chartSeries}
                labels={points.map((p) => fmtWeekdayDay(p.date))}
                ticks={ticks}
                marks={marks}
                format={fmtCompact}
                formatTick={fmtAxis}
                ariaLabel={`Alcance diario del ${currentName} frente al ${previousName}. Use las flechas para recorrer los días.`}
              />
            </>
          )}
          <div className="notes">
            <span className="muted">Anotaciones</span>
            {annotations.length === 0 && <span className="secondary">Ninguna en este periodo.</span>}
            {annotations.map((a, i) => (
              <span key={a.id} className="note"><span className="note-num mono">{i + 1}</span>{fmtDay(a.occurred_on)} · {a.label}</span>
            ))}
          </div>
        </section>

        <section className="card panel split-side">
          <div className="stack">
            <h2 className="heading">Alcance por red</h2>
            <span className="secondary">Suma del periodo y cambio</span>
          </div>
          <BarList
            rows={summary.by_network.map((n) => ({
              key: n.network,
              label: NETWORK_LABEL[n.network],
              value: n.value,
              display: fmtCompact(n.value),
              detail: n.delta === null || n.delta === undefined ? undefined : fmtSignedPct(n.delta, 0),
            }))}
          />
          <p className="caption muted foot">El alcance no se deduplica entre redes: quien ve la marca en dos cuenta dos veces. En YouTube se usan vistas.</p>
        </section>
      </div>

      <div className="split split-even">
        <section className="card panel">
          <div className="stack">
            <h2 className="heading">Índice de formato</h2>
            <span className="secondary">Alcance mediano de cada formato frente a la mediana de la cuenta</span>
          </div>
          {summary.format_index.length === 0 ? (
            <p className="secondary">No hay piezas en este periodo.</p>
          ) : (
            <BarList
              max={Math.max(2, ...summary.format_index.map((f) => f.index))}
              reference={{ value: 1, label: `1× · mediana de ${fmtInt(summary.account_median_reach ?? 0)}` }}
              rows={summary.format_index.map((f) => ({ key: f.format, label: FORMAT_LABEL[f.format], note: String(f.posts), value: f.index, display: fmtTimes(f.index) }))}
            />
          )}
          <p className="caption muted foot">El número junto a cada formato es la cantidad de piezas. Las historias se miden aparte porque caducan a las 24 horas.</p>
        </section>

        <section className="card panel">
          <div className="panel-head">
            <h2 className="heading">Mejores piezas</h2>
            <a className="link" href="#contenido">Ver las {best.total}</a>
          </div>
          <div className="list list-flush">
            {best.items.slice(0, 3).map((post) => (
              <a className="list-row list-link" href="#contenido" key={post.id}>
                <span className="thumb mono">{FORMAT_TAG[post.format]}</span>
                <span className="stack grow">
                  <b>{post.title}</b>
                  <span className="caption muted">{NETWORK_LABEL[post.network]} · {fmtDay(post.published_at)} · {post.pillar}</span>
                </span>
                <span className="stack figure mono">
                  <b>{fmtCompact(post.metrics.reach ?? post.metrics.views ?? 0)}</b>
                  <span className="caption muted">{post.vs_median ? fmtTimes(post.vs_median) : ''}</span>
                </span>
              </a>
            ))}
            {best.items.length === 0 && <p className="secondary">No hay piezas en este periodo.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
