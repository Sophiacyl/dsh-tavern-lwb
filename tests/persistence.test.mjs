// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { referenceModule } from '../scripts/prepare-test-references.mjs';
const { createPluginData } = await import(referenceModule('api8', 'domain/plugin-data.js'));
import { createStateService } from '../host/service.mjs';

test('workspace-only disk round trip preserves receipts and does not double apply after fresh instances', async t => {
  const parent = new URL('./.tmp/', import.meta.url).pathname;
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'persistence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = () => ({
    async readJson(key) { try { return JSON.parse(await readFile(path.join(root, key), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } },
    async updateJson(key, change) { const file = path.join(root, key); const next = await change(await this.readJson(key)); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(next)); await rename(file + '.tmp', file); },
  });
  let data = createPluginData({ store: store() });
  let turn = 1, key = 'greeting';
  const settings = new Map();
  const tavern = {
    async getTurnState() { return { turn, textVersion: key, settled: true, busy: false }; },
    async getTurn() { return { gameId: 'fixture', turn, textVersion: key, rawText: '<state>数据.值: -1</state>' }; },
    async readGameData() { return settings.get('fixture') || null; },
    async saveGameData({ data }) { settings.set('fixture', data); },
    async readTurnData({ turn: at }) { for (const row of await data.turnsUpTo({ chatId: 'fixture', owner: 'lwb', turn: at })) if (row.turn === 1 || row.key === key) return { turn: row.turn, textVersion: row.key, data: row.data }; return null; },
    async saveTurnData({ turn: at, textVersion, data: value }) { assert.equal(textVersion, key); return data.saveTurn({ chatId: 'fixture', owner: 'lwb', turn: at, key: textVersion, data: value }); },
    async publishState() {},
  };
  let service = createStateService(tavern);
  await service.enable({ gameId: 'fixture', enabled: true });
  await service.initialize({ gameId: 'fixture', expectedTextVersion: key, text: '数据.值: 10' });
  turn = 2; key = 'reply';
  await service.process({ gameId: 'fixture', expectedTextVersion: key });
  await service.dispose();
  data = createPluginData({ store: store() });
  service = createStateService(tavern);
  assert.equal((await service.read({ gameId: 'fixture' })).record.engine.variables.数据.值, 9);
  assert.equal((await service.process({ gameId: 'fixture', expectedTextVersion: key })).status, 'duplicate');
  assert.equal((await service.read({ gameId: 'fixture' })).record.engine.variables.数据.值, 9);
  await service.dispose();
});
