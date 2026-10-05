import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiProblem, ask as askLive, cancelRun, followRun, getModels, getQueue } from '../api/live';
import { AGENT_MODELS, completedRun, getAgentQueue, streamRun, type RunView } from '../api/mock';
import { hasKey, type ApiState } from '../api/state';
import type { AgentModel, AgentQueue } from '../api/types';
import { Columns } from '../components/charts';
import { Icon, Segmented } from '../components/ui';
import { BRAND, STORIES_BY_HOUR } from '../data/sample';
import { fmtCompact } from '../lib/format';

/** Preguntas con respuesta de ejemplo en el agente simulado. */
const SAMPLE_SUGGESTIONS = ['¿Pasa lo mismo con las historias de Facebook?', 'Mejor franja para historias por día de la semana', '¿Por qué cayó el alcance de las historias el jueves?'];
/** Preguntas que el agente real puede contestar con las herramientas que tiene hoy. */
const LIVE_SUGGESTIONS = ['¿Por qué cayó el alcance de las historias el jueves?', '¿Qué formato conviene repetir esta semana?', 'Compare la última semana con la anterior'];

const MODES = [
  { value: 'analyst', label: 'Analista' },
  { value: 'briefing', label: 'Briefing' },
  { value: 'sentinel', label: 'Centinela' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'writer', label: 'Redactor' },
];

const MODE_NOTE: Record<string, string> = {
  briefing: 'El briefing semanal se genera solo cada lunes; el de esta semana está en Inicio.',
  sentinel: 'El centinela vigila anomalías y deja su diagnóstico en las alertas de Inicio.',
  auditor: 'La auditoría de cuentas ajenas llega con el módulo de competencia, en la fase 3.',
  writer: 'El redactor de reportes llega con el módulo de reportes, en la fase 2.',
};

const THINK_LABEL: Record<string, string> = { true: 'Razonamiento activado', low: 'Razonamiento bajo', medium: 'Razonamiento medio', high: 'Razonamiento alto', max: 'Razonamiento máximo' };

const FAILURE_HINT: Record<string, string> = {
  ollama_key_rejected: 'Ollama rechazó la clave. Revísela en «Ollama Cloud», abajo a la izquierda.',
  ollama_rate_limited: 'Ollama limitó las peticiones de esta clave. Espere un momento o revise el consumo de su plan.',
  ollama_unavailable: 'No se pudo completar la consulta con Ollama. Vuelva a intentarlo.',
  ollama_bad_request: 'Ollama no aceptó la petición con este modelo. Pruebe con otro de la lista.',
};

/** Convierte «[1]» en un enlace a la lista de fuentes de esa respuesta. */
function withCitations(text: string, sourcesId: string) {
  return text.split(/(\[\d+\])/g).map((part, i) =>
    /^\[\d+\]$/.test(part) ? (
      <a key={i} href="#agente" className="cite mono" onClick={(e) => { e.preventDefault(); document.getElementById(sourcesId)?.scrollIntoView({ block: 'nearest' }); }}>{part}</a>
    ) : part,
  );
}

function Run({ run, suggestions, onAsk, busy }: { run: RunView; suggestions: string[]; onAsk: (q: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(true);
  const tools = run.tool_calls ?? [];
  const working = run.status === 'queued' || run.status === 'running';
  const all = (run.answer ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // El agente real cierra con una línea «Qué haría: …»; se enseña como recomendación aparte.
  const ADVICE = /^qué haría:\s*/i;
  const last = all[all.length - 1] ?? '';
  const inlineAdvice = run.status === 'succeeded' && all.length > 1 && ADVICE.test(last) ? last.replace(ADVICE, '') : null;
  const paragraphs = inlineAdvice ? all.slice(0, -1) : all;
  const advice = run.advice ?? inlineAdvice;
  const hasReasoning = Boolean(run.thinking) || tools.length > 0;
  const sourcesId = `fuentes-${run.id}`;

  return (
    <div className="run">
      <div className="bubble">{run.question}</div>

      {run.status === 'queued' && <p className="muted" role="status">En cola…</p>}
      {run.status === 'running' && !hasReasoning && paragraphs.length === 0 && <p className="muted" role="status">Pensando…</p>}

      {hasReasoning && (
        <div className="reasoning">
          <button type="button" className="reasoning-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="chevron" size={16} className={open ? 'turn' : undefined} />
            <span className="grow">Razonamiento</span>
            <span className="mono caption muted">
              {working ? 'en curso' : run.duration_s ? `${run.duration_s} s` : run.model} · {tools.length} {tools.length === 1 ? 'herramienta' : 'herramientas'}
            </span>
          </button>
          {open && (
            <div className="reasoning-body">
              {run.thinking && <p className="secondary thinking">{run.thinking}</p>}
              {tools.length > 0 && (
                <ol className="tools">
                  {tools.map((t) => (
                    <li key={t.seq}>
                      <span className="mono caption">[{t.seq}] {t.tool}</span>
                      <span className="secondary">{t.result_summary ?? 'consultando…'}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      {paragraphs.length > 0 && (
        <div className="answer" aria-live="polite">
          <p className="answer-lead">{withCitations(paragraphs[0], sourcesId)}</p>
          {paragraphs.slice(1).map((p, i) => <p key={i} className="secondary">{withCitations(p, sourcesId)}</p>)}
        </div>
      )}

      {run.status === 'succeeded' && run.chart === 'stories_by_hour' && (
        <figure className="card panel figure-card">
          <figcaption className="stack">
            <b>Alcance medio de una historia según la hora de publicación</b>
            <span className="secondary">Instagram · 10 ago – 4 oct · 142 historias</span>
          </figcaption>
          <Columns format={fmtCompact} items={STORIES_BY_HOUR.map((s) => ({ key: s.hour, label: s.hour, note: s.note || undefined, value: s.reach, emphasis: s.note === 'habitual' }))} />
        </figure>
      )}

      {run.status === 'succeeded' && advice && (
        <div className="advice">
          <span className="caption muted">Qué haría</span>
          <p>{withCitations(advice, sourcesId)}</p>
        </div>
      )}

      {run.status === 'succeeded' && (run.citations ?? []).length > 0 && (
        <div className="sources" id={sourcesId}>
          <span className="caption muted">Fuentes de las cifras</span>
          {(run.citations ?? []).map((c) => (
            <div key={c.ref} className="source">
              <span className="mono caption">[{c.ref}]</span>
              <span className="secondary">{c.label}</span>
              <span className="mono caption muted">{c.tool}</span>
            </div>
          ))}
        </div>
      )}

      {run.status === 'cancelled' && <p className="muted" role="status">Ejecución cancelada.</p>}
      {run.status === 'failed' && (
        <p className="notice" role="alert">
          {FAILURE_HINT[run.error_code ?? ''] ?? 'La ejecución falló.'}
          {run.error && <span className="caption muted block">{run.error}</span>}
        </p>
      )}

      {run.status === 'succeeded' && (
        <div className="chips">
          {suggestions.filter((s) => s !== run.question).slice(0, 2).map((s) => (
            <button key={s} type="button" className="chip" disabled={busy} onClick={() => onAsk(s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

interface AgenteProps {
  api: ApiState;
  onBusy: (running: number) => void;
  onOpenKeys: () => void;
}

export function Agente({ api, onBusy, onOpenKeys }: AgenteProps) {
  const live = api.status === 'live';
  const keyed = hasKey(api);
  const [mode, setMode] = useState('analyst');
  const [runs, setRuns] = useState<RunView[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Modelos: descubiertos en el servidor cuando lo hay; fijos en la vista de muestra.
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModel] = useState(AGENT_MODELS[0]);
  const [think, setThink] = useState('');
  const [queue, setQueue] = useState<AgentQueue | null>(null);

  const conversation = useRef<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const sending = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  const busy = runs.some((r) => r.status === 'queued' || r.status === 'running');
  const current = models.find((m) => m.name === model);
  const suggestions = live ? LIVE_SUGGESTIONS : SAMPLE_SUGGESTIONS;

  // La conversación de ejemplo solo se enseña cuando ya se sabe que no hay servidor.
  useEffect(() => {
    if (api.status === 'sample') setRuns((all) => (all.length ? all : [completedRun(SAMPLE_SUGGESTIONS[2], AGENT_MODELS[0])]));
  }, [api.status]);

  useEffect(() => {
    if (!live) return;
    void getModels()
      .then((items) => {
        setModels(items);
        if (items.length) {
          setModel(items[0].name);
          setThink(items[0].thinking_default && items[0].thinking_default !== 'false' ? items[0].thinking_default : (items[0].thinking[0] ?? ''));
        }
      })
      .catch((cause) => setError(cause instanceof ApiProblem ? `${cause.message} ${cause.detail ?? ''}`.trim() : 'No se pudo cargar la lista de modelos.'));
  }, [live]);

  const refreshQueue = useCallback(() => {
    if (live && keyed) void getQueue().then(setQueue);
    if (!keyed) setQueue(null);
  }, [live, keyed]);
  useEffect(refreshQueue, [refreshQueue, busy, api.keys]);

  const shownQueue = live ? queue : getAgentQueue(busy ? 1 : 0);
  const used = shownQueue ? shownQueue.running.length + shownQueue.queued.length : 0;
  useEffect(() => onBusy(live ? used : busy ? 1 : 0), [busy, used, live, onBusy]);
  useEffect(() => () => stop.current?.(), []);

  const selectModel = (name: string) => {
    setModel(name);
    const next = models.find((m) => m.name === name);
    if (next) setThink(next.thinking_default && next.thinking_default !== 'false' ? next.thinking_default : (next.thinking[0] ?? ''));
  };

  // El actualizador debe ser puro: en desarrollo React lo ejecuta dos veces (StrictMode) y
  // cualquier estado mutado fuera de él haría que la segunda pasada descartase la ejecución.
  const upsert = (index: number) => (run: RunView) =>
    setRuns((all) => (index < all.length ? all.map((r, i) => (i === index ? run : r)) : [...all, run]));

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || sending.current) return;
    setDraft('');
    setError(null);
    // Mientras hay una ejecución en curso no se admite otra, así que el hueco es el siguiente.
    const update = upsert(runs.length);
    window.setTimeout(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 120);

    if (!live) {
      stop.current = streamRun(q, model, update);
      return;
    }
    // Hasta que el servidor acepta la pregunta no hay ejecución en la lista: se bloquea el doble envío.
    sending.current = true;
    try {
      const known = models.some((m) => m.name === model);
      const started = await askLive(conversation.current, { question: q, model: known ? model : undefined, think: known && think ? think : undefined });
      conversation.current = started.conversationId;
      update(started.run);
      const close = followRun(started.run, update);
      stop.current = () => {
        void cancelRun(started.run.id);
        close();
        update({ ...started.run, status: 'cancelled' });
      };
    } catch (cause) {
      setError(cause instanceof ApiProblem ? `${cause.message} ${cause.detail ?? ''}`.trim() : 'No se pudo contactar con el servidor.');
    } finally {
      sending.current = false;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  let body: ReactNode;
  if (mode !== 'analyst') {
    body = <p className="notice">{MODE_NOTE[mode]}</p>;
  } else if (api.status === 'checking') {
    body = <p className="muted" role="status">Comprobando si hay servidor…</p>;
  } else if (live && !keyed) {
    body = (
      <div className="card panel empty">
        <h2 className="heading">Conecte su clave de Ollama Cloud</h2>
        <p className="secondary">El agente usa los modelos de su cuenta de Ollama. Cree una clave en ollama.com/settings/keys y péguela aquí; se comprueba con Ollama y se guarda cifrada en el servidor.</p>
        <button type="button" className="btn btn-primary" onClick={onOpenKeys}>Conectar clave</button>
      </div>
    );
  } else {
    body = (
      <>
        {runs.length === 0 && (
          <div className="empty">
            <h2 className="lead">Pregunte lo que quiera sobre {BRAND.name}.</h2>
            <p className="secondary">El agente consulta los datos de la marca con sus herramientas y cita de dónde sale cada cifra.</p>
            <div className="chips">
              {suggestions.map((s) => <button key={s} type="button" className="chip" disabled={busy} onClick={() => void ask(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {runs.map((run) => <Run key={run.id} run={run} suggestions={suggestions} onAsk={(q) => void ask(q)} busy={busy} />)}
        {error && <p className="notice" role="alert">{error}</p>}
        <form className="composer" onSubmit={submit}>
          <label htmlFor="pregunta" className="caption muted">Pregunte al agente sobre {BRAND.name}</label>
          <input id="pregunta" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Por ejemplo: ¿qué formato conviene repetir esta semana?" autoComplete="off" />
          <div className="row">
            <label className="field field-inline">
              <span className="sr-only">Modelo</span>
              <select className="mono" value={model} onChange={(e) => selectModel(e.target.value)}>
                {(live ? models.map((m) => m.name) : AGENT_MODELS).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            {live && current && current.thinking.length > 1 ? (
              <label className="field field-inline">
                <span className="sr-only">Nivel de razonamiento</span>
                <select value={think} onChange={(e) => setThink(e.target.value)}>
                  {current.thinking.map((level) => <option key={level} value={level}>{THINK_LABEL[level] ?? level}</option>)}
                </select>
              </label>
            ) : (
              <span className="caption muted">con razonamiento</span>
            )}
            <span className="grow" />
            {busy ? (
              <button type="button" className="btn" onClick={() => stop.current?.()}>Cancelar</button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>Enviar</button>
            )}
          </div>
          {live && current && (
            <span className="caption muted">
              Capacidades: visión, herramientas y razonamiento{current.audio ? ', audio' : ''}. Solo aparecen modelos que tienen las tres primeras.
            </span>
          )}
        </form>
        <div ref={end} />
      </>
    );
  }

  return (
    <div className="agent">
      <aside className="agent-side" aria-label="Conversaciones">
        <div className="panel-head">
          <h2 className="subheading">Conversaciones</h2>
        </div>
        {live ? (
          <div className="convs">
            {runs.length > 0 ? (
              <span className="conv" aria-current="true"><b>{runs[0].question}</b><span className="caption muted">en esta sesión</span></span>
            ) : (
              <p className="caption muted">Aún no hay conversaciones. Se conservan mientras el servidor siga en marcha.</p>
            )}
          </div>
        ) : (
          <div className="convs">
            <span className="conv" aria-current="true"><b>Caída de historias del jueves</b><span className="caption muted">hoy, 09:14</span></span>
            <a className="conv" href="#inicio"><span>Briefing semanal · 5 oct</span><span className="caption muted">hoy, 07:02 · programado</span></a>
            <span className="conv conv-off"><span>¿Qué pilar conviene reforzar?</span><span className="caption muted">jueves</span></span>
            <span className="conv conv-off"><span>Comparar septiembre con agosto</span><span className="caption muted">30 sep</span></span>
          </div>
        )}
      </aside>

      <section className="agent-main" aria-label="Conversación">
        <Segmented label="Modo del agente" value={mode} onChange={setMode} options={MODES} />
        {body}
      </section>

      <aside className="agent-side" aria-label="Contexto">
        <section className="card panel panel-quiet">
          <h2 className="subheading">Contexto</h2>
          <dl className="pairs pairs-stacked">
            <div><dt>Marca</dt><dd>{BRAND.name}</dd></div>
            <div><dt>Datos hasta</dt><dd>4 oct</dd></div>
            <div><dt>Redes</dt><dd>Instagram, Facebook, YouTube</dd></div>
          </dl>
        </section>
        {shownQueue && (
          <section className="card panel panel-quiet">
            <h2 className="subheading">Cola del agente</h2>
            <div className="meter" role="img" aria-label={`${shownQueue.running.length} de ${shownQueue.max_concurrency} tareas simultáneas en uso`}>
              {Array.from({ length: Math.min(shownQueue.max_concurrency, 10) }, (_, i) => <span key={i} className={i < shownQueue.running.length ? 'meter-on' : undefined} />)}
            </div>
            <span className="secondary">
              {shownQueue.running.length} de {shownQueue.max_concurrency} en uso{shownQueue.queued.length ? ` · ${shownQueue.queued.length} en espera` : ''}
            </span>
            {shownQueue.running.map((item) => (
              <div className="stack queue-item" key={item.run_id}>
                <span>{item.mode === 'briefing' ? 'Briefing semanal' : 'Su pregunta'}</span>
                <span className="caption muted">{item.brand_name} · en curso</span>
              </div>
            ))}
            <p className="caption muted">El límite lo fija el plan de Ollama Cloud de la clave {shownQueue.key_scope === 'user' ? 'personal' : 'de la agencia'}.</p>
          </section>
        )}
      </aside>
    </div>
  );
}
