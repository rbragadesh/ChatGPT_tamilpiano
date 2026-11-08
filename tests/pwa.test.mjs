import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildPwa } from '../scripts/build-pwa.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'isai-pwa-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'assets'));
  for (const file of ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'assets/app.js']) {
    await writeFile(path.join(dir, file), `contents:${file}`);
  }
  return dir;
}

test('PWA build includes nested assets, remains deterministic, and changes with content', async t => {
  const dir = await fixture(t);
  const first = await buildPwa(dir);
  assert(first.files.includes('assets/app.js'));
  assert(!first.files.includes('sw.js'));
  assert.equal((await buildPwa(dir)).version, first.version);
  const worker = await readFile(path.join(dir, 'sw.js'), 'utf8');
  assert(!worker.includes('__CACHE_VERSION__'));
  assert(!worker.includes('__PRECACHE_ASSETS__'));
  await writeFile(path.join(dir, 'assets/app.js'), 'changed application');
  assert.notEqual((await buildPwa(dir)).version, first.version);
});

test('PWA build fails if the offline application shell is missing', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'isai-pwa-empty-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(buildPwa(dir), /requires index.html/);
});

test('manifest installs relative to a Pages repository subpath', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const base = 'https://example.github.io/ChatGPT_tamilpiano/';
  assert.equal(new URL(manifest.start_url, base).href, base);
  assert.equal(new URL(manifest.scope, base).href, base);
  assert.equal(manifest.display, 'standalone');
  assert(manifest.icons.some(icon => icon.purpose === 'maskable'));
});

test('service worker serves coherent offline navigation and does not mask missing assets', async t => {
  const dir = await fixture(t);
  await buildPwa(dir);
  const handlers = {};
  const shell = new Response('offline application shell');
  const scope = 'https://example.github.io/ChatGPT_tamilpiano/';
  const fetched = [];
  const context = {
    URL, Set, Response,
    self: { registration: { scope }, addEventListener(type, handler) { handlers[type] = handler; } },
    caches: { async open() { return { async match(url) { return url === `${scope}index.html` ? shell : undefined; } }; } },
    async fetch(request) { fetched.push(request.url); throw new Error('offline'); },
  };
  vm.runInNewContext(await readFile(path.join(dir, 'sw.js'), 'utf8'), context);
  let response;
  handlers.fetch({ request: { method: 'GET', url: scope, mode: 'navigate' }, respondWith(value) { response = value; } });
  assert.equal(await (await response).text(), 'offline application shell');
  assert.equal(fetched.length, 1);
  let intercepted = false;
  handlers.fetch({ request: { method: 'GET', url: `${scope}missing.js`, mode: 'cors' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
  handlers.fetch({ request: { method: 'GET', url: 'https://example.github.io/other/', mode: 'navigate' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});
