// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStateBackup, replayStateHistory } from '../core/migration.mjs';
import { applyText, emptyEngine } from '../core/index.mjs';
const initial = '数据.金币: 10';
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
