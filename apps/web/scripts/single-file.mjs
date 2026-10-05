// Empaqueta la aplicación ya compilada en un único archivo HTML, sin dependencias
// locales, para enseñarla en cualquier sitio que sirva una sola página.
//   npm run build && node scripts/single-file.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync('dist/assets/app.css', 'utf8');
const js = readFileSync('dist/assets/app.js', 'utf8');
if (/<\/script/i.test(js)) throw new Error('El bundle contiene «</script»; no se puede incrustar tal cual.');

const html = `<title>Atalaya Web</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync('dist/atalaya-web.html', html);
console.log(`dist/atalaya-web.html: ${(html.length / 1024).toFixed(0)} KB`);
