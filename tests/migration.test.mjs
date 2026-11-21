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
test('same-message plot-log blocks replay in order using persisted numeric base for each bump', () => {
  const base = applyText(emptyEngine(), '数据.金币: 10\n数据.生命值: 100').engine;
  const engine = replayNumericPlotLog(base, [
    { set: { 数据: { 金币: 20 } } },
    { bump: { 数据: { 金币: 3, 生命值: -10 } } },
    { set: { 数据: { 生命值: 50 } } },
    { bump: { 数据: { 生命值: 5 } } },
  ]);
  // Upstream bump's guard target uses message-start (10/100), then applies its
  // delta to the currently staged value (20/50).
  assert.equal(engine.variables.数据.金币, 13);
  assert.equal(engine.variables.数据.生命值, 105);
  assert.deepEqual(Object.keys(engine.LWB_RULES_V2).sort(), ['数据.生命值', '数据.金币']);
});
test('same-block set/bump overlap and repeated bumps do not accumulate', () => {
  const base = applyText(emptyEngine(), initial).engine;
  const blocks = [{ bump: { 数据: { 金币: 2 } }, set: { 数据: { 金币: 90 } } }, { bump: { 数据: { 金币: 3 } } }];
  const engine = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/plot-log-numeric', version: 1, baseEngine: base, blocks }));
  assert.equal(engine.variables.数据.金币, 13);
  assert.deepEqual(engine.LWB_RULES_V2, { '数据.金币': { typeLock: 'number' } });
  assert.equal(base.variables.数据.金币, 10);
  const noSet = replayNumericPlotLog(base, blocks.map(({ bump }) => ({ bump })));
  assert.equal(noSet.variables.数据.金币, 13);
  assert.deepEqual(noSet.LWB_RULES_V2, {});
});
test('plot-log preserves the upstream subtract-then-add rounding order', () => {
  const base = applyText(emptyEngine(), initial).engine;
  const engine = replayNumericPlotLog(base, [{ set: { 数据: { 金币: 1e20 } }, bump: { 数据: { 金币: 1 } } }]);
  assert.equal(engine.variables.数据.金币, 0);
});
test('plot-log normalizes fixed operation aliases before applying set then bump', () => {
  const base = applyText(emptyEngine(), initial).engine;
  const engine = replayNumericPlotLog(base, [{ ' AdJuSt ': { 数据: { 金币: -2 } }, 記下: { 数据: { 金币: 50 } } }]);
  assert.equal(engine.variables.数据.金币, 8);
  assert.deepEqual(engine.LWB_RULES_V2, { '数据.金币': { typeLock: 'number' } });
  const set = value => ({ 数据: { 金币: value } });
  assert.equal(replayNumericPlotLog(base, [{ set: set(2), 记下: set(7) }]).variables.数据.金币, 7);
  assert.equal(replayNumericPlotLog(base, [{ BUMP: set(2), ' bump ': set(7) }]).variables.数据.金币, 19);
  assert.throws(() => replayNumericPlotLog(base, [{ bump: set(Number.MAX_VALUE), 调整: set(Number.MAX_VALUE) }]), { code: 'LWB_PLOT_SUBSET' });
  assert.throws(() => replayNumericPlotLog(base, [{ record: set(2), unknown: set(7) }]), { code: 'LWB_PLOT_SUBSET' });
  const wide = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]));
  const wideBase = { ...base, variables: { 数据: { ...wide } } };
  assert.throws(() => replayNumericPlotLog(wideBase, [{ bump: { 数据: { ...wide } }, 调整: { 数据: { ...wide } } }]), { code: 'LWB_PLOT_SUBSET' });
  assert.equal(base.variables.数据.金币, 10);
});
test('plot-log accepts explicit decimal bump strings without enabling custom aliases', () => {
  const base = applyText(emptyEngine(), initial).engine;
  const engine = replayNumericPlotLog(base, [{ bump: { 数据: { 金币: ' +2 ' } }, 调整: { 数据: { 金币: '-.5e1' } } }]);
  assert.equal(engine.variables.数据.金币, 7);
  assert.deepEqual(engine.LWB_RULES_V2, {});
  for (const value of ['', '  ', '0x10', '0b10', '1e999', '增加', true, null]) {
    assert.throws(() => replayNumericPlotLog(base, [{ bump: { 数据: { 金币: value } } }]), { code: 'LWB_PLOT_SUBSET' });
  }
  assert.throws(() => replayNumericPlotLog(base, [{ set: { 数据: { 金币: '2' } } }]), { code: 'LWB_PLOT_SUBSET' });
});
test('plot-log subset rejects unsupported operations and excessive or nonfinite input', () => {
  const base = applyText(emptyEngine(), initial).engine;
  for (const block of [{ push: { 数据: ['药'] } }, { del: ['数据'] }, { set: { 数据: { 新字段: 1 } } }, { set: { 数据: null } }, { set: { 数据: { 金币: [] } } }, { bump: { 数据: { '$ro 金币': 2 } } }]) assert.throws(() => replayNumericPlotLog(base, [block]));
  assert.throws(() => replayNumericPlotLog({ ...base, LWB_RULES_V2: { '数据.金币': { ro: true } } }, [{ bump: { 数据: { 金币: 1 } } }]));
  assert.throws(() => replayNumericPlotLog(base, Array.from({ length: 17 }, () => ({ bump: { 数据: { 金币: 1 } } }))), { code: 'LWB_PLOT_SUBSET' });
  const huge = { ...base, variables: { 数据: { 金币: Number.MAX_VALUE } } };
  assert.throws(() => replayNumericPlotLog(huge, [{ bump: { 数据: { 金币: Number.MAX_VALUE } } }]), { code: 'LWB_PLOT_SUBSET' });
  assert.equal(base.variables.数据.金币, 10);
  const numericKeys = { variables: { R: { '01': 10, '1': 'abc' } }, roots: ['R'], LWB_RULES_V2: {} };
  assert.throws(() => replayNumericPlotLog(numericKeys, [{ bump: { R: { '01': 2 } } }]));
  let deep = 1; for (let i = 0; i < 30; i++) deep = { a: deep };
  assert.throws(() => replayNumericPlotLog(base, [{ set: deep }]), { code: 'LWB_PLOT_SUBSET' });
  let called = false; const getter = {}; Object.defineProperty(getter, 'set', { enumerable: true, get() { called = true; return {}; } });
  assert.throws(() => replayNumericPlotLog(base, [getter])); assert.equal(called, false);
  const sparse = new Array(1); assert.throws(() => replayNumericPlotLog(base, sparse), { code: 'LWB_PLOT_SUBSET' });
  const cyclic = {}; cyclic.set = cyclic; assert.throws(() => replayNumericPlotLog(base, [cyclic]), { code: 'LWB_PLOT_SUBSET' });
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

test('legacy stateLogV2 floors migrate in numeric order and derive missing root claims', () => {
  const floors = {
    '2': { signature: '', rules: [], ops: [{ op: 'inc', path: '数据.金币', delta: 3 }], roots: [] },
    '0': { signature: '<state>数据.金币: 10</state>', rules: [], ops: [{ op: 'set', path: '数据', value: { 金币: 10 } }] }
  };
  const pack = value => JSON.stringify({ spec: 'dsh-tavern-lwb/legacy-state-log', version: 1, log: { version: 1, floors: value } });
  let selected; const engine = parseStateBackup(pack(floors), { onSelection: rows => { selected = rows; } });
  assert.equal(engine.variables.数据.金币, 13);
  assert.deepEqual(selected.map(row => row.floor), [0, 2]);
  const deferred = { '0': { ...floors['0'], roots: [] }, '2': { ...floors['2'], roots: ['数据'] } };
  assert.equal(parseStateBackup(pack(deferred)).variables.数据.金币, 13);
  const normalized = parseStateBackup(pack({ '0': { ...floors['0'], roots: ['数据', '', '数据'], rules: [{ path: '数据', rule: {} }] } }));
  assert.deepEqual(normalized.roots, ['数据']);
  assert.equal(normalized.variables.数据.金币, 10);
  assert.deepEqual(normalized.LWB_RULES_V2, {});
  assert.throws(() => parseStateBackup(pack({ '0': { ...floors['0'], roots: [{}] } })));
  assert.throws(() => parseStateBackup(pack({ '0': { ...floors['0'], rules: [{ path: '数据', rule: [] }] } })));
  assert.throws(() => parseStateBackup(pack({ '2': floors['2'] })));
  assert.throws(() => parseStateBackup(pack({ ...floors, '01': floors['2'] })));
  assert.throws(() => parseStateBackup(pack({ '0': { ...floors['0'], roots: ['constructor'] } })));
});

test('explicit legacy floor-zero checkpoint restores values before readonly rules', () => {
  const pack = checkpoint => JSON.stringify({ spec: 'dsh-tavern-lwb/legacy-state-log', version: 1,
    initialCheckpoint: checkpoint, log: { version: 1, floors: { '2': { signature: '', roots: [], rules: [], ops: [{ op: 'inc', path: '数据.金币', delta: 1 }] } } } });
  const checkpoint = { version: 1, points: { '0': { vars: { 数据: '{"金币":10}', native: 'do-not-import' }, rules: { '数据.金币': { ro: true } } } } };
  const diagnostics = [], engine = parseStateBackup(pack(checkpoint), { onDiagnostics: row => diagnostics.push(row) });
  assert.equal(engine.variables.数据.金币, 10);
  assert.equal(engine.LWB_RULES_V2['数据.金币'].ro, true);
  const checkpointOnly = JSON.parse(pack(checkpoint)); checkpointOnly.log.floors = {};
  const restoredOnly = parseStateBackup(JSON.stringify(checkpointOnly));
  assert.equal(restoredOnly.variables.数据.金币, 10);
  assert.equal(restoredOnly.LWB_RULES_V2['数据.金币'].ro, true);
  assert.equal(Object.hasOwn(engine.variables, 'native'), false);
  assert.ok(diagnostics.some(row => row.errors.length));
  assert.throws(() => parseStateBackup(pack({ ...checkpoint, version: 4 })));
  const withZero = JSON.parse(pack({ version: 999 }));
  withZero.log.floors['0'] = { signature: '', roots: ['数据'], rules: [], ops: [{ op: 'set', path: '数据', value: { 金币: 20 } }] };
  assert.equal(parseStateBackup(JSON.stringify(withZero)).variables.数据.金币, 21);
  assert.throws(() => parseStateBackup(pack({ version: 1, points: { '0': { vars: {}, rules: { '数据.金币': { ro: true } } } } })));
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

test('explicit swipe selection replays only the selected path and reports its mapping', () => {
  const make = amount => ({ v: 1, entries: [entry([{ op: 'set', path: '数据', value: { 金币: amount }, source: 'text' }])] });
  const floors = [{ floor: 0, selected: 1, records: [make(999), make(10)] }, { floor: 2, selected: 0, records: [{ v: 1, entries: [entry([{ op: 'inc', path: '数据.金币', delta: 2, source: 'json' }], { roots: [] })] }, make(888)] }];
  let selection;
  const engine = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-swipes', version: 1, floors }), { onSelection: rows => { selection = rows; } });
  assert.equal(engine.variables.数据.金币, 12);
  assert.deepEqual(selection, [{ floor: 0, selected: 1 }, { floor: 2, selected: 0 }]);
  for (const invalid of [[], [{ floor: 0, selected: 2, records: [make(1)] }], [{ floor: 0, selected: 0, records: [null] }], [floors[1], floors[0]], [floors[0], floors[0]]]) assert.throws(() => parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-swipes', version: 1, floors: invalid })));
});

test('WAL permits text root claim followed by JSON update in one entry', () => {
  const engine = parseStateBackup(wal([{ v: 1, entries: [entry([
    { op: 'set', path: '数据', value: { 金币: 10 }, source: 'text' },
    { op: 'inc', path: '数据.金币', delta: 2, source: 'json' }
  ])] }]));
  assert.equal(engine.variables.数据.金币, 12);
});

test('WAL rejects malformed structures but reports normal guard refusals without changing values', () => {
  const op = { op: 'set', path: '数据', value: { 金币: 10 }, source: 'text' };
  for (const invalid of [entry([op], { blocks: ['bad'] }), entry([{ ...op, op: 'execute' }])]) assert.throws(() => parseStateBackup(wal([{ v: 1, entries: [invalid] }])));
  const locked = entry([], { roots: [], rules: [{ path: '数据.金币', rule: { ro: true } }] });
  const diagnostics = [];
  const engine = parseStateBackup(wal([{ v: 1, entries: [entry([op]), locked, entry([{ op: 'inc', path: '数据.金币', delta: 1, source: 'text' }])] }]), { onDiagnostics: row => diagnostics.push(row) });
  assert.equal(engine.variables.数据.金币, 10);
  assert.ok(diagnostics.some(row => row.errors.length));
});
test('WAL retains temporary effects until later root claims and omits never-claimed roots', () => {
  const engine = parseStateBackup(wal([{ v: 1, entries: [
    entry([{ op: 'set', path: '数据', value: { 背包: ['先前'] }, source: 'text' }, { op: 'set', path: '临时', value: 99, source: 'text' }], { roots: [] }),
    entry([{ op: 'push', path: '数据.背包', value: '后来', source: 'text' }])
  ] }]));
  assert.deepEqual(engine.variables.数据.背包, ['先前', '后来']);
  assert.equal(Object.hasOwn(engine.variables, '临时'), false);
});
test('stored WAL keeps historical duplicate array deletion ordering', () => {
  const engine = parseStateBackup(wal([{ v: 1, entries: [entry([{ op: 'set', path: '数据', value: { 背包: ['a', 'b', 'c'] }, source: 'text' }]),
    entry([{ op: 'del', path: '数据.背包.0', source: 'json' }, { op: 'del', path: '数据.背包[0]', source: 'json' }], { roots: [] })] }]));
  assert.deepEqual(engine.variables.数据.背包, ['c']);
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
