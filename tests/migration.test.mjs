// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStateBackup, replayStateHistory } from '../core/migration.mjs';
import { applyText, emptyEngine } from '../core/index.mjs';
import { replayNumericPlotLog } from '../core/plot-log.mjs';
const initial = '数据.金币: 10';
test('v1 numeric plot-log converts disjoint numeric fields', () => {
  const base = applyText(emptyEngine(), initial + '\n数据.生命值: 100').engine;
  const blocks = [{ bump: { 数据: { 金币: -2 } }, set: { 数据: { 生命值: 20 } } }];
  const before = JSON.stringify(base), engine = replayNumericPlotLog(base, blocks);
  assert.equal(engine.variables.数据.金币, 8); assert.equal(engine.variables.数据.生命值, 20); assert.equal(JSON.stringify(base), before);
  const packed = JSON.stringify({ spec: 'dsh-tavern-lwb/plot-log-numeric', version: 1, baseEngine: base, blocks });
  assert.deepEqual(parseStateBackup(packed), engine);
});
test('plot-log subset rejects semantic ambiguity instead of guessing', () => {
  const base = applyText(emptyEngine(), initial).engine;
  for (const block of [{ push: { 数据: ['药'] } }, { del: ['数据'] }, { bump: { 数据: { 金币: '+2' } } }, { set: { 数据: { 新字段: 1 } } }, { set: { 数据: null } }, { set: { 数据: { 金币: [] } } }, { bump: { 数据: { '$ro 金币': 2 } } }]) assert.throws(() => replayNumericPlotLog(base, [block]));
  assert.throws(() => replayNumericPlotLog({ ...base, LWB_RULES_V2: { '数据.金币': { ro: true } } }, [{ bump: { 数据: { 金币: 1 } } }]));
  assert.throws(() => replayNumericPlotLog(base, [{ set: { 数据: { 金币: 20 } }, bump: { 数据: { 金币: -2 } } }]));
  assert.throws(() => replayNumericPlotLog(base, [{ bump: { 数据: { 金币: 1 } } }, { bump: { 数据: { 金币: 2 } } }]));
  const numericKeys = { variables: { R: { '01': 10, '1': 'abc' } }, roots: ['R'], LWB_RULES_V2: {} };
  assert.throws(() => replayNumericPlotLog(numericKeys, [{ bump: { R: { '01': 2 } } }]));
  let deep = 1; for (let i = 0; i < 30; i++) deep = { a: deep };
  assert.throws(() => replayNumericPlotLog(base, [{ set: deep }]), { code: 'LWB_PLOT_SUBSET' });
  let called = false; const getter = {}; Object.defineProperty(getter, 'set', { enumerable: true, get() { called = true; return {}; } });
  assert.throws(() => replayNumericPlotLog(base, [getter])); assert.equal(called, false);
});
test('Bridge backup preserves values and readonly rules without executing them', () => {
  let engine = applyText(emptyEngine(), initial).engine;
  engine = applyText(engine, '$ro 数据.金币').engine;
  const restored = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/export', version: 1, engine }));
  assert.deepEqual(restored, engine);
  assert.equal(applyText(restored, '数据.金币: +1').status, 'failed');
  assert.throws(() => parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/export', version: 1, engine, warning: {} })));
  assert.throws(() => parseStateBackup('{"variables":{}}'));
});
test('explicit upstream snapshot decodes only declared roots and retains rule constraints', () => {
  const raw = { spec: 'dsh-tavern-lwb/upstream-snapshot', version: 1, variables: { 数据: '{"金币":10}', ignored: '私人宿主值' }, roots: ['数据'], LWB_RULES_V2: { '数据.金币': { ro: true } } };
  const engine = parseStateBackup(JSON.stringify(raw));
  assert.deepEqual(engine.variables, { 数据: { 金币: 10 } });
  assert.equal(engine.LWB_RULES_V2['数据.金币'].ro, true);
  assert.throws(() => parseStateBackup(JSON.stringify({ ...raw, roots: ['absent'] })));
  assert.throws(() => parseStateBackup(JSON.stringify({ ...raw, variables: { 数据: '' } })));
});

const wal = records => JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records });
const entry = (ops, patch = {}) => ({ kind: 'call', source: 'text', blocks: [], rules: [], ops, roots: ['数据'], ...patch });
test('explicit WAL preserves text/call order and internal pop semantics', () => {
  const records = [{ v: 1, entries: [entry([{ op: 'set', path: '数据', value: { 金币: 10, 背包: ['药', '钥匙'] }, source: 'text' }], { kind: 'text', blocks: ['0123456789abcdef'] })] },
    { v: 1, entries: [entry([{ op: 'inc', path: '数据.金币', delta: -2, source: 'json' }, { op: 'pop', path: '数据.背包', value: '药', source: 'text' }], { roots: [] })] }];
  const engine = parseStateBackup(wal(records));
  assert.equal(engine.variables.数据.金币, 8);
  assert.deepEqual(engine.variables.数据.背包, ['钥匙']);
  assert.deepEqual(engine.roots, ['数据']);
});
test('WAL accepts actual JSON call entries without optional arrays', () => {
  const engine = parseStateBackup(wal([{ v: 1, entries: [entry([{ op: 'set', path: '数据', value: { 金币: 1 }, source: 'text' }]), { kind: 'call', source: 'json', roots: [], ops: [{ op: 'inc', path: '数据.金币', delta: 2, source: 'json' }] }] }]));
  assert.equal(engine.variables.数据.金币, 3);
});
test('WAL preserves rules until a later entry claims their root', () => {
  const engine = parseStateBackup(wal([{ v: 1, entries: [entry([], { roots: [], rules: [{ path: '数据.金币', rule: { max: 5 } }] }), entry([{ op: 'set', path: '数据', value: { 金币: 10 }, source: 'text' }])] }]));
  assert.equal(engine.variables.数据.金币, 5);
});

test('WAL permits text root claim followed by JSON update in one entry', () => {
  const engine = parseStateBackup(wal([{ v: 1, entries: [entry([
    { op: 'set', path: '数据', value: { 金币: 10 }, source: 'text' },
    { op: 'inc', path: '数据.金币', delta: 2, source: 'json' }
  ])] }]));
  assert.equal(engine.variables.数据.金币, 12);
});

test('WAL rejects missing claims, invalid fingerprints, unknown operations and rejected guards', () => {
  const op = { op: 'set', path: '数据', value: { 金币: 10 }, source: 'text' };
  for (const invalid of [entry([op], { roots: [] }), entry([op], { blocks: ['bad'] }), entry([{ ...op, op: 'execute' }]), entry([{ ...op, source: 'json' }])]) assert.throws(() => parseStateBackup(wal([{ v: 1, entries: [invalid] }])));
  const locked = entry([], { roots: [], rules: [{ path: '数据.金币', rule: { ro: true } }] });
  assert.throws(() => parseStateBackup(wal([{ v: 1, entries: [entry([op]), locked, entry([{ op: 'inc', path: '数据.金币', delta: 1, source: 'text' }])] }])));
});

test('bounded history replay applies strict state blocks without changing source materials', () => {
  const rows = [{ turn: 2, textVersion: 'v2', rawText: '<state>数据.金币: -2</state>' }, { turn: 3, textVersion: 'v3', rawText: '无变化' }];
  const before = structuredClone(rows), result = replayStateHistory(initial, rows);
  assert.equal(result.engine.variables.数据.金币, 8);
  assert.deepEqual(rows, before);
  assert.deepEqual(result.report.map(row => row.status), ['success', 'noop']);
  assert.throws(() => replayStateHistory(initial, [{ turn: 2, rawText: '<state>损坏语句</state>' }]), { code: 'LWB_MIGRATION' });
  assert.throws(() => replayStateHistory(initial, Array(101).fill(rows[0])), { code: 'LWB_MIGRATION' });
  for (const rawText of ['<plot-log>{"set":{}}</plot-log>', '<varevent>condition: true</varevent>']) assert.throws(() => replayStateHistory(initial, [{ turn: 2, rawText }]), { code: 'LWB_MIGRATION' });
});
