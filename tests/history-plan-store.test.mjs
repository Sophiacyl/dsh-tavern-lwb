// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryPlanStore } from '../host/history-plan-store.mjs';
function fixture() {
  const configs = new Map([['a', { spec: 'synthetic-config', enabled: true, unrelated: { n: 2 } }]]);
  let time = 1000, writes = 0;
  const dependencies = {
    readGameData: async ({ gameId }) => structuredClone(configs.get(gameId) ?? null),
    saveGameData: async ({ gameId, data }) => { writes++; configs.set(gameId, structuredClone(data)); },
    withLock: async (_game, work) => work(), now: () => time,
  };
  const steps = [{ turn: 1, textVersion: 'synthetic-v1', rawText: 'synthetic', data: { n: 1 } }];
  return { configs, dependencies, steps, store: createHistoryPlanStore(dependencies), tick() { time += 900000; }, writes: () => writes };
}
test('plan reload through a new store preserves settings and returns detached steps', async () => {
  const f = fixture();
  const saved = await f.store.save({ gameId: 'a', turn: 3, textVersion: 'v3', steps: f.steps });
  f.steps[0].data.n = 99;
  const store = createHistoryPlanStore(f.dependencies);
  const args = { gameId: 'a', token: saved.token, turn: 3, textVersion: 'v3' };
  const loaded = await store.load(args);
  assert.equal(loaded.steps[0].data.n, 1);
  loaded.steps[0].data.n = 7;
  assert.equal((await store.load(args)).steps[0].data.n, 1);
  assert.deepEqual(f.configs.get('a').unrelated, { n: 2 });
  await assert.rejects(store.save({ gameId: 'a', turn: 3, textVersion: 'v3', steps: f.steps }), { code: 'LWB_BATCH_PLAN' });
  await assert.rejects(store.clear({ gameId: 'a', token: 'other' }), { code: 'LWB_BATCH_PLAN' });
  assert.deepEqual(await store.clear({ gameId: 'a', token: saved.token }), { cleared: true });
  assert.equal(f.configs.get('a').enabled, true);
});
test('plan rejects wrong game/version, modified steps and expiry without modifying stored data', async () => {
  const f = fixture();
  const saved = await f.store.save({ gameId: 'a', turn: 3, textVersion: 'v3', steps: f.steps });
  const args = { gameId: 'a', token: saved.token, turn: 3, textVersion: 'v3' };
  for (const change of [{ gameId: 'b' }, { turn: 4 }, { textVersion: 'edited' }, { token: '' }]) {
    await assert.rejects(f.store.load({ ...args, ...change }), { code: 'LWB_BATCH_PLAN' });
  }
  f.configs.get('a').historyWritePlan.steps[0].data.n++;
  await assert.rejects(f.store.load(args), { code: 'LWB_BATCH_PLAN' });
  f.configs.get('a').historyWritePlan.steps[0].data.n--;
  f.tick();
  await assert.rejects(f.store.load(args), { code: 'LWB_BATCH_PLAN' });
  assert.equal(f.writes(), 1, 'invalid loads never write or silently remove expired work');
  await f.store.clear({ gameId: 'a', token: saved.token });
});
test('inspect recovers only metadata and retains expired plans without writes', async () => {
  const f = fixture();
  assert.equal(await f.store.inspect({ gameId: 'a' }), null);
  const saved = await f.store.save({ gameId: 'a', turn: 3, textVersion: 'v3', steps: f.steps });
  const restored = createHistoryPlanStore(f.dependencies);
  const summary = await restored.inspect({ gameId: 'a' });
  assert.equal(summary.token, saved.token);
  assert.equal(summary.expired, false);
  assert.equal(Object.hasOwn(summary, 'steps'), false);
  assert.equal(Object.hasOwn(summary.targets[0], 'rawText'), false);
  assert.equal(Object.hasOwn(summary.targets[0], 'data'), false);
  f.tick();
  assert.equal((await restored.inspect({ gameId: 'a' })).expired, true);
  assert.equal(f.writes(), 1);
  assert.ok(f.configs.get('a').historyWritePlan);
});
test('plan size budget fails before persistence', async () => {
  const f = fixture();
  await assert.rejects(f.store.save({ gameId: 'a', turn: 1, textVersion: 'v1', steps: [{ data: 'x'.repeat(270000) }] }), { code: 'LWB_BATCH_PLAN' });
  assert.equal(f.writes(), 0);
});
