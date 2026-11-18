// Aplica db/migrations/*.sql en orden y, con --seed, db/seed/*.sql. Idempotente:
// lleva la cuenta en schema_migrations. 0003 (Timescale) se salta si la extensión no existe.
//   DATABASE_URL=postgres://… npm --prefix apps/api run db:migrate [-- --seed]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'db');

export async function migrate(databaseUrl: string, seed = false, log: (s: string) => void = console.log) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    const timescale = (await client.query("SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'")).rowCount! > 0;
    for (const file of readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      if (file.includes('timescale') && !timescale) {
        log(`omitida ${file} (sin timescaledb)`);
        continue;
      }
      await client.query(readFileSync(join(root, 'migrations', file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      log(`aplicada ${file}`);
    }
    if (seed) {
      for (const file of readdirSync(join(root, 'seed')).filter((f) => f.endsWith('.sql')).sort()) {
        await client.query(readFileSync(join(root, 'seed', file), 'utf8'));
        log(`semilla ${file}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL.');
    process.exit(1);
  }
  await migrate(url, process.argv.includes('--seed'));
}
