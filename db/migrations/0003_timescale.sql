-- Atalaya · 0003 · TimescaleDB (opcional)
-- Convierte las dos tablas de fotos en hipertablas y comprime lo antiguo.
-- Solo se aplica en un servidor con la extensión timescaledb instalada.
-- Las migraciones 0001 y 0002 funcionan sin ella.
--
-- NO VERIFICADA: el entorno donde se escribió no tiene TimescaleDB.
-- Probarla en el servidor de destino antes de darla por buena.

CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
    'post_metric_snapshots', 'captured_at',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data        => true,
    if_not_exists       => true
);

SELECT create_hypertable(
    'account_metric_snapshots', 'captured_on',
    chunk_time_interval => INTERVAL '30 days',
    migrate_data        => true,
    if_not_exists       => true
);

ALTER TABLE post_metric_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'post_id, metric_key',
    timescaledb.compress_orderby   = 'captured_at DESC'
);
SELECT add_compression_policy('post_metric_snapshots', INTERVAL '30 days', if_not_exists => true);

ALTER TABLE account_metric_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'account_id, metric_key',
    timescaledb.compress_orderby   = 'captured_on DESC'
);
SELECT add_compression_policy('account_metric_snapshots', INTERVAL '90 days', if_not_exists => true);
