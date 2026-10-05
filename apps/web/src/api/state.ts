// Estado de la conexión con el servidor: si existe, y qué claves de Ollama hay registradas.

import { useCallback, useEffect, useState } from 'react';
import { detectApi, getKeys, type Keys } from './live';

export interface ApiState {
  /** `live`: hay servidor y el agente es real. `sample`: no lo hay y el agente es simulado. */
  status: 'checking' | 'live' | 'sample';
  keys: Keys | null;
  refreshKeys: () => Promise<void>;
}

export function useApi(): ApiState {
  const [status, setStatus] = useState<ApiState['status']>('checking');
  const [keys, setKeys] = useState<Keys | null>(null);

  const refreshKeys = useCallback(async () => {
    try {
      setKeys(await getKeys());
    } catch {
      setKeys(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void detectApi().then(async (ok) => {
      if (!alive) return;
      if (ok) await refreshKeys();
      if (alive) setStatus(ok ? 'live' : 'sample');
    });
    return () => {
      alive = false;
    };
  }, [refreshKeys]);

  return { status, keys, refreshKeys };
}

export const hasKey = (api: ApiState) => Boolean(api.keys?.org_key || api.keys?.user_key);
