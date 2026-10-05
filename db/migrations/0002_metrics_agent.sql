-- Atalaya · 0002 · métricas y agente
-- Diccionario de métricas, fotos diarias y horarias, y registro de cada ejecución del agente.

BEGIN;

-- ---------------------------------------------------------------------------
-- Diccionario de métricas
-- ---------------------------------------------------------------------------
-- Una métrica tiene una definición propia y, por cada red, la definición nativa
-- con su vigencia. Así la interfaz puede decir qué significa «vista» en cada red
-- y el histórico sobrevive a que una red retire una métrica.

CREATE TYPE metric_unit AS ENUM ('count', 'percent', 'seconds', 'minutes', 'currency');
CREATE TYPE metric_rollup AS ENUM ('sum', 'last', 'avg');   -- cómo se agrega en el tiempo

CREATE TABLE metric_definitions (
    key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
    label_es     text NOT NULL,
    unit         metric_unit NOT NULL DEFAULT 'count',
    rollup       metric_rollup NOT NULL,
    description  text NOT NULL
);

CREATE TABLE metric_network_definitions (
    metric_key   text NOT NULL REFERENCES metric_definitions (key) ON DELETE CASCADE,
    network      network NOT NULL,
    native_name  text NOT NULL,                -- nombre del campo en la API de la red
    definition   text NOT NULL,
    valid_from   date NOT NULL DEFAULT '2000-01-01',
    valid_to     date,                         -- nulo = vigente
    PRIMARY KEY (metric_key, network, valid_from),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

INSERT INTO metric_definitions (key, label_es, unit, rollup, description) VALUES
    ('reach',         'Alcance',        'count',   'sum',  'Cuentas distintas que vieron contenido. No se deduplica entre redes ni entre días.'),
    ('views',         'Vistas',         'count',   'sum',  'Reproducciones o visualizaciones, según la definición de cada red.'),
    ('likes',         'Me gusta',       'count',   'sum',  'Reacciones positivas.'),
    ('comments',      'Comentarios',    'count',   'sum',  'Comentarios recibidos.'),
    ('shares',        'Compartidos',    'count',   'sum',  'Veces que se compartió el contenido.'),
    ('saves',         'Guardados',      'count',   'sum',  'Veces que se guardó el contenido.'),
    ('followers',     'Seguidores',     'count',   'last', 'Seguidores o suscriptores al cierre del día.'),
    ('watch_minutes', 'Minutos vistos', 'minutes', 'sum',  'Tiempo total de reproducción.');

INSERT INTO metric_network_definitions (metric_key, network, native_name, definition) VALUES
    ('reach',         'instagram', 'reach',                  'Cuentas únicas que vieron el contenido. Puede llegar con hasta 48 h de retraso.'),
    ('likes',         'instagram', 'likes',                  'Me gusta en publicaciones, reels y videos.'),
    ('comments',      'instagram', 'comments',               'Comentarios en publicaciones, reels y videos.'),
    ('shares',        'instagram', 'shares',                 'Veces que se compartió.'),
    ('saves',         'instagram', 'saves',                  'Veces que se guardó.'),
    ('views',         'tiktok',    'view_count',             'Número de vistas del video.'),
    ('likes',         'tiktok',    'like_count',             'Número de me gusta del video.'),
    ('comments',      'tiktok',    'comment_count',          'Número de comentarios del video.'),
    ('shares',        'tiktok',    'share_count',            'Número de veces que se compartió el video.'),
    ('views',         'youtube',   'views',                  'Reproducciones. Los datos llegan con 48 a 72 h de retraso.'),
    ('likes',         'youtube',   'likes',                  'Me gusta del video.'),
    ('watch_minutes', 'youtube',   'estimatedMinutesWatched', 'Minutos de reproducción estimados.');

-- ---------------------------------------------------------------------------
-- Fotos de métricas
-- ---------------------------------------------------------------------------
-- Las redes entregan el valor del momento. Guardar una foto por día (cuenta) y
-- por hora en las primeras 72 h (publicación) es lo que produce historial y
-- curvas de vida. Los valores de publicación son acumulados a la fecha.

CREATE TABLE account_metric_snapshots (
    account_id       uuid NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
    metric_key       text NOT NULL REFERENCES metric_definitions (key),
    dimension        text NOT NULL DEFAULT '',     -- '' = total; 'age', 'gender', 'country', 'city', 'format'…
    dimension_value  text NOT NULL DEFAULT '',
    captured_on      date NOT NULL,
    value            numeric NOT NULL,
    captured_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, metric_key, dimension, dimension_value, captured_on),
    CHECK ((dimension = '') = (dimension_value = ''))
);
CREATE INDEX account_metric_day_idx ON account_metric_snapshots (captured_on, account_id);

CREATE TABLE post_metric_snapshots (
    post_id      uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    metric_key   text NOT NULL REFERENCES metric_definitions (key),
    captured_at  timestamptz NOT NULL,
    value        numeric NOT NULL,
    PRIMARY KEY (post_id, metric_key, captured_at)
);

-- Último valor conocido de cada métrica por publicación.
CREATE VIEW post_latest_metrics AS
SELECT DISTINCT ON (post_id, metric_key)
       post_id, metric_key, value, captured_at
FROM post_metric_snapshots
ORDER BY post_id, metric_key, captured_at DESC;

-- ---------------------------------------------------------------------------
-- Agente
-- ---------------------------------------------------------------------------

CREATE TYPE agent_mode AS ENUM ('analyst', 'briefing', 'sentinel', 'auditor', 'writer');
CREATE TYPE agent_run_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE alert_severity AS ENUM ('warning', 'serious', 'critical');

CREATE TABLE agent_conversations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id    uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    title       text NOT NULL,
    mode        agent_mode NOT NULL DEFAULT 'analyst',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_conversations_brand_idx ON agent_conversations (brand_id, created_at DESC);

CREATE TABLE agent_runs (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id           uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    conversation_id    uuid REFERENCES agent_conversations (id) ON DELETE CASCADE,  -- nulo en tareas programadas
    requested_by       uuid REFERENCES users (id) ON DELETE SET NULL,               -- nulo en tareas programadas
    mode               agent_mode NOT NULL,
    status             agent_run_status NOT NULL DEFAULT 'queued',
    ollama_key_id      uuid NOT NULL REFERENCES ollama_keys (id),
    model              text NOT NULL,
    think              text,                   -- 'true', 'false' o el nivel con nombre que admita el modelo
    question           text NOT NULL,
    thinking           text,
    answer             text,
    queued_at          timestamptz NOT NULL DEFAULT now(),
    started_at         timestamptz,
    finished_at        timestamptz,
    prompt_tokens      integer,
    completion_tokens  integer,
    error              text,
    CHECK (finished_at IS NULL OR started_at IS NOT NULL)
);
CREATE INDEX agent_runs_conversation_idx ON agent_runs (conversation_id, queued_at);
-- La cola por clave: cuántas ejecuciones ocupan concurrencia ahora mismo.
CREATE INDEX agent_runs_queue_idx ON agent_runs (ollama_key_id, queued_at)
    WHERE status IN ('queued', 'running');

CREATE TABLE agent_tool_calls (
    run_id          uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    seq             smallint NOT NULL,
    tool            text NOT NULL,
    arguments       jsonb NOT NULL DEFAULT '{}',
    result_summary  text,
    duration_ms     integer,
    PRIMARY KEY (run_id, seq)
);

-- Cada cifra de una respuesta apunta a la consulta que la produjo.
CREATE TABLE agent_citations (
    run_id   uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    ref      smallint NOT NULL,                -- el [1], [2]… del texto
    label    text NOT NULL,
    tool     text NOT NULL,
    query    jsonb NOT NULL,                   -- argumentos para reproducir la cifra
    PRIMARY KEY (run_id, ref)
);

CREATE TABLE briefings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id    uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    week_start  date NOT NULL CHECK (extract(isodow FROM week_start) = 1),   -- lunes
    run_id      uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    headline    text NOT NULL,
    body        jsonb NOT NULL,                -- indicadores, hallazgos y recomendación
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, week_start)
);

CREATE TABLE alerts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    account_id       uuid REFERENCES social_accounts (id) ON DELETE CASCADE,
    post_id          uuid REFERENCES posts (id) ON DELETE CASCADE,
    severity         alert_severity NOT NULL,
    metric_key       text REFERENCES metric_definitions (key),
    occurred_on      date NOT NULL,
    title            text NOT NULL,
    diagnosis        text,
    run_id           uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    acknowledged_at  timestamptz,
    acknowledged_by  uuid REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX alerts_open_idx ON alerts (brand_id, occurred_on DESC) WHERE acknowledged_at IS NULL;

COMMIT;
