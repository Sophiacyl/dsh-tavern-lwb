// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, releaseFiles } from './files.mjs';
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'dsh-tavern-lwb');
assert.equal(pkg.version, '0.1.0-beta.17');
assert.ok(!pkg.dependencies && !pkg.optionalDependencies && !pkg.peerDependencies);
assert.equal(pkg.exports['.'], './index.mjs');
assert.equal(pkg.exports['./client'], './client.js');
assert.equal(pkg.dsh.client.platform, 'web');
const files = await releaseFiles();
for (const file of files) {
  assert.ok(!/node_modules|package-lock|\.dsh|tests\/|\.tmp|\.py$/.test(file), file);
  if (/\.(m?js|cjs)$/.test(file)) {
    const checked = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8' });
    assert.equal(checked.status, 0, file + ': ' + checked.stderr);
    const text = await readFile(path.join(ROOT, file), 'utf8');
    for (const match of text.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
      const spec = match[2];
      assert.ok(spec.startsWith('.') || spec === 'node:crypto', 'Unexpected production import ' + spec);
      if (spec.startsWith('.')) assert.ok(files.includes(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))), 'Unpacked import ' + spec + ' in ' + file);
    }
  }
}
for (const locale of ['zh', 'en']) assert.ok(JSON.parse(await readFile(path.join(ROOT, 'locale', locale + '.json'))).meta.title);
const client = await readFile(path.join(ROOT, 'client.js'), 'utf8');
assert.ok(client.includes('Based on LittleWhiteBox by biex') && client.includes('https://github.com/RT15548/LittleWhiteBox'), 'Visible original-author attribution is required');
assert.ok(files.includes('licenses/LittleWhiteBox-COPYRIGHT'), 'Original COPYRIGHT must be distributed');
const icon = await readFile(path.join(ROOT, 'icon.svg'), 'utf8');
assert.ok(icon.includes('<svg') && !/<script|onload|https?:\/\//.test(icon.replace('http://www.w3.org/2000/svg', '')));
console.log(JSON.stringify({ ok: true, package: pkg.name, version: pkg.version, runtimeFiles: files.length, dependencies: 0 }, null, 2));
