// Inlines src/ into a single self-contained HTML file.
// Usage: node build.mjs
// Writes index.html and chess-offline.html (identical). No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(root, 'src', name), 'utf8').replace(/\r\n/g, '\n').trimEnd();

const parts = {
  '/*__CSS__*/': read('style.css'),
  '/*__ENGINE__*/': read('engine.js'),
  '/*__APP__*/': read('app.js'),
};

let html = read('template.html');
for (const [marker, text] of Object.entries(parts)) {
  if (!html.includes(marker)) throw new Error(`template.html is missing ${marker}`);
  if (/<\/(script|style)/i.test(text)) throw new Error(`${marker} source contains a closing script or style tag`);
  // split/join rather than replace(), so "$" in the source is left alone.
  html = html.split(marker).join(text);
}
html += '\n';

if (/\b(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html)) throw new Error('output references an external URL');

for (const name of ['index.html', 'chess-offline.html']) {
  writeFileSync(join(root, name), html);
  console.log(`wrote ${name} (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
}
