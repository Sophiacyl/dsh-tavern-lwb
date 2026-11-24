// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Test-only prototype. No RPC, live host, or persistent storage.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeHistoryWritePlan, historyPlanDigest } from '../core/history-batch.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (row, target) => row?.turn === target.turn && row.textVersion === target.textVersion;

// The plan is trusted, immutable preview output, not caller data. Only exact
// rows can prove a completed write; a readTurnData fallback is missing here.
function classify(plan, observed) {
  let completed = 0, pending = false;
  for (const [index, step] of plan.entries()) {
    const { material, row } = observed[index];
    if (!exact(material, step) || fingerprint(material.rawText) !== step.source) return { completed, conflict: step.turn };
    // A same-turn wrong-version response is inconsistent, not an absent row.
    if (row && row.turn >= step.turn && !exact(row, step)) return { completed, conflict: step.turn };
    const hash = exact(row, step) ? fingerprint(row.data) : null;
    if (hash === fingerprint(step.output)) {
      if (pending) return { completed, conflict: step.turn };
      completed++;
    } else if (hash === step.before) pending = true;
    else return { completed, conflict: step.turn };
  }
  return { completed, conflict: null };
}

function fixture() {
  const materials = [1, 2, 3].map(turn => ({ turn, textVersion: `v${turn}`, rawText: `synthetic-${turn}` }));
  const rows = new Map();
  const plan = materials.map(({ turn, textVersion, rawText }) => ({ turn, textVersion, source: fingerprint(rawText), before: null,
    output: { plan: 'synthetic-plan-a', turn, state: { n: turn } } }));
  const observe = () => materials.map(material => ({ material, row: [...rows.values()].filter(row => row.turn <= material.turn && materials[row.turn - 1].textVersion === row.textVersion).sort((a, b) => b.turn - a.turn)[0] }));
  function write(step, { lostReply = false } = {}) {
    rows.set(step.turn, { turn: step.turn, textVersion: step.textVersion, data: structuredClone(step.output) });
    if (lostReply) throw new Error('synthetic transport failure after commit');
  }
  return { materials, rows, plan, observe, write, classify: () => classify(plan, observe()) };
}

test('batch coordinator preflights all rows, writes exact prefix, and confirms every write', async () => {
  const materials = new Map([1, 2].map(turn => [turn, { turn, textVersion: `v${turn}`, rawText: `body-${turn}` }]));
  const rows = new Map(), writes = [];
  const plan = [1, 2].map(turn => ({ turn, textVersion: `v${turn}`, rawText: `body-${turn}`, sourceDigest: fingerprint(`body-${turn}`), data: { n: turn }, outputDigest: historyPlanDigest({ n: turn }), beforeDigest: null }));
  const result = await executeHistoryWritePlan(plan, {
    readMaterial: async turn => materials.get(turn), readRow: async turn => rows.get(turn) || null,
    writeRow: async (turn, textVersion, data) => { writes.push(turn); rows.set(turn, { turn, textVersion, data }); },
  });
  assert.deepEqual(result, { completed: 2, total: 2, status: 'committed' });
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(await executeHistoryWritePlan(plan, {
    readMaterial: async turn => materials.get(turn), readRow: async turn => rows.get(turn) || null,
    writeRow: async () => { throw new Error('must skip exact rows'); },
  }), { completed: 2, total: 2, status: 'committed' });
});

test('batch coordinator performs no writes when any preflight source conflicts', async () => {
  const materials = new Map([[1, { turn: 1, textVersion: 'v1', rawText: 'changed' }]]), rows = new Map(), writes = [];
  const plan = [{ turn: 1, textVersion: 'v1', rawText: 'body', sourceDigest: fingerprint('body'), data: { n: 1 }, outputDigest: historyPlanDigest({ n: 1 }), beforeDigest: null }];
  await assert.rejects(executeHistoryWritePlan(plan, { readMaterial: async turn => materials.get(turn), readRow: async () => null, writeRow: async () => writes.push(1) }), { code: 'LWB_STALE' });
  assert.deepEqual(writes, []);
});

test('batch coordinator stops after a write cannot be confirmed', async () => {
  const materials = new Map([1, 2].map(turn => [turn, { turn, textVersion: `v${turn}`, rawText: `body-${turn}` }]));
  const rows = new Map(), writes = [];
  const plan = [1, 2].map(turn => ({ turn, textVersion: `v${turn}`, rawText: `body-${turn}`, sourceDigest: fingerprint(`body-${turn}`), data: { n: turn }, outputDigest: historyPlanDigest({ n: turn }), beforeDigest: null }));
  await assert.rejects(executeHistoryWritePlan(plan, { readMaterial: async turn => materials.get(turn), readRow: async turn => rows.get(turn) || null,
    writeRow: async (turn, textVersion, data) => { writes.push(turn); if (turn !== 1) rows.set(turn, { turn, textVersion, data }); },
  }), { code: 'LWB_WRITE_UNKNOWN' });
  assert.deepEqual(writes, [1]);
});

function batchFixture() {
  const plan = [1, 2, 3].map(turn => ({ turn, textVersion: `v${turn}`, rawText: `body-${turn}`, sourceDigest: fingerprint(`body-${turn}`), data: { plan: 'batch-a', n: turn }, outputDigest: fingerprint({ plan: 'batch-a', n: turn }), beforeDigest: null }));
  const materials = new Map(plan.map(step => [step.turn, { turn: step.turn, textVersion: step.textVersion, rawText: step.rawText }]));
  const rows = new Map(), writes = [];
  const put = step => rows.set(step.turn, { turn: step.turn, textVersion: step.textVersion, data: structuredClone(step.data) });
  const callbacks = { readMaterial: async turn => materials.get(turn), readRow: async turn => structuredClone(rows.get(turn) ?? null),
    writeRow: async (turn, textVersion, data) => { writes.push(turn); rows.set(turn, { turn, textVersion, data }); } };
  return { plan, materials, rows, writes, put, callbacks };
}

test('batch coordinator rejects non-prefix receipts and deleted preimages before writing', async () => {
  const f = batchFixture(); f.put(f.plan[1]);
  await assert.rejects(executeHistoryWritePlan(f.plan, f.callbacks), { code: 'LWB_CONFLICT' });
  assert.deepEqual(f.writes, []);
  f.rows.clear(); f.plan[0].beforeDigest = fingerprint({ memory: { revision: 1 } });
  await assert.rejects(executeHistoryWritePlan(f.plan, f.callbacks), { code: 'LWB_CONFLICT' });
  assert.deepEqual(f.writes, []);
});

test('batch coordinator rechecks material and preimage after preflight', async () => {
  for (const change of ['material', 'row']) {
    const f = batchFixture(); let reads = 0;
    const original = f.callbacks.readMaterial;
    f.callbacks.readMaterial = async turn => {
      if (++reads === 4) {
        if (change === 'material') f.materials.get(1).rawText = 'edited';
        else f.rows.set(1, { turn: 1, textVersion: 'v1', data: { foreign: true } });
      }
      return original(turn);
    };
    await assert.rejects(executeHistoryWritePlan(f.plan, f.callbacks), { code: change === 'material' ? 'LWB_STALE' : 'LWB_CONFLICT' });
    assert.deepEqual(f.writes, []);
  }
});

test('batch coordinator confirms lost acknowledgement and stops until explicit resume', async () => {
  const f = batchFixture(); const write = f.callbacks.writeRow;
  f.callbacks.writeRow = async (...args) => { await write(...args); throw Error('reply lost after commit'); };
  await assert.rejects(executeHistoryWritePlan(f.plan, f.callbacks), { code: 'LWB_BATCH_INTERRUPTED', completed: 1, confirmed: true, turn: 1 });
  assert.deepEqual(f.writes, [1]);
  f.callbacks.writeRow = write;
  assert.deepEqual(await executeHistoryWritePlan(f.plan, f.callbacks), { completed: 3, total: 3, status: 'committed' });
  assert.deepEqual(f.writes, [1, 2, 3]);
});

test('batch coordinator stops on unconfirmed failure, changed prefix and cancellation', async () => {
  const f = batchFixture(); f.callbacks.writeRow = async turn => { f.writes.push(turn); throw Error('write failed'); };
  await assert.rejects(executeHistoryWritePlan(f.plan, f.callbacks), { code: 'LWB_BATCH_INTERRUPTED', completed: 0, confirmed: false });
  assert.deepEqual(f.writes, [1]);
  const g = batchFixture(); const write = g.callbacks.writeRow;
  g.callbacks.writeRow = async (...args) => { await write(...args); if (args[0] === 2) g.rows.get(1).data = { foreign: true }; };
  await assert.rejects(executeHistoryWritePlan(g.plan, g.callbacks), { code: 'LWB_CONFLICT', completed: 2 });
  assert.deepEqual(g.writes, [1, 2]);
  const h = batchFixture(), controller = new AbortController();
  h.callbacks.writeRow = async (turn, textVersion, data) => { h.writes.push(turn); h.rows.set(turn, { turn, textVersion, data }); controller.abort(); };
  await assert.rejects(executeHistoryWritePlan(h.plan, { ...h.callbacks, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(h.writes, [1]);
});

test('batch coordinator rejects malformed plans without invoking callbacks', async () => {
  const f = batchFixture(); let calls = 0;
  const callbacks = { readMaterial: () => { calls++; }, readRow: () => { calls++; }, writeRow: () => { calls++; } };
  for (const plan of [[null], [f.plan[1], f.plan[0]], [{ ...f.plan[0], outputDigest: 'bad' }], [{ ...f.plan[0], data: null }], [{ ...f.plan[0], beforeDigest: undefined }], [{ ...f.plan[0], data: { changed: true } }]]) {
    await assert.rejects(executeHistoryWritePlan(plan, callbacks), { code: 'LWB_BATCH_PLAN' });
  }
  assert.equal(calls, 0);
});

test('history resume recognizes a write whose acknowledgement was lost, not a fallback row', () => {
  const f = fixture();
  assert.throws(() => f.write(f.plan[0], { lostReply: true }), /after commit/);
  assert.equal(f.observe()[1].row.turn, 1);
  assert.deepEqual(f.classify(), { completed: 1, conflict: null });
  for (const step of f.plan.slice(f.classify().completed)) f.write(step);
  assert.deepEqual(f.classify(), { completed: 3, conflict: null });
});

test('history resume refuses changed versions, changed source text, foreign rows and non-prefix receipts', () => {
  const f = fixture();
  f.write(f.plan[0]);
  f.materials[1].textVersion = 'v2-edited';
  assert.deepEqual(f.classify(), { completed: 1, conflict: 2 });
  f.materials[1].textVersion = 'v2';
  f.materials[1].rawText = 'changed without a version change';
  assert.deepEqual(f.classify(), { completed: 1, conflict: 2 });
  f.materials[1].rawText = 'synthetic-2';
  f.write({ ...f.plan[1], output: { ...f.plan[1].output, plan: 'foreign-plan' } });
  assert.deepEqual(f.classify(), { completed: 1, conflict: 2 });
  f.rows.delete(2);
  f.write(f.plan[2]);
  assert.deepEqual(f.classify(), { completed: 1, conflict: 3 });
});

test('history resume distinguishes a preserved preimage from a changed existing row', () => {
  const f = fixture();
  const preimage = { state: { n: 0 }, memory: { revision: 4 } };
  f.plan[0].before = fingerprint(preimage);
  f.plan[0].output.memory = preimage.memory;
  f.write({ ...f.plan[0], output: preimage });
  assert.deepEqual(f.classify(), { completed: 0, conflict: null });
  f.rows.get(1).data.memory.revision++;
  assert.deepEqual(f.classify(), { completed: 0, conflict: 1 });
});
