import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_ASSETS = {
  'basic-pitch-0.4.0.onnx': '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',
  LICENSE: '929c910bae2152fa87199a5d0660e09263419b7eee6d4b301d05ee2aaf211c37',
  NOTICE: 'b810e55c0e3b520fabb45fc2ccc74880187bf84e309971968541cc812dcde905',
  'ONNXRUNTIME-LICENSE': '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
  'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt': '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
};
export const RUNTIME_FILES = ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));

/** Verify committed, redistributable assets. Builds never download or replace model files. */
export async function verifyModelAssets(directory) {
  for (const [name, expected] of Object.entries(MODEL_ASSETS)) {
    let data;
    try { data = await readFile(path.join(directory, name)); }
    catch { throw new Error(`Bundled model asset ${name} is missing. Restore public/models from the repository; no model is downloaded during builds.`); }
    if (sha256(data) !== expected) throw new Error(`Bundled model asset ${name} failed SHA-256 verification. Restore the original asset; do not change its expected checksum.`);
  }
}

async function publicDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o755 });
  await chmod(directory, 0o755);
}
async function copyPublic(source, target) {
  await copyFile(source, target);
  await chmod(target, 0o644);
}
async function writePublic(filename, contents) {
  await writeFile(filename, contents, { mode: 0o644 });
  await chmod(filename, 0o644);
}
async function packageDirectory(name, from) {
  let current = from;
  while (true) {
    const candidate = path.join(current, 'node_modules', name);
    try { await readFile(path.join(candidate, 'package.json')); return candidate; }
    catch { /* Follow Node's upward node_modules search without executing a package. */ }
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Installed production dependency ${name} is missing. Run npm ci.`);
    current = parent;
  }
}

/** Preserve notices for shipped modules. The browser uses ORT's WASM-only entry. */
export async function copyDependencyNotices(root, dependencies) {
  const destination = path.join(root, 'public', 'licenses');
  await rm(destination, { recursive: true, force: true }); // Generated output, like dist/.
  await publicDirectory(destination);
  const found = new Set(), notices = [];
  async function visit(name, from) {
    const directory = await packageDirectory(name, from);
    const pkg = await readJson(path.join(directory, 'package.json'));
    const identity = `${pkg.name}@${pkg.version}`;
    if (found.has(identity)) return;
    found.add(identity);
    const folder = `${pkg.name.replaceAll('/', '__')}@${pkg.version}`;
    const output = path.join(destination, folder);
    await publicDirectory(output);
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^(?:licen[cs]e|notice|copying|thirdpartynotices)(?:[._-].*)?$/i.test(entry.name)) {
        await copyPublic(path.join(directory, entry.name), path.join(output, entry.name));
        files.push(`${folder}/${entry.name}`);
      }
    }
    // Microsoft's npm runtime packages declare MIT but omit these upstream texts.
    // Keep the exact v1.31.1 release license and full third-party notices alongside them.
    if (pkg.name === 'onnxruntime-web' || pkg.name === 'onnxruntime-common') {
      if (pkg.version !== '1.31.1') throw new Error('ONNX Runtime notices are pinned to 1.31.1. Review and update the release notices before changing the runtime version.');
      for (const [source, filename] of [['ONNXRUNTIME-LICENSE', 'LICENSE'], ['ONNXRUNTIME-THIRD-PARTY-NOTICES.txt', 'ThirdPartyNotices.txt']]) {
        await copyPublic(path.join(root, 'public', 'models', source), path.join(output, filename));
        if (!files.includes(`${folder}/${filename}`)) files.push(`${folder}/${filename}`);
      }
    }
    if (!files.length) throw new Error(`No license/notice text was found for ${identity}. Review its distribution terms before publishing.`);
    notices.push({ name: pkg.name, version: pkg.version, license: pkg.license || 'See bundled notice', files: files.sort() });
    // The WASM-only ORT entry excludes its separate ONNX.js/WebGL implementation
    // and that implementation's GUID/protobuf/platform dependencies. They remain
    // development installation files and are not copied into the published app.
    const shippedDependencies = pkg.name === 'onnxruntime-web'
      ? { 'onnxruntime-common': pkg.dependencies['onnxruntime-common'] }
      : pkg.dependencies || {};
    for (const dependency of Object.keys(shippedDependencies).sort()) await visit(dependency, directory);
  }
  for (const name of Object.keys(dependencies).sort()) await visit(name, root);
  notices.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  await writePublic(path.join(destination, 'index.json'), JSON.stringify(notices, null, 2) + '\n');
  return notices;
}

export async function prepareModel(root = defaultRoot) {
  const modelDirectory = path.join(root, 'public', 'models');
  await verifyModelAssets(modelDirectory);
  const app = await readJson(path.join(root, 'package.json'));
  const pinned = app.dependencies?.['onnxruntime-web'];
  if (!/^\d+\.\d+\.\d+$/.test(pinned || '')) throw new Error('Pin onnxruntime-web to an exact version before preparing browser inference assets.');
  const runtimeDirectory = await packageDirectory('onnxruntime-web', root);
  const runtime = await readJson(path.join(runtimeDirectory, 'package.json'));
  if (runtime.version !== pinned) throw new Error('Installed ONNX Runtime differs from package.json. Run npm ci.');
  const output = path.join(root, 'public', 'onnx');
  await publicDirectory(output);
  const files = [];
  for (const name of RUNTIME_FILES) {
    const source = path.join(runtimeDirectory, 'dist', name);
    const data = await readFile(source);
    await copyPublic(source, path.join(output, name));
    files.push({ name, sha256: sha256(data), bytes: data.length });
  }
  await writePublic(path.join(output, 'assets.json'), JSON.stringify({ package: runtime.name, version: runtime.version, files }, null, 2) + '\n');
  const notices = await copyDependencyNotices(root, app.dependencies || {});
  return { model: 'basic-pitch-0.4.0.onnx', runtime: runtime.version, files, dependencyNotices: notices.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareModel();
  console.log(`Verified Basic Pitch model; prepared ONNX Runtime ${result.runtime} and ${result.dependencyNotices} dependency notices for same-origin browser inference.`);
}
