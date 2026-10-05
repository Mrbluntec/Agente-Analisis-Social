// Genera dist/tokens.css a partir de tokens.json.
//   node packages/tokens/build.mjs
// tokens.json es la única fuente: la comparte con el sistema de diseño publicado
// y, más adelante, con los exportadores a Compose y SwiftUI.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));

const themes = tokens.color.themes.map((t) => t.id);
const [primary, ...others] = themes;

/** Valor de un token de color en un tema; hereda del primario si falta. */
function colorIn(token, theme) {
  if (typeof token.value === 'string') return token.value;
  return token.value[theme] ?? token.value[primary];
}

const line = (name, value) => `  --${name}: ${value};`;

const shared = [];
for (const family of ['spacing', 'radius', 'size']) {
  for (const t of tokens[family]?.tokens ?? []) shared.push(line(t.name, t.value));
}
for (const [name, stack] of Object.entries(tokens.type.families)) {
  shared.push(line(`font-${name}`, stack));
}
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    shared.push(line(`text-${s.name}`, `${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${group.family})`));
  }
}

const colors = (theme) => tokens.color.tokens.map((t) => line(t.name, colorIn(t, theme)));
const indent = (lines) => lines.map((l) => `  ${l}`);

const out = [
  `/* Generado por build.mjs desde tokens.json (${tokens.name} v${tokens.version}). No editar a mano. */`,
  '',
  ':root {',
  `  color-scheme: ${primary};`,
  ...colors(primary),
  ...shared,
  '}',
];

for (const theme of others) {
  out.push(
    '',
    `:root[data-theme="${theme}"] {`,
    `  color-scheme: ${theme};`,
    ...colors(theme),
    '}',
    '',
    `@media (prefers-color-scheme: ${theme}) {`,
    `  :root:not([data-theme]) {`,
    `    color-scheme: ${theme};`,
    ...indent(colors(theme)),
    '  }',
    '}',
  );
}

// Comprobación: ningún nombre repetido fuera de la tipografía.
const names = ['color', 'spacing', 'radius', 'size'].flatMap((f) => (tokens[f]?.tokens ?? []).map((t) => t.name));
const repeated = names.filter((n, i) => names.indexOf(n) !== i);
if (repeated.length) {
  console.error(`Tokens repetidos: ${[...new Set(repeated)].join(', ')}`);
  process.exit(1);
}

const css = `${out.join('\n')}\n`;
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'tokens.css'), css);
// Ruta extra opcional: una app pide su copia con `node build.mjs src/styles/tokens.css`.
const extra = process.argv[2];
if (extra) {
  const target = resolve(process.cwd(), extra);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, css);
}
console.log(`tokens.css: ${names.length} tokens, ${themes.length} temas (${themes.join(', ')})`);
