// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { referenceModule } from '../scripts/prepare-test-references.mjs';
const { readPluginArchive } = await import(referenceModule('api8', 'domain/user-plugin-install.js'));
const root = new URL('../', import.meta.url).pathname;

test('distributed ZIP passes actual Tavern parser, contains required licenses and runs standalone without research imports', async t => {
  const archive = await readFile(path.join(root, 'dist/dsh-tavern-lwb-0.1.0-beta.49.zip'));
  const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json')));
  assert.equal(createHash('sha256').update(archive).digest('hex'), manifest.sha256);
  const { pkg, files } = readPluginArchive(archive);
  assert.equal(pkg.name, 'dsh-tavern-lwb');
  assert.equal(pkg.version, '0.1.0-beta.49');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(archive.length, manifest.bytes);
  assert.deepEqual([...files.keys()].sort(), manifest.files.map(item => item.path).sort());
  for (const item of manifest.files) {
    const shipped = files.get(item.path), current = await readFile(path.join(root, item.path));
    assert.equal(shipped.length, item.size, item.path + ' size');
    assert.equal(createHash('sha256').update(shipped).digest('hex'), item.sha256, item.path + ' manifest hash');
    assert.deepEqual(shipped, current, item.path + ' must match current runtime source');
  }
  assert.ok(files.has('licenses/LittleWhiteBox-LICENSE.md'));
  assert.ok(files.has('vendor/LICENSE-js-yaml.txt'));
  assert.ok(files.has('NOTICE'));
  assert.ok([...files.keys()].every(key => !key.startsWith('tests/') && !key.includes('node_modules') && !key.includes('package-lock')));
  const parent = path.join(root, 'tests/.tmp'); await mkdir(parent, { recursive: true });
  const unpacked = await mkdtemp(path.join(parent, 'unpacked-'));
  t.after(() => rm(unpacked, { recursive: true, force: true }));
  for (const [file, bytes] of files) { assert.ok(!file.split('/').includes('..')); const full = path.join(unpacked, file); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, bytes); }
  const entry = await import(pathToFileURL(path.join(unpacked, 'index.mjs')).href);
  const core = await import(pathToFileURL(path.join(unpacked, 'core/index.mjs')).href);
  assert.equal(entry.name, pkg.name);
  assert.equal(core.applyText(core.emptyEngine(), '数据.值: 100').engine.variables.数据.值, 100);
  const registrations = [];
  const tavern = { apiVersion: 7,
    getTurn() {}, getTurnState() {}, readTurnData() {}, saveTurnData() {}, readGameData() {}, saveGameData() {},
    handle(id) { registrations.push(id); }, turnSection() {}, settlementTask() {}, manualTask() {}, startTask() {}, getHistory() {},
  };
  entry.apply({ tavern, effect() {} });
  assert.equal(registrations.length, 18);
  assert.ok(registrations.includes(pkg.name + '/compat/varevent-static-preview'));
  assert.ok(registrations.includes(pkg.name + '/compat/varevent-inspect'));
  assert.ok(registrations.includes(pkg.name + '/migration-preview'));
  assert.ok(registrations.includes(pkg.name + '/migration-commit'));
});
