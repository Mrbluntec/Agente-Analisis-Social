// Arranca el servidor y la web a la vez y mezcla sus salidas con un prefijo.
//   npm run dev          → web en http://localhost:5173, servidor en http://localhost:8787
// Ctrl+C detiene los dos.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  ['api', 'apps/api'],
  ['web', 'apps/web'],
].map(([name, dir]) => {
  const child = spawn(npm, ['run', 'dev'], { cwd: join(root, dir), env: process.env });
  const prefix = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) if (line.trim()) out.write(`[${name}] ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (code) console.error(`[${name}] terminó con código ${code}`);
  });
  return child;
});

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
