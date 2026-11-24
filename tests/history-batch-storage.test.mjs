// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Synthetic storage integration; no public batch RPC or real save access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecordStore } from '../host/records.mjs';
import { createStateService } from '../host/service.mjs';
import { executeHistoryWritePlan, historyPlanDigest as hash } from '../core/history-batch.mjs';
import { applyText, emptyEngine } from '../core/index.mjs';

const materials = [1, 2, 3].map(turn => ({ turn, textVersion: `synthetic-v${turn}`, rawText: `synthetic-body-${turn}` }));
const envelopeSpec = 'dsh-tavern-lwb/record';
async function fixture(t) {
  const base = new URL('./.tmp/', import.meta.url);
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(new URL('batch-storage-', base));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'synthetic-store.json');
  const initial = Object.fromEntries(materials.map(({ turn, textVersion }) => [turn, { turn, textVersion,
    data: { spec: envelopeSpec, version: 1, state: null, memory: { revision: turn, text: `synthetic-memory-${turn}` } } }]));
  await writeFile(path, JSON.stringify(initial));
  const load = async () => JSON.parse(await readFile(path, 'utf8'));
  const writes = [];
  let lostReply = false;
  const tavern = {
    async getTurn({ turn }) { return structuredClone(materials[turn - 1]); },
    async getTurnState() { return { turn: 3, textVersion: 'synthetic-v3', busy: false, settled: true }; },
    async readGameData() { return null; },
    async readTurnData({ turn }) {
      const rows = await load();
      return Object.values(rows).filter(row => row.turn <= turn).sort((a, b) => b.turn - a.turn)[0] ?? null;
    },
    async saveTurnData({ turn, textVersion, data }) {
      assert.equal(textVersion, materials[turn - 1].textVersion);
      const rows = await load(); writes.push(turn); rows[turn] = { turn, textVersion, data };
      await writeFile(path, JSON.stringify(rows));
      if (lostReply) { lostReply = false; throw Error('synthetic acknowledgement lost'); }
    },
  };
  return { path, load, tavern, writes, loseNextReply() { lostReply = true; } };
}
function stateRecords() {
  let parent = null;
  return materials.map(({ turn }) => {
    const engine = applyText(emptyEngine(), `数据:\n  金币: ${turn}`).engine;
    const state = { spec: 'dsh-tavern-lwb/state', version: 1, engine, sourceKind: 'migration',
      sourceDigest: hash({ plan: 'synthetic-plan', turn }), parent,
      diagnostics: { status: 'success', operationCount: 1, errors: [], corrections: [], changes: [] }, savedAt: 1 };
    state.stateHash = hash([state.engine, state.sourceKind, state.sourceDigest, state.parent]);
    parent = { turn, stateHash: state.stateHash };
    return state;
  });
}
async function planFor(f) {
  const rows = await f.load(), states = stateRecords();
  return materials.map((material, index) => {
    const data = { ...rows[material.turn].data, state: states[index] };
    return { ...material, sourceDigest: hash(material.rawText), beforeDigest: hash(rows[material.turn].data), data, outputDigest: hash(data) };
  });
}
function callbacks(f, records) {
  return {
    readMaterial: turn => f.tavern.getTurn({ gameId: 'synthetic-game', turn }),
    readRow: turn => f.tavern.readTurnData({ gameId: 'synthetic-game', turn }),
    writeRow: async (turn, textVersion, data) => {
      // Verify full envelope in coordinator, merge through production state/memory adapter.
      await records.stateApi.saveTurnData({ gameId: 'synthetic-game', turn, textVersion, data: data.state });
    },
  };
}

test('batch uses production record adapter, preserves memory and resumes JSON-persisted plan after lost reply', async t => {
  const f = await fixture(t), plan = await planFor(f);
  const planPath = join(f.path, '..', 'synthetic-plan.json');
  await writeFile(planPath, JSON.stringify(plan));
  let records = createRecordStore(f.tavern);
  f.loseNextReply();
  await assert.rejects(records.withLock('synthetic-game', () => executeHistoryWritePlan(plan, callbacks(f, records))),
    { code: 'LWB_BATCH_INTERRUPTED', completed: 1, confirmed: true });
  assert.deepEqual(f.writes, [1]);
  await records.dispose();
  // Recreate adapter and coordinator inputs from disk, not the prior plan object.
  records = createRecordStore(f.tavern);
  const restored = JSON.parse(await readFile(planPath, 'utf8'));
  assert.deepEqual(await records.withLock('synthetic-game', () => executeHistoryWritePlan(restored, callbacks(f, records))),
    { status: 'committed', completed: 3, total: 3 });
  assert.deepEqual(f.writes, [1, 2, 3]);
  for (const row of Object.values(await f.load())) assert.deepEqual(row.data.memory,
    { revision: row.turn, text: `synthetic-memory-${row.turn}` });
  // Production lineage reader accepts the constructed parent chain.
  const service = createStateService(records.stateApi, { withLock: records.withLock });
  assert.equal((await service.readEngine('synthetic-game', 3)).variables.数据.金币, 3);
  await service.dispose(); await records.dispose();
});

test('changed memory preimage after preview blocks all writes through record adapter', async t => {
  const f = await fixture(t), plan = await planFor(f);
  const records = createRecordStore(f.tavern);
  await records.withLock('synthetic-game', () => records.saveMemory({ gameId: 'synthetic-game', turn: 2,
    textVersion: 'synthetic-v2', data: { revision: 99, text: 'synthetic concurrent memory' } }));
  const before = await f.load(); f.writes.length = 0;
  await assert.rejects(records.withLock('synthetic-game', () => executeHistoryWritePlan(plan, callbacks(f, records))), { code: 'LWB_CONFLICT' });
  assert.deepEqual(f.writes, []); assert.deepEqual(await f.load(), before);
  await records.dispose();
});
