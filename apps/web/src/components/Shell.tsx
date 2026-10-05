import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiProblem, deleteKey, putKey, type KeyScope } from '../api/live';
import type { PeriodDays, Scope } from '../api/mock';
import { hasKey, type ApiState } from '../api/state';
import { NETWORK_LABEL, type OllamaKey } from '../api/types';
import { ACTIVE_NETWORKS, BRAND, type ActiveNetwork } from '../data/sample';
import { Icon, Segmented, type IconName } from './ui';

export type Route = 'inicio' | 'resumen' | 'contenido' | 'agente';

const NAV: { group: string | null; items: { route?: Route; label: string; icon: IconName; soon?: string }[] }[] = [
  { group: null, items: [{ route: 'inicio', label: 'Inicio', icon: 'home' }] },
  {
    group: 'Analítica',
    items: [
      { route: 'resumen', label: 'Resumen', icon: 'chart' },
      { route: 'contenido', label: 'Contenido', icon: 'grid' },
      { label: 'Audiencia', icon: 'people', soon: 'pronto' },
    ],
  },
  {
    group: 'Módulos',
    items: [
      { route: 'agente', label: 'Agente', icon: 'spark' },
      { label: 'Reportes', icon: 'doc', soon: 'fase 2' },
      { label: 'Competencia', icon: 'trend', soon: 'fase 3' },
      { label: 'Ads', icon: 'megaphone', soon: 'fase 3' },
      { label: 'Planificador', icon: 'calendar', soon: 'fase 4' },
    ],
  },
];

const TITLES: Record<Route, string> = {
  inicio: 'Inicio',
  resumen: 'Resumen de marca',
  contenido: 'Contenido',
  agente: 'Agente',
};

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };
  return [theme, toggle] as const;
}

const SCOPE_NAME: Record<KeyScope, string> = { org: 'de la agencia', user: 'personal' };

/** Planes de Ollama Cloud y las peticiones simultáneas que permite cada uno. */
const PLANS = [
  { value: 1, label: 'Gratis · 1 tarea a la vez' },
  { value: 3, label: 'Pro · 3 tareas a la vez' },
  { value: 10, label: 'Max o Team · 10 tareas a la vez' },
];

function KeyRow({ scope, info, onRemove }: { scope: KeyScope; info: OllamaKey | null; onRemove: () => void }) {
  return (
    <div className="key-row">
      <span className="status">
        <span className={info ? 'dot dot-ok' : 'dot'} />
        <b>Clave {SCOPE_NAME[scope]}</b>
      </span>
      {info ? (
        <>
          <span className="mono caption muted">
            termina en {info.last4} · {info.max_concurrency} {info.max_concurrency === 1 ? 'tarea' : 'tareas'} a la vez
            {info.validated_at ? '' : ' · sin verificar'}
          </span>
          <button type="button" className="link" onClick={onRemove}>Quitar esta clave</button>
        </>
      ) : (
        <span className="caption muted">Sin registrar</span>
      )}
    </div>
  );
}

function KeyDialog({ open, onClose, api }: { open: boolean; onClose: () => void; api: ApiState }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<KeyScope>('org');
  const [plan, setPlan] = useState(1);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const live = api.status === 'live';

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!live) {
      setMessage({ ok: false, text: 'Vista de muestra: no hay servidor, así que la clave no se ha enviado ni guardado. Arranque la aplicación en su equipo para conectarla.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await putKey(scope, value.trim(), plan);
      setValue('');
      await api.refreshKeys();
      setMessage({ ok: true, text: saved.validated_at ? `Ollama aceptó la clave. Queda guardada y cifrada como clave ${SCOPE_NAME[scope]}.` : 'Clave guardada, pero este servidor de Ollama no permite verificarla.' });
    } catch (cause) {
      const problem = cause instanceof ApiProblem ? cause : null;
      setMessage({ ok: false, text: problem ? `${problem.message} ${problem.detail ?? ''}`.trim() : 'No se pudo contactar con el servidor. Compruebe que sigue en marcha.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: KeyScope) => {
    await deleteKey(target).catch(() => undefined);
    await api.refreshKeys();
    setMessage({ ok: true, text: `Clave ${SCOPE_NAME[target]} eliminada.` });
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="key-title">
      <div className="dialog-head">
        <h2 id="key-title">Claves de Ollama Cloud</h2>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
      </div>

      {live ? (
        <div className="key-block">
          <KeyRow scope="org" info={api.keys?.org_key ?? null} onRemove={() => void remove('org')} />
          <KeyRow scope="user" info={api.keys?.user_key ?? null} onRemove={() => void remove('user')} />
          <p className="caption muted">La clave de la agencia cubre briefings y alertas. Si además registra una personal, sus preguntas en el chat usan la suya.</p>
        </div>
      ) : (
        <div className="key-block">
          <span className="status"><span className="dot" /><b>Sin servidor</b></span>
          <p className="secondary">Esta es la vista de muestra: el agente responde con ejemplos escritos a mano y no usa ninguna clave.</p>
        </div>
      )}

      <form className="key-block" onSubmit={(e) => void submit(e)}>
        <label htmlFor="key-value">Nueva clave</label>
        <input id="key-value" type="password" autoComplete="off" value={value} placeholder="Pegue aquí la clave de ollama.com/settings/keys" onChange={(e) => { setValue(e.target.value); setMessage(null); }} />
        <div className="row">
          <label className="field">
            <span>Alcance</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as KeyScope)}>
              <option value="org">De la agencia</option>
              <option value="user">Personal</option>
            </select>
          </label>
          <label className="field">
            <span>Plan</span>
            <select value={plan} onChange={(e) => setPlan(Number(e.target.value))}>
              {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
        </div>
        <p className="caption muted">La clave viaja una vez al servidor, que la comprueba con Ollama y la guarda cifrada. El navegador no la conserva.</p>
        <button type="submit" className="btn btn-primary" disabled={busy || value.trim().length < 8}>{busy ? 'Comprobando…' : 'Comprobar y guardar'}</button>
        {message && <p className={message.ok ? 'notice notice-ok' : 'notice'} role="status">{message.text}</p>}
      </form>
    </dialog>
  );
}

interface ShellProps {
  route: Route;
  scope: Scope;
  onScope: (scope: Scope) => void;
  api: ApiState;
  keysOpen: boolean;
  onKeysOpen: (open: boolean) => void;
  agentBusy: number;
  children: ReactNode;
}

export function Shell({ route, scope, onScope, api, keysOpen, onKeysOpen, agentBusy, children }: ShellProps) {
  const [theme, toggleTheme] = useTheme();
  const showScope = route === 'resumen' || route === 'contenido';

  const toggleNetwork = (n: ActiveNetwork) => {
    // Lista vacía significa «todas»: se parte de la lista completa para poder quitar una.
    const current = scope.networks.length ? scope.networks : [...ACTIVE_NETWORKS];
    const next = current.includes(n) ? current.filter((x) => x !== n) : [...current, n];
    if (next.length === 0) return; // siempre queda al menos una red
    onScope({ ...scope, networks: next.length === ACTIVE_NETWORKS.length ? [] : next });
  };

  const live = api.status === 'live';
  const keyed = hasKey(api);
  const activeKey = api.keys?.user_key ?? api.keys?.org_key ?? null;
  const ollamaLine = !live ? 'Agente simulado' : keyed ? (api.keys?.user_key ? 'Clave personal activa' : 'Clave de agencia activa') : 'Falta la clave';
  const queueLine = live ? (activeKey ? `cola ${agentBusy} de ${activeKey.max_concurrency} · gestionar` : 'conectar clave') : 'sin servidor · ver';

  return (
    <div className="app">
      <nav className="side" aria-label="Principal">
        <a className="logo" href="#inicio" aria-label="Atalaya, ir a Inicio">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="var(--brand)" stroke="var(--ink-primary)" strokeWidth="1.75" />
            <circle cx="12" cy="12" r="4" fill="var(--accent)" />
          </svg>
          <span>Atalaya</span>
        </a>
        <button type="button" className="brand-switch">
          <span className="avatar avatar-square">CM</span>
          <span className="stack">
            <b>{BRAND.name}</b>
            <span className="caption muted">{BRAND.networks.length} redes conectadas</span>
          </span>
          <Icon name="sort" size={16} className="muted" />
        </button>
        <div className="nav-groups">
          {NAV.map((group) => (
            <div className="nav-group" key={group.group ?? 'top'}>
              {group.group && <span className="nav-title">{group.group}</span>}
              {group.items.map((item) =>
                item.route ? (
                  <a key={item.label} href={`#${item.route}`} className="nav-item" aria-current={item.route === route ? 'page' : undefined}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </a>
                ) : (
                  <span key={item.label} className="nav-item nav-item-soon">
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    <span className="mono caption">{item.soon}</span>
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
        <div className="side-foot">
          <button type="button" className="ollama" onClick={() => onKeysOpen(true)}>
            <span className="status"><span className={live && keyed ? 'dot dot-ok' : 'dot'} /><b>Ollama Cloud</b></span>
            <span className="caption secondary">{ollamaLine}</span>
            <span className="mono caption muted">{queueLine}</span>
          </button>
          <div className="user">
            <span className="avatar avatar-brand">MA</span>
            <span className="stack">
              <b>Miguel Ángel</b>
              <span className="caption muted">MOGA Agencia Digital</span>
            </span>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="top">
          <h1 className="top-title">{TITLES[route]}</h1>
          <span className="pill mono">Datos de muestra</span>
          {route === 'agente' && api.status !== 'checking' && (
            <span className="pill mono"><span className={live ? 'dot dot-ok' : 'dot'} />{live ? 'Agente en vivo' : 'Agente simulado'}</span>
          )}
          {showScope && (
            <>
              <div className="chips" role="group" aria-label="Redes">
                {ACTIVE_NETWORKS.map((n) => (
                  <button key={n} type="button" className="chip" aria-pressed={scope.networks.length === 0 || scope.networks.includes(n)} onClick={() => toggleNetwork(n)}>
                    {NETWORK_LABEL[n]}
                  </button>
                ))}
              </div>
              <Segmented<PeriodDays>
                label="Periodo"
                value={scope.days}
                onChange={(days) => onScope({ ...scope, days })}
                options={[{ value: 7, label: '7 días' }, { value: 28, label: '28 días' }]}
              />
            </>
          )}
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          {route !== 'agente' && <a className="btn btn-primary" href="#agente">Preguntar al agente</a>}
        </header>
        <main className="page">{children}</main>
      </div>
      <KeyDialog open={keysOpen} onClose={() => onKeysOpen(false)} api={api} />
    </div>
  );
}
