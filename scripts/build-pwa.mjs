import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildPwa(directory = path.resolve('dist')) {
  const paths = [];
  async function walk(dir, relative = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), child);
      else if (entry.isFile() && child !== 'sw.js' && !child.endsWith('.map')) paths.push(child);
    }
  }
  await walk(directory);
  paths.sort();
  for (const required of ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    if (!paths.includes(required)) throw new Error(`PWA build requires ${required}`);
  }
  const hash = createHash('sha256');
  for (const item of paths) {
    hash.update(item);
    hash.update(await readFile(path.join(directory, item)));
  }
  const version = hash.digest('hex').slice(0, 16);
  const templatePath = fileURLToPath(new URL('../public/sw.js', import.meta.url));
  const template = await readFile(templatePath, 'utf8');
  const worker = template.replace('__CACHE_VERSION__', version)
    .replace('/* __PRECACHE_ASSETS__ */ []', JSON.stringify(paths));
  await writeFile(path.join(directory, 'sw.js'), worker);
  return { version, files: paths };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPwa(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`PWA snapshot ${result.version}: ${result.files.length} files cached for offline use.`);
}
