// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Explicit offline differential probe; not a runtime dependency or automatic download.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseStateBackup } from '../core/migration.mjs';
const root = process.env.LWB_UPSTREAM_ROOT;
if (!root) throw Error('Set LWB_UPSTREAM_ROOT to the fixed, public LittleWhiteBox checkout.');
const pinned = '707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a';
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pinned);
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
const moduleUrl = name => pathToFileURL(path.join(root, 'modules/variables/state2', name));
const { executeStateOperations } = await import(moduleUrl('executor.js'));
const { replaceRules } = await import(moduleUrl('guard-core.js'));
const entry = (ops, extra = {}) => ({ kind: 'call', source: 'text', roots: ['数据'], rules: [], blocks: [], ops, ...extra });
const set = (value, source = 'text') => ({ op: 'set', path: '数据', value, source });
const cases = [
  ['mixed text and JSON', [entry([set({ 金币: 10 }), { op: 'inc', path: '数据.金币', delta: 2, source: 'json' }])]],
  ['normal readonly refusal', [entry([set({ 金币: 10 })]), entry([{ op: 'inc', path: '数据.金币', delta: 2, source: 'text' }], { roots: [], rules: [{ path: '数据.金币', rule: { ro: true } }] })]],
  ['deferred ownership', [entry([set({ 背包: ['先前'] })], { roots: [] }), entry([{ op: 'push', path: '数据.背包', value: '后来', source: 'text' }])]],
  ['historical duplicate deletes', [entry([set({ 背包: ['a', 'b', 'c'] })]), entry([{ op: 'del', path: '数据.背包.0', source: 'json' }, { op: 'del', path: '数据.背包[0]', source: 'json' }], { roots: [] })]],
  ['earlier unclaimed rule', [entry([], { roots: [], rules: [{ path: '数据.金币', rule: { max: 5 } }] }), entry([set({ 金币: 10 })])]],
];
let checked = 0;
for (const [name, entries] of cases) {
  replaceRules({});
  const meta = { variables: {}, LWB_RULES_V2: {} }, owned = new Set();
  try {
    for (const item of structuredClone(entries)) {
      executeStateOperations(meta, item.rules || [], item.ops, { memory: true, report: true, ownedRoots: new Set(owned), claimRoots: new Set(item.roots) });
      for (const claim of item.roots) owned.add(claim);
    }
    const expected = { variables: Object.fromEntries(Object.entries(meta.variables).filter(([key]) => owned.has(key))), LWB_RULES_V2: Object.fromEntries(Object.entries(meta.LWB_RULES_V2).filter(([key]) => owned.has(key.split('.')[0]))), roots: [...owned] };
    const actual = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records: [{ v: 1, entries }] }));
    assert.deepEqual(actual, expected, name);
    checked++;
  } finally { replaceRules({}); }
}
console.log(JSON.stringify({ ok: true, pinned, checked, cases: cases.map(([name]) => name) }, null, 2));
