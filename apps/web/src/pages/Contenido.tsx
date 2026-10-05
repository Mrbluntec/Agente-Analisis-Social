import { useState } from 'react';
import { getPost, listPosts, type PostFilters, type PostSort, type Scope } from '../api/mock';
import { FORMAT_LABEL, FORMAT_TAG, NETWORK_LABEL, type PostFormat, type PostRow } from '../api/types';
import { Legend, LineChart, MiniCurve } from '../components/charts';
import { InsightLine } from '../components/ui';
import { fmtAxis, fmtCompact, fmtInt, fmtPct, fmtShortWeekdayDay, fmtTime, fmtTimes, fmtWeekdayDay } from '../lib/format';

const primary = (post: PostRow) => post.metrics.reach ?? post.metrics.views ?? 0;

const COLUMNS: { sort: PostSort; label: string }[] = [
  { sort: 'reach', label: 'Alcance' },
  { sort: 'engagement_rate', label: 'Interacción' },
  { sort: 'saves', label: 'Guardados' },
];

function Detail({ id, scope }: { id: string; scope: Scope }) {
  const post = getPost(id, scope);
  if (!post) return null;
  const curve = post.life_curve;
  const isViews = curve.metric === 'views';
  const at24 = curve.points.find((p) => p.hours === 24)?.value ?? 0;
  const medianEnd = curve.median_points[curve.median_points.length - 1]?.value ?? 0;
  const facts: [string, string][] = [
    [isViews ? 'Vistas' : 'Alcance', fmtCompact(primary(post))],
    ['Interacción', post.engagement_rate === null || post.engagement_rate === undefined ? 'sin dato' : fmtPct(post.engagement_rate)],
  ];
  if (post.metrics.saves !== undefined) facts.push(['Guardados', fmtInt(post.metrics.saves)]);
  if (post.metrics.shares !== undefined) facts.push(['Compartidos', fmtInt(post.metrics.shares)]);
  facts.push(['Me gusta', fmtInt(post.metrics.likes)], ['Comentarios', fmtInt(post.metrics.comments)]);

  const series = [
    { name: 'Esta pieza', color: 'var(--series-1)', values: curve.points.map((p) => p.value) },
    { name: 'Mediana de la cuenta', color: 'var(--series-compare)', values: curve.median_points.map((p) => p.value) },
  ];

  return (
    <aside className="card panel split-side detail" aria-label="Detalle de la pieza">
      <div className="row">
        <span className="thumb thumb-lg mono">{FORMAT_TAG[post.format]}</span>
        <div className="stack">
          <h2 className="heading">{post.title}</h2>
          <span className="caption muted">
            {NETWORK_LABEL[post.network]} · {fmtWeekdayDay(post.published_at)}, {fmtTime(post.published_at)}
            {post.duration_seconds ? ` · ${post.duration_seconds}\u00a0s` : ''}
          </span>
        </div>
      </div>

      <dl className="facts facts-tight">
        {facts.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>

      <section className="section">
        <div className="stack">
          <h3 className="subheading">Curva de vida</h3>
          <span className="secondary">{isViews ? 'Vistas acumuladas' : 'Alcance acumulado'} en las primeras 72 horas</span>
        </div>
        <Legend items={series} />
        <LineChart
          series={series}
          labels={curve.points.map((p) => `A las ${p.hours} h`)}
          ticks={[0, 4, 8, 12].map((index) => ({ index, label: `${index * 6} h` }))}
          format={fmtCompact}
          formatTick={fmtAxis}
          height={190}
          endLabels
          ariaLabel="Curva de vida de la pieza frente a la mediana de la cuenta. Use las flechas para recorrer las horas."
        />
        <p className="secondary">
          {at24 >= medianEnd
            ? 'A las 24 horas ya superaba lo que una pieza típica alcanza en tres días.'
            : 'En sus primeras 24 horas no llegó a lo que una pieza típica alcanza en tres días.'}
        </p>
      </section>

      <section className="section">
        <span className="agent-tag"><span className="agent-mark" /><b>Lectura creativa</b></span>
        {post.creative_reading ? (
          <>
            <dl className="reading">
              {post.creative_reading.items.map((item) => (
                <div key={item.aspect}><dt>{item.aspect}</dt><dd>{item.text}</dd></div>
              ))}
            </dl>
            <span className="mono caption muted">{post.creative_reading.model} · modelo con visión</span>
          </>
        ) : (
          <p className="muted">Esta pieza aún no tiene lectura creativa. Se genera al pedirla o en el siguiente briefing.</p>
        )}
      </section>

      <div className="row">
        <a className="btn" href="#agente">Preguntar sobre esta pieza</a>
        <span className="caption muted">Candidata a pauta · fase 3</span>
      </div>
    </aside>
  );
}

export function Contenido({ scope }: { scope: Scope }) {
  const [filters, setFilters] = useState<PostFilters>({ format: '', pillar: '', sort: 'reach' });
  const [selected, setSelected] = useState<string | null>(null);
  const list = listPosts(scope, filters);
  const activeId = list.items.some((p) => p.id === selected) ? selected : (list.items[0]?.id ?? null);
  const curveTop = Math.max(...list.items.map((p) => p.life_curve_72h?.at(-1) ?? 0), 1);
  const medianCurve = list.items[0]?.life_curve_72h?.map((_, i, all) => ((list.account_median_reach ?? 0) * 0.87 * (all[i] / (all.at(-1) || 1)))) ?? [];

  return (
    <div className="stack-xl">
      <InsightLine insight={list.insight} />

      <div className="toolbar">
        <label className="field">
          <span>Formato</span>
          <select value={filters.format} onChange={(e) => setFilters({ ...filters, format: e.target.value as PostFormat | '' })}>
            <option value="">Todos</option>
            {list.formats.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Pilar</span>
          <select value={filters.pillar} onChange={(e) => setFilters({ ...filters, pillar: e.target.value })}>
            <option value="">Todos</option>
            {list.pillars.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Orden</span>
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as PostSort })}>
            <option value="reach">Alcance, mayor primero</option>
            <option value="engagement_rate">Interacción, mayor primero</option>
            <option value="saves">Guardados, mayor primero</option>
            <option value="published_at">Más recientes primero</option>
          </select>
        </label>
        <span className="secondary toolbar-count">{list.items.length} de {list.total} piezas</span>
      </div>

      <div className="split">
        <section className="card split-main table-card">
          <div className="table-wrap">
            <table className="table table-posts">
              <thead>
                <tr>
                  <th scope="col">Pieza</th>
                  <th scope="col">Pilar</th>
                  {COLUMNS.map((c) => (
                    <th scope="col" className="num" key={c.sort} aria-sort={filters.sort === c.sort ? 'descending' : undefined}>
                      <button type="button" className="th-btn" onClick={() => setFilters({ ...filters, sort: c.sort })}>
                        {c.label}{filters.sort === c.sort ? ' ↓' : ''}
                      </button>
                    </th>
                  ))}
                  <th scope="col">Primeras 72 h</th>
                  <th scope="col" className="num">vs. mediana</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((post) => (
                  <tr key={post.id} aria-selected={post.id === activeId} onClick={() => setSelected(post.id)}>
                    <td>
                      <button type="button" className="row-btn" onClick={() => setSelected(post.id)} aria-label={`Ver detalle de ${post.title}`}>
                        <span className="thumb mono">{FORMAT_TAG[post.format]}</span>
                        <span className="stack">
                          <b>{post.title}</b>
                          <span className="caption muted">{NETWORK_LABEL[post.network]} · {fmtShortWeekdayDay(post.published_at)}</span>
                        </span>
                      </button>
                    </td>
                    <td className="secondary">{post.pillar}</td>
                    <td className="num strong">
                      {fmtCompact(primary(post))}
                      {post.metrics.views !== undefined && <span className="caption muted"> vistas</span>}
                    </td>
                    <td className="num">{post.engagement_rate === null || post.engagement_rate === undefined ? '' : fmtPct(post.engagement_rate)}</td>
                    <td className="num">{post.metrics.saves === undefined ? <span className="caption muted">no aplica</span> : fmtInt(post.metrics.saves)}</td>
                    <td>{post.life_curve_72h && <MiniCurve values={post.life_curve_72h} reference={medianCurve} top={curveTop} />}</td>
                    <td className="num strong">{post.vs_median ? fmtTimes(post.vs_median) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.items.length === 0 ? (
            <p className="secondary table-empty">Ninguna pieza coincide con estos filtros. Cambie el formato o el pilar.</p>
          ) : (
            <div className="table-foot">
              <Legend items={[{ name: 'Pieza', color: 'var(--series-1)' }, { name: 'Mediana de la cuenta', color: 'var(--series-compare)' }]} />
              <span className="caption muted">Mediana de la cuenta: {fmtInt(list.account_median_reach ?? 0)}</span>
            </div>
          )}
        </section>

        {activeId && <Detail id={activeId} scope={scope} />}
      </div>
    </div>
  );
}
