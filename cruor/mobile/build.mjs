// Builds the self-contained web bundle for the Android app into mobile/www.
// Usage: npm run build:mobile  (then: npx cap sync android)
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'mobile', 'www');
const nm = (p) => join(root, 'node_modules', p);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The web client, unchanged.
cpSync(join(root, 'public'), out, { recursive: true });

// 2. The on-device backend (API core + SQLite/WASM + crypto) as one script.
await build({
  entryPoints: [join(root, 'mobile', 'local-api.js')],
  outfile: join(out, 'local-api.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  minify: true,
  legalComments: 'linked',
  logLevel: 'warning',
});
cpSync(nm('sql.js/dist/sql-wasm-browser.wasm'), join(out, 'sql-wasm.wasm'));

// 3. Fonts bundled locally so the app looks right offline.
mkdirSync(join(out, 'fonts'));
const faces = [
  ['Inter', 'inter', 400], ['Inter', 'inter', 500], ['Inter', 'inter', 600],
  ['Fraunces', 'fraunces', 600], ['Fraunces', 'fraunces', 700],
];
const css = faces.map(([family, pkg, weight]) => {
  const file = `${pkg}-latin-${weight}-normal.woff2`;
  cpSync(nm(`@fontsource/${pkg}/files/${file}`), join(out, 'fonts', file));
  return `@font-face{font-family:${family};font-style:normal;font-weight:${weight};font-display:swap;src:url(/fonts/${file}) format('woff2')}`;
}).join('\n');
writeFileSync(join(out, 'fonts', 'fonts.css'), css + '\n');

// 4. Point index.html at local fonts and load the on-device backend before the client.
let html = readFileSync(join(out, 'index.html'), 'utf8');
const before = html;
html = html
  .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="/fonts/fonts.css">')
  .replace('<script src="/app.js" type="module"></script>', '<script src="/local-api.js"></script>\n  <script src="/app.js" type="module"></script>');
if (html === before || html.includes('fonts.googleapis.com') || !html.includes('/local-api.js')) {
  throw new Error('index.html did not match the expected structure; update mobile/build.mjs');
}
writeFileSync(join(out, 'index.html'), html);

console.log(`Mobile bundle ready in ${out}`);
