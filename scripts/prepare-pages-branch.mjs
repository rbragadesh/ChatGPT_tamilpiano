import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const site = path.join(root, 'site');
const marker = '.isai-generated';

// This directory is a publication output. Never replace unrelated user files.
let exists = false;
try { await access(site); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (exists) {
  let contents;
  try { contents = await readFile(path.join(site, marker), 'utf8'); } catch { throw new Error('site/ exists without the Isai generated-build marker. Preserve it before preparing Pages.'); }
  if (contents !== 'Isai static publication output\n') throw new Error('Unexpected site/ marker. Refusing to replace it.');
}
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('data-isai-mode="production"') || /src=["']\/src\/main\.tsx/.test(html)) throw new Error('Build the production app before preparing the Pages branch.');
await access(path.join(dist, 'sw.js'));
await access(path.join(dist, 'onnx', 'ort-wasm-simd-threaded.wasm'));
if (exists) await rm(site, { recursive: true });
await cp(dist, site, { recursive: true });
await writeFile(path.join(site, marker), 'Isai static publication output\n');
console.log('Prepared site/ for branch-based GitHub Pages. Commit it with source changes when using that publishing mode.');
