// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Pinned public storage modules with synthetic in-memory backing only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceModule } from '../scripts/prepare-test-references.mjs';
import { createHistoryPlanStore } from '../host/history-plan-store.mjs';
import { createRecordStore } from '../host/records.mjs';
for (const target of ['api7', 'api8']) test(`${target}: internal plan survives adapter recreation through public GameData storage`, async () => {
  const { createPluginData } = await import(referenceModule(target, 'domain/plugin-data.js'));
  const map = new Map();
  const store = { async readJson(key) { return structuredClone(map.get(key)); }, async updateJson(key, change) {
    const value = change(structuredClone(map.get(key))); map.set(key, structuredClone(value));
  } };
  const data = createPluginData({ store });
  const owner = 'synthetic-batch-plugin', chatId = 'synthetic-chat';
  const tavern = {
    readGameData: async () => data.readGame({ chatId, owner }),
    saveGameData: async ({ data: value }) => data.saveGame({ chatId, owner, data: value }),
  };
  await tavern.saveGameData({ data: { spec: 'synthetic-settings', enabled: true, memoryPreferences: { enabled: true } } });
  let records = createRecordStore(tavern);
  const create = () => createHistoryPlanStore({ readGameData: args => tavern.readGameData(args), saveGameData: args => tavern.saveGameData(args), withLock: records.withLock, now: () => 1000 });
  let plans = create();
  const steps = [{ turn: 1, textVersion: 'v1', rawText: 'synthetic', data: { padding: 'x'.repeat(70 * 1024) } }];
  const saved = await plans.save({ gameId: 'synthetic-game', turn: 1, textVersion: 'v1', steps });
  await records.dispose();
  records = createRecordStore(tavern); plans = create();
  const loaded = await plans.load({ gameId: 'synthetic-game', turn: 1, textVersion: 'v1', token: saved.token });
  assert.equal(loaded.steps[0].data.padding.length, 70 * 1024);
  assert.deepEqual((await tavern.readGameData({})).memoryPreferences, { enabled: true });
  await assert.rejects(plans.clear({ gameId: 'synthetic-game', token: 'foreign-token' }), { code: 'LWB_BATCH_PLAN' });
  assert.deepEqual(await plans.clear({ gameId: 'synthetic-game', token: saved.token }), { cleared: true });
  assert.deepEqual(await tavern.readGameData({}), { spec: 'synthetic-settings', enabled: true, memoryPreferences: { enabled: true } });
  assert.deepEqual(await data.turnsUpTo({ chatId, owner, turn: 10 }), [], 'plan persistence never writes turn state');
  await records.dispose();
});
