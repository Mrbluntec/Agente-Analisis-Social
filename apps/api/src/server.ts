// Arranque del servidor. Configuración por variables de entorno:
//   PORT                  puerto HTTP (8787)
//   OLLAMA_BASE_URL       https://ollama.com por defecto; admite un Ollama local
//   ATALAYA_DATA_DIR      dónde se guardan las claves cifradas (apps/api/.data)
//   ATALAYA_MASTER_KEY    clave maestra de 32 bytes en base64; si falta, se genera una local

import { serve } from '@hono/node-server';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentService } from './agent/service';
import { createApp } from './app';
import { KeyStore } from './keys';
import { Ollama } from './ollama';

/** Un modelo solo aparece en la lista si declara estas tres capacidades. */
export const REQUIRED_CAPABILITIES = ['vision', 'tools', 'thinking'];

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'https://ollama.com';
const dataDir = process.env.ATALAYA_DATA_DIR ?? join(here, '..', '.data');

const ollama = new Ollama(baseUrl);
const keys = new KeyStore(dataDir, process.env.ATALAYA_MASTER_KEY);
const agent = new AgentService(ollama, keys, { requiredCapabilities: REQUIRED_CAPABILITIES });

serve({ fetch: createApp({ ollama, keys, agent }).fetch, port }, () => {
  console.log(`Atalaya API en http://localhost:${port}/v1`);
  console.log(`Ollama: ${baseUrl} · clave ${keys.active() ? 'registrada' : 'pendiente'}`);
});
