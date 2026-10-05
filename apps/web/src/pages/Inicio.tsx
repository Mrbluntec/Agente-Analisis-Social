import { getLatestBriefing, listAlerts } from '../api/mock';
import { NETWORK_LABEL, type Alert } from '../api/types';
import { Icon, kpiLabel, kpiValue } from '../components/ui';
import { PORTFOLIO, BRAND } from '../data/sample';
import { fmtCompact, fmtDay, fmtSignedPct, fmtTime, fmtWeekdayDay } from '../lib/format';

const LINK: Record<string, { href: string; label: string }> = {
  posts: { href: '#contenido', label: 'Ver las piezas' },
  post: { href: '#contenido', label: 'Ver la pieza' },
  summary: { href: '#resumen', label: 'Ver el resumen' },
  agent_run: { href: '#agente', label: 'Ver el diagnóstico' },
};

const SEVERITY: Record<Alert['severity'], { label: string; icon: 'alert' | 'info'; tone: string }> = {
  critical: { label: 'Crítica', icon: 'alert', tone: 'tone-critical' },
  serious: { label: 'Seria', icon: 'alert', tone: 'tone-serious' },
  warning: { label: 'Aviso', icon: 'info', tone: 'tone-warning' },
};

export function Inicio() {
  const briefing = getLatestBriefing();
  const alerts = listAlerts();

  return (
    <div className="split">
      <div className="split-main">
        <header className="page-head">
          <span className="mono caption muted">{fmtWeekdayDay('2026-10-05')} · semana del {fmtDay(briefing.week_start)}</span>
          <h2 className="display">Briefing de la semana</h2>
        </header>

        <article className="card briefing">
          <div className="briefing-top">
            <span className="agent-tag"><span className="agent-mark" />{BRAND.name} · Instagram, Facebook y YouTube</span>
            <p className="lead">{briefing.headline}</p>
            <dl className="facts">
              {briefing.kpis.map((kpi) => (
                <div key={kpi.metric}>
                  <dt>{kpiLabel(kpi.metric)}</dt>
                  <dd>{kpiValue(kpi)}</dd>
                  <dd className="fact-note">
                    {kpi.delta !== null && kpi.delta !== undefined && fmtSignedPct(kpi.delta, 0)} · antes{' '}
                    {kpi.previous !== null && kpi.previous !== undefined && fmtCompact(kpi.previous)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <ol className="findings">
            {briefing.findings.map((finding, i) => {
              const link = finding.link ? LINK[finding.link.view] : undefined;
              return (
                <li key={finding.title}>
                  <span className="mono muted">{String(i + 1).padStart(2, '0')}</span>
                  <div className="stack">
                    <h3 className="finding-title">{finding.title}</h3>
                    <p className="secondary">{finding.evidence}</p>
                    {link && <a className="link" href={link.href}>{link.label}</a>}
                  </div>
                </li>
              );
            })}
          </ol>

          {briefing.recommendation && (
            <div className="advice">
              <span className="caption muted">Recomendación para esta semana</span>
              <p>{briefing.recommendation}</p>
              <div className="row">
                <button type="button" className="btn" aria-disabled="true" title="Disponible con el planificador, en la fase 4">Crear borradores en el planificador</button>
                <span className="caption muted">Disponible en la fase 4</span>
              </div>
            </div>
          )}

          <footer className="meta mono">
            <span>Generado hoy a las {fmtTime(briefing.created_at)}</span>
            <span>deepseek-v4-pro</span>
            <span>6 herramientas</span>
            <a className="link" href="#agente">Ver razonamiento</a>
          </footer>
        </article>

        <section className="stack-lg">
          <h2 className="heading">Resto de la cartera</h2>
          <div className="card list">
            {PORTFOLIO.map((brand) => (
              <div className="list-row" key={brand.id}>
                <span className="avatar avatar-square">{brand.initials}</span>
                <div className="stack grow">
                  <b>{brand.name}</b>
                  <span className="secondary">{brand.headline}</span>
                </div>
                <div className="stack figure">
                  <b>{fmtCompact(brand.reach)}</b>
                  <span className="caption secondary">alcance · {fmtSignedPct(brand.delta, 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="split-side">
        <section className="card panel">
          <h2 className="heading">Alertas</h2>
          {alerts.map((alert) => {
            const s = SEVERITY[alert.severity];
            return (
              <div className="alert" key={alert.id}>
                <Icon name={s.icon} className={s.tone} />
                <div className="stack">
                  <span className="caption secondary">
                    {s.label} · {alert.network ? NETWORK_LABEL[alert.network] : 'Marca'} · {fmtDay(alert.occurred_on)}
                  </span>
                  <b>{alert.title}</b>
                  {alert.diagnosis && <span className="secondary">{alert.diagnosis}</span>}
                  <a className="link" href={alert.run_id ? '#agente' : '#contenido'}>{alert.run_id ? 'Ver diagnóstico' : 'Ver la pieza'}</a>
                </div>
              </div>
            );
          })}
        </section>

        <section className="card panel panel-quiet">
          <h2 className="heading">Pendientes de aprobación</h2>
          <p className="muted">Aquí aparecerán las piezas que esperan visto bueno del cliente. Llega con el planificador, en la fase 4.</p>
        </section>

        <section className="card panel panel-quiet">
          <h2 className="heading">Sincronización</h2>
          <dl className="pairs">
            <div><dt>Instagram</dt><dd className="mono caption">hoy 06:40</dd></div>
            <div><dt>Facebook</dt><dd className="mono caption">hoy 06:41</dd></div>
            <div><dt>YouTube</dt><dd className="mono caption">datos hasta el 2 oct</dd></div>
          </dl>
          <p className="caption muted">YouTube entrega sus métricas con 48 a 72 horas de retraso.</p>
        </section>
      </aside>
    </div>
  );
}
