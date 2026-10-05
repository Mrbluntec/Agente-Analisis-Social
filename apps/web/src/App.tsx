import { useEffect, useState } from 'react';
import type { Scope } from './api/mock';
import { useApi } from './api/state';
import { Shell, type Route } from './components/Shell';
import { Agente } from './pages/Agente';
import { Contenido } from './pages/Contenido';
import { Inicio } from './pages/Inicio';
import { Resumen } from './pages/Resumen';

const ROUTES: Route[] = ['inicio', 'resumen', 'contenido', 'agente'];

/** Ruta en el hash, con nombres simples (#resumen) para que funcione servida desde cualquier sitio. */
function readRoute(): Route {
  const hash = window.location.hash.replace('#', '');
  return (ROUTES as string[]).includes(hash) ? (hash as Route) : 'inicio';
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  // El periodo y las redes se eligen una vez y se conservan al cambiar de sección.
  const [scope, setScope] = useState<Scope>({ days: 28, networks: [] });
  const [agentBusy, setAgentBusy] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const api = useApi();

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <Shell route={route} scope={scope} onScope={setScope} api={api} keysOpen={keysOpen} onKeysOpen={setKeysOpen} agentBusy={agentBusy}>
      {route === 'inicio' && <Inicio />}
      {route === 'resumen' && <Resumen scope={scope} />}
      {route === 'contenido' && <Contenido scope={scope} />}
      {route === 'agente' && <Agente api={api} onBusy={setAgentBusy} onOpenKeys={() => setKeysOpen(true)} />}
    </Shell>
  );
}
