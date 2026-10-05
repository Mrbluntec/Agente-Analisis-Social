-- Atalaya · 0001 · núcleo
-- Organizaciones, usuarios, marcas, cuentas sociales, publicaciones y claves de Ollama.
-- PostgreSQL 16. Sin extensiones opcionales: TimescaleDB entra en 0003.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

CREATE TYPE network AS ENUM ('instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'analyst', 'editor', 'viewer');
CREATE TYPE post_format AS ENUM ('reel', 'carousel', 'image', 'story', 'video', 'short', 'text', 'link');
CREATE TYPE account_status AS ENUM ('active', 'needs_reauth', 'paused', 'disconnected');
CREATE TYPE sync_kind AS ENUM ('daily', 'hourly_posts', 'backfill');
CREATE TYPE sync_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE key_scope AS ENUM ('org', 'user');

-- ---------------------------------------------------------------------------
-- Organización y acceso
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email          citext NOT NULL UNIQUE,
    name           text NOT NULL,
    password_hash  text,                       -- nulo si entra por SSO
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        member_role NOT NULL DEFAULT 'analyst',
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,         -- SHA-256 del token; el token nunca se guarda
    client      text NOT NULL DEFAULT 'web',   -- web | android | ios | macos
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- Marcas y cuentas sociales
-- ---------------------------------------------------------------------------

CREATE TABLE brands (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name         text NOT NULL,
    slug         text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    timezone     text NOT NULL DEFAULT 'America/Guayaquil',
    voice        text,                         -- tono que el agente usa al redactar para esta marca
    created_at   timestamptz NOT NULL DEFAULT now(),
    archived_at  timestamptz,
    UNIQUE (org_id, slug)
);

CREATE TABLE social_accounts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id           uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    network            network NOT NULL,
    external_id        text NOT NULL,          -- identificador de la cuenta en la red
    handle             text NOT NULL,
    display_name       text,
    is_competitor      boolean NOT NULL DEFAULT false,
    status             account_status NOT NULL DEFAULT 'active',
    -- Token OAuth con cifrado de sobre: el texto cifrado y el id de la clave que lo abre.
    token_ciphertext   bytea,
    token_key_id       text,
    token_expires_at   timestamptz,
    scopes             text[] NOT NULL DEFAULT '{}',
    connected_by       uuid REFERENCES users (id) ON DELETE SET NULL,
    connected_at       timestamptz NOT NULL DEFAULT now(),
    last_synced_at     timestamptz,
    last_error         text,
    UNIQUE (brand_id, network, external_id),
    -- Una cuenta propia lleva token; una de la competencia, nunca.
    CONSTRAINT token_matches_ownership CHECK (
        (is_competitor AND token_ciphertext IS NULL)
        OR (NOT is_competitor AND (token_ciphertext IS NULL) = (token_key_id IS NULL))
    )
);
CREATE INDEX social_accounts_brand_idx ON social_accounts (brand_id);

CREATE TABLE sync_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      uuid NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
    kind            sync_kind NOT NULL,
    status          sync_status NOT NULL DEFAULT 'running',
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    items           integer NOT NULL DEFAULT 0,
    api_calls       integer NOT NULL DEFAULT 0,
    cost_usd        numeric(10, 4) NOT NULL DEFAULT 0,   -- X cobra por lectura; el resto queda en 0
    raw_object_key  text,                                -- respuesta cruda archivada
    error           text
);
CREATE INDEX sync_runs_account_idx ON sync_runs (account_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Publicaciones
-- ---------------------------------------------------------------------------

CREATE TABLE posts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            uuid NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
    external_id           text NOT NULL,
    format                post_format NOT NULL,
    published_at          timestamptz NOT NULL,
    permalink             text,
    title                 text,
    caption               text,
    duration_seconds      integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    thumbnail_object_key  text,
    pillar                text,                -- pilar de contenido asignado por el agente
    ai_tags               jsonb NOT NULL DEFAULT '{}',   -- gancho, texto en pantalla, ritmo…
    ai_tagged_at          timestamptz,
    first_seen_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, external_id)
);
CREATE INDEX posts_account_published_idx ON posts (account_id, published_at DESC);
CREATE INDEX posts_pillar_idx ON posts (pillar) WHERE pillar IS NOT NULL;

CREATE TABLE annotations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id     uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    occurred_on  date NOT NULL,
    label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
    post_id      uuid REFERENCES posts (id) ON DELETE SET NULL,
    created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX annotations_brand_idx ON annotations (brand_id, occurred_on);

-- ---------------------------------------------------------------------------
-- Claves de Ollama Cloud
-- ---------------------------------------------------------------------------
-- Dos alcances: la clave de la agencia cubre las tareas programadas; la personal,
-- opcional, tiene prioridad en el chat de su dueño. La clave nunca se guarda en claro.

CREATE TABLE ollama_keys (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    scope            key_scope NOT NULL,
    user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
    ciphertext       bytea NOT NULL,
    key_id           text NOT NULL,            -- clave del servicio de claves que la abre
    last4            text NOT NULL CHECK (length(last4) = 4),
    max_concurrency  smallint NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 64),
    validated_at     timestamptz,              -- última validación contra Ollama Cloud
    created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    revoked_at       timestamptz,
    CONSTRAINT scope_matches_user CHECK ((scope = 'org') = (user_id IS NULL))
);
-- Una sola clave activa por agencia y una por usuario dentro de cada agencia.
CREATE UNIQUE INDEX ollama_keys_one_org_key ON ollama_keys (org_id)
    WHERE scope = 'org' AND revoked_at IS NULL;
CREATE UNIQUE INDEX ollama_keys_one_user_key ON ollama_keys (org_id, user_id)
    WHERE scope = 'user' AND revoked_at IS NULL;

COMMIT;
