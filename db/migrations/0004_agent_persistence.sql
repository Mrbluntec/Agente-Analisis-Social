-- Atalaya · 0004 · persistencia del agente
-- La API guarda hoy las claves de Ollama cifradas en disco (apps/api/.data), no en
-- ollama_keys; por eso la ejecución registra el ámbito de la clave y el id queda opcional.
-- Los gráficos adjuntos de cada ejecución se guardan como jsonb.

BEGIN;

ALTER TABLE agent_runs ALTER COLUMN ollama_key_id DROP NOT NULL;
ALTER TABLE agent_runs ADD COLUMN key_scope key_scope;
ALTER TABLE agent_runs ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]';

COMMIT;
