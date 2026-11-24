// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordStore } from '../host/records.mjs';
import { createHistoryBatchService } from '../host/history-batch-service.mjs';
import { createStateService } from '../host/service.mjs';
function fixture() {
  let config = { enabled: true }, busy = false, lose = false;
  const rows = new Map(), writes = [];
  const materials = [1, 2].map(turn => ({ turn, textVersion: `v${turn}`, rawText: `synthetic-${turn}` }));
  const tavern = {
    async getTurnState() { return { turn: 2, textVersion: 'v2', settled: true, busy }; },
    async getTurn({ turn }) { return structuredClone(materials[turn - 1]); },
    async readGameData() { return structuredClone(config); },
    async saveGameData({ data }) { config = structuredClone(data); },
    async readTurnData({ turn }) { return structuredClone([...rows.values()].filter(row => row.turn <= turn).sort((a,b) => b.turn - a.turn)[0] ?? null); },
    async saveTurnData({ turn, textVersion, data }) { writes.push(turn); rows.set(turn, { turn, textVersion, data: structuredClone(data) }); if (lose) { lose = false; throw Error('reply lost'); } },
  };
  const args = { gameId: 'synthetic', expectedTextVersion: 'v2', targets: materials.map((row, floor) => ({ floor, turn: row.turn, textVersion: row.textVersion })),
    text: JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records: [1, 2].map(n => ({ v: 1, entries: [{ kind: 'call', roots: ['数据'], ops: [{ op: 'set', path: '数据', value: { n }, source: 'text' }] }] })) }) };
  return { tavern, args, rows, writes, config: () => config, busy: value => { busy = value; }, lose: () => { lose = true; } };
}
test('internal service prepares, explicitly confirms and reads valid lineage without nested lock deadlock', async () => {
  const f = fixture(), records = createRecordStore(f.tavern);
  const service = createHistoryBatchService(f.tavern, records, { now: () => 1 });
  const prepared = await service.prepare(f.args);
  assert.deepEqual(f.writes, []);
  assert.equal(Object.hasOwn(prepared, 'steps'), true);
  await assert.rejects(service.commit({ ...f.args, token: prepared.token }), { code: 'LWB_BATCH_PLAN' });
  f.busy(true);
  await assert.rejects(service.commit({ ...f.args, token: prepared.token, confirmReplace: true }), { code: 'LWB_BUSY' });
  f.busy(false);
  assert.deepEqual(await service.commit({ ...f.args, token: prepared.token, confirmReplace: true }), { completed: 2, total: 2, status: 'committed' });
  assert.deepEqual(f.writes, [1, 2]); assert.equal(f.config().historyWritePlan, undefined);
  const reader = createStateService(records.stateApi, { withLock: records.withLock });
  assert.equal((await reader.readEngine('synthetic', 2)).variables.数据.n, 2);
  await reader.dispose(); service.dispose(); await records.dispose();
});
test('disposing batch service during target read stops preparation without saving a plan', async () => {
  const f = fixture(), records = createRecordStore(f.tavern);
  const service = createHistoryBatchService(f.tavern, records, { now: () => 1 });
  const original = f.tavern.getTurn;
  f.tavern.getTurn = async args => { const result = await original(args); service.dispose(); return result; };
  await assert.rejects(service.prepare(f.args), { code: 'LWB_UNLOADED' });
  assert.equal(f.config().historyWritePlan, undefined); assert.deepEqual(f.writes, []);
  await records.dispose();
});
test('disposing batch service during commit read retains plan and writes no state', async () => {
  const f = fixture(), records = createRecordStore(f.tavern);
  const service = createHistoryBatchService(f.tavern, records, { now: () => 1 });
  const saved = await service.prepare(f.args);
  const original = f.tavern.readTurnData;
  f.tavern.readTurnData = async args => { const result = await original(args); service.dispose(); return result; };
  await assert.rejects(service.commit({ ...f.args, token: saved.token, confirmReplace: true }), { code: 'LWB_UNLOADED' });
  assert.equal(f.config().historyWritePlan.token, saved.token); assert.deepEqual(f.writes, []);
  await records.dispose();
});
test('internal service reloads retained plan after uncertain write using a new service instance', async () => {
  const f = fixture(); let records = createRecordStore(f.tavern);
  let service = createHistoryBatchService(f.tavern, records, { now: () => 1 });
  const saved = await service.prepare(f.args); f.lose();
  await assert.rejects(service.commit({ ...f.args, token: saved.token, confirmReplace: true }), { code: 'LWB_BATCH_INTERRUPTED', completed: 1, confirmed: true });
  assert.ok(f.config().historyWritePlan); service.dispose(); await records.dispose();
  records = createRecordStore(f.tavern); service = createHistoryBatchService(f.tavern, records, { now: () => 1 });
  await service.commit({ ...f.args, token: saved.token, confirmReplace: true });
  assert.deepEqual(f.writes, [1, 2]);
  assert.equal(f.config().historyWritePlan, undefined);
  service.dispose(); await records.dispose();
});
