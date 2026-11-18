-- Semilla idempotente: la agencia y la marca de muestra de packages/core/src/sample.ts.
-- Las ejecuciones del agente exigen una fila en brands (clave foránea).

INSERT INTO organizations (id, name, slug)
VALUES ('0c0ffee0-0000-4000-8000-0000000000a1', 'Agencia de muestra', 'agencia-muestra')
ON CONFLICT (id) DO NOTHING;

INSERT INTO brands (id, org_id, name, slug, timezone)
VALUES ('0c0ffee0-0000-4000-8000-000000000001', '0c0ffee0-0000-4000-8000-0000000000a1', 'Café Manglar', 'cafe-manglar', 'America/Guayaquil')
ON CONFLICT (id) DO NOTHING;
