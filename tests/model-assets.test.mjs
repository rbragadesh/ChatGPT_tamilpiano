import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDependencyNotices, MODEL_ASSETS, prepareModel, RUNTIME_FILES, verifyModelAssets } from '../scripts/prepare-model.mjs';

const sourceModels = fileURLToPath(new URL('../public/models/', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'isai-static-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const models = path.join(root, 'public', 'models');
  await mkdir(models, { recursive: true });
  for (const name of Object.keys(MODEL_ASSETS)) await copyFile(path.join(sourceModels, name), path.join(models, name));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'onnxruntime-web': '1.31.1' } }));
  const runtime = path.join(root, 'node_modules', 'onnxruntime-web');
  await mkdir(path.join(runtime, 'dist'), { recursive: true });
  await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: 'onnxruntime-web', version: '1.31.1', license: 'MIT', dependencies: { 'onnxruntime-common': '1.31.1', 'guid-typescript': '^1.0.9' } }));
  for (const name of RUNTIME_FILES) await writeFile(path.join(runtime, 'dist', name), `test fixture ${name}`);
  await writeFile(path.join(runtime, 'dist', 'ort-wasm-simd-threaded.jsep.wasm'), 'not used by the CPU entry');
  const common = path.join(root, 'node_modules', 'onnxruntime-common');
  await mkdir(common, { recursive: true });
  await writeFile(path.join(common, 'package.json'), JSON.stringify({ name: 'onnxruntime-common', version: '1.31.1', license: 'MIT' }));
  return { root, models, runtime };
}

test('committed Basic Pitch weights and release attribution pass pinned integrity checks', async () => {
  await verifyModelAssets(sourceModels);
  assert.equal(Object.keys(MODEL_ASSETS).length, 5);
});

test('static preparation copies CPU runtime and exact upstream attribution without network or Python', async t => {
  const { root } = await fixture(t);
  const result = await prepareModel(root);
  assert.equal(result.runtime, '1.31.1');
  assert.deepEqual(result.files.map(file => file.name), RUNTIME_FILES);
  for (const file of result.files) {
    assert.equal((await readFile(path.join(root, 'public', 'onnx', file.name), 'utf8')), `test fixture ${file.name}`);
    assert.match(file.sha256, /^[a-f\d]{64}$/);
  }
  await assert.rejects(readFile(path.join(root, 'public', 'onnx', 'ort-wasm-simd-threaded.jsep.wasm')), /ENOENT/);
  const notices = JSON.parse(await readFile(path.join(root, 'public', 'licenses', 'index.json'), 'utf8'));
  assert.deepEqual(notices.map(notice => notice.name), ['onnxruntime-common', 'onnxruntime-web']);
  for (const notice of notices) {
    assert.equal(await readFile(path.join(root, 'public', 'licenses', notice.files[0]), 'utf8'), await readFile(path.join(sourceModels, 'ONNXRUNTIME-LICENSE'), 'utf8'));
    assert.equal(await readFile(path.join(root, 'public', 'licenses', notice.files[1]), 'utf8'), await readFile(path.join(sourceModels, 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt'), 'utf8'));
  }
});

test('corrupt weights or notices fail before runtime files are copied', async t => {
  const { root, models } = await fixture(t);
  await writeFile(path.join(models, 'basic-pitch-0.4.0.onnx'), 'unexpected bytes');
  await assert.rejects(prepareModel(root), /failed SHA-256 verification/);
  await assert.rejects(readFile(path.join(root, 'public', 'onnx', RUNTIME_FILES[0])), /ENOENT/);
  await copyFile(path.join(sourceModels, 'basic-pitch-0.4.0.onnx'), path.join(models, 'basic-pitch-0.4.0.onnx'));
  await writeFile(path.join(models, 'NOTICE'), 'altered attribution');
  await assert.rejects(prepareModel(root), /NOTICE failed SHA-256 verification/);
});

test('missing assets and mismatched installed runtime versions have actionable failures', async t => {
  const { root, models, runtime } = await fixture(t);
  await rm(path.join(models, 'LICENSE'));
  await assert.rejects(prepareModel(root), /Restore public\/models/);
  await copyFile(path.join(sourceModels, 'LICENSE'), path.join(models, 'LICENSE'));
  await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: 'onnxruntime-web', version: '1.31.0' }));
  await assert.rejects(prepareModel(root), /Run npm ci/);
});

test('a newly shipped module without a license notice blocks preparation', async t => {
  const { root } = await fixture(t);
  const dependency = path.join(root, 'node_modules', 'unreviewed-module');
  await mkdir(dependency, { recursive: true });
  await writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'unreviewed-module', version: '1.0.0' }));
  await assert.rejects(copyDependencyNotices(root, { 'unreviewed-module': '1.0.0' }), /Review its distribution terms/);
});
