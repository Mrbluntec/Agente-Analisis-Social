-- Prueba de humo del esquema. Se ejecuta dentro de una transacción y no deja rastro.
--   psql -v ON_ERROR_STOP=1 -d atalaya -f db/tests/smoke.sql
-- Si termina con «smoke ok», las restricciones clave se comportan como se espera.

BEGIN;

INSERT INTO organizations (id, name, slug) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Agencia de prueba', 'agencia-prueba');
INSERT INTO users (id, email, name) VALUES ('00000000-0000-0000-0000-0000000000b1', 'Ana@Ejemplo.test', 'Ana');
INSERT INTO memberships (org_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'owner');
INSERT INTO brands (id, org_id, name, slug) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Marca de prueba', 'marca-prueba');

-- Cuenta propia con token y cuenta de la competencia sin él.
INSERT INTO social_accounts (id, brand_id, network, external_id, handle, token_ciphertext, token_key_id)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'instagram', '1789', 'marca', '\xdeadbeef', 'kms-1');
INSERT INTO social_accounts (id, brand_id, network, external_id, handle, is_competitor)
VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'instagram', '4455', 'rival', true);

INSERT INTO posts (id, account_id, external_id, format, published_at)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'p1', 'reel', '2026-09-29 18:32-05');

-- Curva de vida: tres fotos acumuladas de alcance.
INSERT INTO post_metric_snapshots (post_id, metric_key, captured_at, value) VALUES
    ('00000000-0000-0000-0000-0000000000e1', 'reach', '2026-09-30 18:32-05', 8200),
    ('00000000-0000-0000-0000-0000000000e1', 'reach', '2026-10-01 18:32-05', 11400),
    ('00000000-0000-0000-0000-0000000000e1', 'reach', '2026-10-02 18:32-05', 12900);

INSERT INTO account_metric_snapshots (account_id, metric_key, captured_on, value) VALUES
    ('00000000-0000-0000-0000-0000000000d1', 'reach', '2026-10-01', 9400),
    ('00000000-0000-0000-0000-0000000000d1', 'reach', '2026-10-02', 7800);
INSERT INTO account_metric_snapshots (account_id, metric_key, dimension, dimension_value, captured_on, value) VALUES
    ('00000000-0000-0000-0000-0000000000d1', 'followers', 'country', 'EC', '2026-10-02', 21000);

INSERT INTO ollama_keys (id, org_id, scope, ciphertext, key_id, last4, max_concurrency)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'org', '\x01', 'kms-1', 'a1b2', 3);
INSERT INTO ollama_keys (org_id, scope, user_id, ciphertext, key_id, last4)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'user', '00000000-0000-0000-0000-0000000000b1', '\x02', 'kms-1', 'c3d4');

INSERT INTO agent_runs (id, brand_id, mode, ollama_key_id, model, question)
VALUES ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000c1', 'briefing', '00000000-0000-0000-0000-0000000000f1', 'modelo-de-prueba', 'Briefing semanal');
INSERT INTO briefings (brand_id, week_start, run_id, headline, body)
VALUES ('00000000-0000-0000-0000-0000000000c1', '2026-10-05', '00000000-0000-0000-0000-000000000091', 'Titular', '{}');

DO $$
DECLARE
    n numeric;
BEGIN
    -- 1. El correo no distingue mayúsculas.
    PERFORM 1 FROM users WHERE email = 'ana@ejemplo.test';
    IF NOT FOUND THEN RAISE EXCEPTION 'citext: el correo debería coincidir sin importar mayúsculas'; END IF;

    -- 2. La vista devuelve la foto más reciente.
    SELECT value INTO n FROM post_latest_metrics
     WHERE post_id = '00000000-0000-0000-0000-0000000000e1' AND metric_key = 'reach';
    IF n <> 12900 THEN RAISE EXCEPTION 'post_latest_metrics devolvió %, se esperaba 12900', n; END IF;

    -- 3. El total diario excluye los desgloses por dimensión.
    SELECT sum(value) INTO n FROM account_metric_snapshots
     WHERE account_id = '00000000-0000-0000-0000-0000000000d1' AND metric_key = 'reach' AND dimension = '';
    IF n <> 17200 THEN RAISE EXCEPTION 'suma de alcance %, se esperaba 17200', n; END IF;

    -- 4. Una cuenta de la competencia no puede llevar token.
    BEGIN
        INSERT INTO social_accounts (brand_id, network, external_id, handle, is_competitor, token_ciphertext, token_key_id)
        VALUES ('00000000-0000-0000-0000-0000000000c1', 'tiktok', '99', 'rival2', true, '\x00', 'kms-1');
        RAISE EXCEPTION 'se aceptó un token en una cuenta de la competencia';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- 5. Solo una clave de agencia activa.
    BEGIN
        INSERT INTO ollama_keys (org_id, scope, ciphertext, key_id, last4)
        VALUES ('00000000-0000-0000-0000-0000000000a1', 'org', '\x03', 'kms-1', 'e5f6');
        RAISE EXCEPTION 'se aceptaron dos claves de agencia activas';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- 6. Una clave personal exige usuario.
    BEGIN
        INSERT INTO ollama_keys (org_id, scope, ciphertext, key_id, last4)
        VALUES ('00000000-0000-0000-0000-0000000000a1', 'user', '\x04', 'kms-1', 'g7h8');
        RAISE EXCEPTION 'se aceptó una clave personal sin usuario';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- 7. Tras revocar la clave de agencia se puede registrar otra.
    UPDATE ollama_keys SET revoked_at = now() WHERE id = '00000000-0000-0000-0000-0000000000f1';
    INSERT INTO ollama_keys (org_id, scope, ciphertext, key_id, last4)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'org', '\x05', 'kms-1', 'i9j0');

    -- 8. Un briefing empieza en lunes.
    BEGIN
        INSERT INTO briefings (brand_id, week_start, run_id, headline, body)
        VALUES ('00000000-0000-0000-0000-0000000000c1', '2026-10-06', '00000000-0000-0000-0000-000000000091', 'x', '{}');
        RAISE EXCEPTION 'se aceptó un briefing que no empieza en lunes';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- 9. Un desglose necesita su valor de dimensión.
    BEGIN
        INSERT INTO account_metric_snapshots (account_id, metric_key, dimension, captured_on, value)
        VALUES ('00000000-0000-0000-0000-0000000000d1', 'followers', 'country', '2026-10-03', 1);
        RAISE EXCEPTION 'se aceptó una dimensión sin valor';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- 10. Borrar la marca arrastra cuentas, publicaciones y fotos.
    DELETE FROM brands WHERE id = '00000000-0000-0000-0000-0000000000c1';
    PERFORM 1 FROM post_metric_snapshots;
    IF FOUND THEN RAISE EXCEPTION 'quedaron fotos de métricas huérfanas tras borrar la marca'; END IF;
END $$;

ROLLBACK;

\echo smoke ok
