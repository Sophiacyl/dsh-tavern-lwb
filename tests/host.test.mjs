// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateService, RECORD_SPEC } from '../host/service.mjs';
const initial = '$schema 数据\n  生命值: 0\n  金币: 0\n数据:\n  生命值: 100\n  金币: 0';
function fixture() {
  const games = new Map(), documents = new Map(), configs = new Map();
  let gate = null;
  const clone = structuredClone;
  const rowKey = (id, turn, key) => JSON.stringify([id, turn, key]);
  function game(id) {
    if (!games.has(id)) games.set(id, { turn: 1, textVersion: 'greeting-' + id, settled: true, busy: false, versions: new Map([[1, 'greeting-' + id]]), texts: new Map([[1, '欢迎']]) });
    return games.get(id);
  }
  function show(id, turn, key, rawText = '') { const g = game(id); Object.assign(g, { turn, textVersion: key, settled: true, busy: false }); g.versions.set(turn, key); g.texts.set(turn, rawText); }
  const tavern = {
    apiVersion: 7,
    async getTurnState({ gameId }) { const g = game(gameId); return { turn: g.turn, textVersion: g.textVersion, settled: g.settled, busy: g.busy }; },
    async getTurn({ gameId, turn }) { const g = game(gameId); return g.versions.has(turn) && turn <= g.turn ? { gameId, turn, textVersion: g.versions.get(turn), rawText: g.texts.get(turn) || '' } : null; },
    async readGameData({ gameId }) { return clone(configs.get(gameId) ?? null); },
    async saveGameData({ gameId, data }) { configs.set(gameId, clone(data)); },
    async readTurnData({ gameId, turn }) {
      const g = game(gameId);
      for (const t of [...g.versions.keys()].filter(t => t <= turn && t <= g.turn).sort((a, b) => b - a)) {
        const key = g.versions.get(t), data = documents.get(rowKey(gameId, t, key));
        if (data) return { turn: t, textVersion: key, data: clone(data) };
      }
      return null;
    },
    async saveTurnData({ gameId, turn, textVersion, data }) {
      if (gate) { const run = gate; gate = null; await run(); }
      if (game(gameId).versions.get(turn) !== textVersion || turn > game(gameId).turn) throw Object.assign(new Error('版本已变化'), { code: 'TAVERN_PLUGIN_STALE_VERSION' });
      assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 65536);
      documents.set(rowKey(gameId, turn, textVersion), clone(data));
      return { turn, textVersion };
    },
    async publishState() {},
  };
  return { games, documents, tavern, show, game, gate(fn) { gate = fn; }, service: createStateService(tavern, { now: () => 1 }) };
}
async function start(f, id = 'a') {
  const state = await f.tavern.getTurnState({ gameId: id });
  await f.service.enable({ gameId: id, enabled: true });
  return f.service.initialize({ gameId: id, expectedTextVersion: state.textVersion, text: initial });
}
function input(gameId, turn, textVersion, rawText, signal) { return { gameId, turn, textVersion, rawText, signal }; }

test('default disabled, preview is read-only, initialization is explicit and cannot overwrite', async () => {
  const f = fixture();
  assert.equal((await f.service.read({ gameId: 'a' })).enabled, false);
  assert.equal(await f.service.prompt({ gameId: 'a', turn: 2 }), '');
  await assert.rejects(f.service.initialize({ gameId: 'a', text: initial, expectedTextVersion: 'greeting-a' }), { code: 'LWB_DISABLED' });
  await f.service.enable({ gameId: 'a', enabled: true });
  const preview = await f.service.preview({ gameId: 'a', text: initial, expectedTextVersion: 'greeting-a' });
  assert.equal(preview.status, 'success');
  assert.equal(f.documents.size, 0);
  await start(f);
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 100);
  assert.equal((await f.service.initialize({ gameId: 'a', text: initial, expectedTextVersion: 'greeting-a' })).status, 'initialized');
  await assert.rejects(f.service.initialize({ gameId: 'a', text: initial + '\n数据.金币: 9', expectedTextVersion: 'greeting-a' }), { code: 'LWB_INITIALIZED' });
});

test('automatic and concurrent manual repeats apply delta once; reload reads committed receipt', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2', '<state>数据.生命值: -10</state>');
  const material = input('a', 2, 'v2', '<state>数据.生命值: -10</state>');
  await Promise.all([f.service.automatic(material), f.service.process({ gameId: 'a', expectedTextVersion: 'v2' }), f.service.automatic(material)]);
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
  const reloaded = createStateService(f.tavern);
  assert.equal((await reloaded.automatic(material)).status, 'duplicate');
  assert.equal((await reloaded.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
});

test('editing/replacing current reply starts from previous versioned state, rollback and undo select correct snapshots', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2a', '<state>数据.生命值: -10</state>');
  await f.service.process({ gameId: 'a', expectedTextVersion: 'v2a' });
  f.show('a', 2, 'v2b', '<state>数据.生命值: -20</state>');
  await f.service.process({ gameId: 'a', expectedTextVersion: 'v2b' });
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 80);
  f.show('a', 1, 'greeting-a');
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 100);
  f.show('a', 2, 'v2a', '<state>数据.生命值: -10</state>');
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
});

test('two enabled games stay isolated and disabled game never executes model state', async () => {
  const f = fixture(); await start(f, 'a'); await start(f, 'b');
  f.show('a', 2, 'a2', '<state>数据.生命值: -10</state>');
  f.show('b', 2, 'b2', '<state>数据.金币: +7</state>');
  await Promise.all(['a', 'b'].map(gameId => f.service.process({ gameId, expectedTextVersion: gameId + '2' })));
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.金币, 0);
  assert.equal((await f.service.read({ gameId: 'b' })).record.engine.variables.数据.生命值, 100);
  await f.service.enable({ gameId: 'b', enabled: false });
  f.show('b', 3, 'b3');
  assert.equal((await f.service.automatic(input('b', 3, 'b3', '<state>数据.金币: +500</state>'))).status, 'disabled');
});

test('aborted or stale results never commit; failed save can be safely read and retried', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2');
  const material = input('a', 2, 'v2', '<state>数据.生命值: -10</state>');
  await assert.rejects(f.service.automatic({ ...material, signal: AbortSignal.abort(new Error('cancel')) }), /cancel/);
  assert.equal(f.documents.size, 1);
  f.gate(() => { f.show('a', 2, 'replacement'); });
  await assert.rejects(f.service.automatic(material), { code: 'TAVERN_PLUGIN_STALE_VERSION' });
  assert.equal(f.documents.size, 1);
  f.show('a', 2, 'v2');
  const realSave = f.tavern.saveTurnData;
  let uncertain = true;
  f.tavern.saveTurnData = async args => { const result = await realSave(args); if (uncertain) { uncertain = false; throw new Error('unknown after commit'); } return result; };
  await assert.rejects(f.service.automatic(material), /unknown after commit/);
  assert.equal((await f.service.automatic(material)).status, 'duplicate');
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
});

test('invalid update records diagnostics and retains previous state', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2', '<state>数据.__proto__.x: 1</state>');
  const result = await f.service.process({ gameId: 'a', expectedTextVersion: 'v2' });
  assert.equal(result.status, 'failed');
  const row = (await f.service.read({ gameId: 'a' })).record;
  assert.equal(row.spec, RECORD_SPEC);
  assert.equal(row.engine.variables.数据.生命值, 100);
  assert.ok(row.diagnostics.errors.length > 0);
  assert.equal({}.x, undefined);
});

test('manual version, busy and missing baseline fail before mutation', async () => {
  const f = fixture(); await f.service.enable({ gameId: 'a', enabled: true });
  await assert.rejects(f.service.initialize({ gameId: 'a', text: initial, expectedTextVersion: 'old' }), { code: 'LWB_STALE' });
  f.game('a').busy = true;
  await assert.rejects(f.service.initialize({ gameId: 'a', text: initial, expectedTextVersion: 'greeting-a' }), { code: 'LWB_BUSY' });
  f.show('a', 2, 'v2');
  await assert.rejects(f.service.process({ gameId: 'a', expectedTextVersion: 'v2' }), { code: 'LWB_NO_BASELINE' });
  assert.equal(f.documents.size, 0);
});

test('backfilled parent state invalidates an unchanged descendant snapshot', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2', '<state>数据.生命值: -10</state>');
  // Simulate an earlier task never committing; later turn still has a baseline.
  f.show('a', 3, 'v3', '<state>数据.金币: +1</state>');
  await f.service.process({ gameId: 'a', expectedTextVersion: 'v3' });
  f.show('a', 2, 'v2', '<state>数据.生命值: -10</state>');
  await f.service.process({ gameId: 'a', expectedTextVersion: 'v2' });
  f.show('a', 3, 'v3', '<state>数据.金币: +1</state>');
  assert.equal((await f.service.read({ gameId: 'a' })).warning.code, 'LWB_PARENT_CHANGED');
  assert.equal(JSON.parse((await f.service.exportState({ gameId: 'a' })).text).warning.code, 'LWB_PARENT_CHANGED');
  await assert.rejects(f.service.process({ gameId: 'a', expectedTextVersion: 'v3' }), { code: 'LWB_PARENT_CHANGED' });
});

test('long prose is not charged to state-block input quota; malformed state stays rejected', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2', '剧'.repeat(11000) + '<state>数据.生命值: -10</state>');
  assert.equal((await f.service.process({ gameId: 'a', expectedTextVersion: 'v2' })).status, 'success');
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
  f.show('a', 3, 'v3', '剧情<state>数据.生命值: -10');
  assert.equal((await f.service.process({ gameId: 'a', expectedTextVersion: 'v3' })).status, 'failed');
  assert.equal((await f.service.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
});

test('initialization preview rejects rules-only input; disposal drains accepted writes', async () => {
  const f = fixture(); await f.service.enable({ gameId: 'a', enabled: true });
  const result = await f.service.preview({ gameId: 'a', text: '$schema 数据\n  值: 0', expectedTextVersion: 'greeting-a' });
  assert.equal(result.status, 'failed');
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.tavern.saveGameData = async ({ data }) => { entered(); await new Promise(resolve => { release = resolve; }); };
  const accepted = f.service.enable({ gameId: 'a', enabled: false });
  await waiting;
  let finished = false;
  const disposal = f.service.dispose().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release(); await accepted; await disposal;
  assert.equal(finished, true);
});

test('long state histories continue beyond 128 turns with full parent validation', async () => {
  const f = fixture(); await start(f);
  for (let turn = 2; turn <= 260; turn++) {
    f.show('a', turn, 'v' + turn, turn === 129 ? '<state>数据.金币: +1</state>' : '本轮没有变化');
    await f.service.process({ gameId: 'a', expectedTextVersion: 'v' + turn });
  }
  assert.equal((await f.service.read({ gameId: 'a' })).record.turn, 260);
  assert.equal((await f.service.readEngine('a', 129)).variables.数据.金币, 1);
  assert.equal((await f.service.readEngine('a', 260)).variables.数据.金币, 1);
  const finalExport = JSON.parse((await f.service.exportState({ gameId: 'a' })).text);
  assert.equal(finalExport.engine.variables.数据.金币, 1);
});

test('editing an earlier long-history parent invalidates its descendant', async () => {
  const f = fixture(); await start(f);
  for (let turn = 2; turn <= 130; turn++) {
    f.show('a', turn, 'v' + turn, '本轮没有变化');
    await f.service.process({ gameId: 'a', expectedTextVersion: 'v' + turn });
  }
  f.show('a', 2, 'v2-edited', '<state>数据.金币: +1</state>');
  await f.service.process({ gameId: 'a', expectedTextVersion: 'v2-edited' });
  f.show('a', 130, 'v130');
  assert.equal((await f.service.read({ gameId: 'a' })).warning.code, 'LWB_PARENT_CHANGED');
});

test('state migration preview is read-only and confirmed restore creates a current baseline', async () => {
  const f = fixture(); await start(f);
  const backup = await f.service.exportState({ gameId: 'a' });
  f.show('a', 2, 'v2', '<state>数据.金币: +5</state>'); await f.service.process({ gameId: 'a', expectedTextVersion: 'v2' });
  const p = await f.service.migrationPreview({ gameId: 'a', expectedTextVersion: 'v2', text: backup.text });
  assert.equal((await f.service.readEngine('a', 2)).variables.数据.金币, 5);
  await assert.rejects(f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v2' }), { code: 'LWB_MIGRATION' });
  await f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v2', confirmReplace: true });
  const restored = (await f.service.read({ gameId: 'a' })).record;
  assert.equal(restored.engine.variables.数据.金币, 0); assert.equal(restored.parent, null);
  assert.equal((await f.service.process({ gameId: 'a', expectedTextVersion: 'v2' })).status, 'initialized');
});
test('plot-log message chain previews atomically and commits only its final baseline', async () => {
  const f = fixture(); await start(f);
  const args = { gameId: 'a', expectedTextVersion: 'greeting-a' };
  const baseEngine = { variables: { 数据: { 金币: 10 } }, roots: ['数据'], LWB_RULES_V2: {} };
  const messages = [{ blocks: [{ set: { 数据: { 金币: 20 } } }] }, { blocks: [{ bump: { 数据: { 金币: 2 } } }] }];
  const text = items => JSON.stringify({ spec: 'dsh-tavern-lwb/plot-log-numeric-log', version: 1, baseEngine, messages: items });
  const before = await f.service.readEngine('a', 1);
  await assert.rejects(f.service.migrationPreview({ ...args, text: text([...messages, { source: '<plot-log>' }]) }), { code: 'LWB_PLOT_SUBSET' });
  assert.deepEqual(await f.service.readEngine('a', 1), before);
  const preview = await f.service.migrationPreview({ ...args, text: text(messages) });
  assert.equal(preview.engine.variables.数据.金币, 22);
  assert.deepEqual(await f.service.readEngine('a', 1), before);
  await f.service.migrationCommit({ ...args, token: preview.token, confirmReplace: true });
  const { record } = await f.service.read({ gameId: 'a' });
  assert.equal(record.parent, null);
  assert.deepEqual(record.engine, preview.engine);
});
test('WAL diagnostic preview commits without treating entries as story turns', async () => {
  const f = fixture(); await start(f);
  const text = JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records: [{ v: 1, entries: [
    { kind: 'call', source: 'text', roots: ['数据'], rules: [], blocks: [], ops: [{ op: 'set', path: '数据', value: { 金币: 8 }, source: 'text' }] },
    { kind: 'call', source: 'text', roots: [], rules: [{ path: '数据.金币', rule: { ro: true } }], blocks: [], ops: [{ op: 'inc', path: '数据.金币', delta: 10, source: 'text' }] }
  ] }] });
  const p = await f.service.migrationPreview({ gameId: 'a', text, expectedTextVersion: 'greeting-a' });
  assert.ok(p.report.some(row => row.errors.length));
  await f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'greeting-a', confirmReplace: true });
  assert.equal((await f.service.readEngine('a', 1)).variables.数据.金币, 8);
});

test('selected swipe mapping is visible before confirmation and does not query source floors', async () => {
  const f = fixture(); await start(f);
  const record = amount => ({ v: 1, entries: [{ kind: 'call', roots: ['数据'], ops: [{ op: 'set', path: '数据', value: { 金币: amount }, source: 'text' }] }] });
  const text = JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-swipes', version: 1, floors: [{ floor: 99, selected: 1, records: [record(999), record(3)] }] });
  const p = await f.service.migrationPreview({ gameId: 'a', text, expectedTextVersion: 'greeting-a' });
  assert.deepEqual(p.report.at(-1).selectedBranch, [{ floor: 99, selected: 1 }]);
  f.tavern.getTurn = () => { throw Error('source floor must not be queried in target game'); };
  await f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'greeting-a', confirmReplace: true });
  assert.equal((await f.service.readEngine('a', 1)).variables.数据.金币, 3);
});

test('WAL preview diagnostics share a bounded aggregate budget', async () => {
  const f = fixture(); await start(f);
  const entries = [{ kind: 'call', source: 'text', roots: ['数据'], rules: [], ops: [{ op: 'set', path: '数据', value: { 金币: 8 }, source: 'text' }] }];
  for (let i = 0; i < 45; i++) entries.push({ kind: 'call', source: 'json', roots: [], rules: [{ path: '数据.金币', rule: { ro: true } }], ops: [{ op: 'inc', path: '数据.金币', delta: 1, source: 'json' }] });
  const text = JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records: [{ v: 1, entries }] });
  const p = await f.service.migrationPreview({ gameId: 'a', text, expectedTextVersion: 'greeting-a' });
  assert.ok(Buffer.byteLength(JSON.stringify(p.report)) < 17 * 1024);
  assert.equal(p.report.at(-1).omittedEntries, 15);
  assert.equal(p.engine.variables.数据.金币, 8);
});

test('restore can establish a clean baseline after earlier parent changes', async () => {
  const f = fixture(); await start(f); const backup = await f.service.exportState({ gameId: 'a' });
  f.show('a', 2, 'v2', '<state>数据.金币: +1</state>');
  f.show('a', 3, 'v3', '<state>数据.金币: +2</state>'); await f.service.process({ gameId: 'a', expectedTextVersion: 'v3' });
  f.show('a', 2, 'v2', '<state>数据.金币: +1</state>'); await f.service.process({ gameId: 'a', expectedTextVersion: 'v2' });
  f.show('a', 3, 'v3'); assert.equal((await f.service.read({ gameId: 'a' })).warning.code, 'LWB_PARENT_CHANGED');
  const p = await f.service.migrationPreview({ gameId: 'a', expectedTextVersion: 'v3', text: backup.text });
  await f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v3', confirmReplace: true });
  assert.equal((await f.service.read({ gameId: 'a' })).warning, null);
});

test('migration refuses to write when generation starts during history recheck', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2', '<state>数据.金币: +3</state>');
  const p = await f.service.migrationPreview({ gameId: 'a', expectedTextVersion: 'v2', mode: 'history', initialText: initial, from: 2, to: 2 });
  const original = f.tavern.getTurn;
  f.tavern.getTurn = async args => { const result = await original(args); f.game('a').busy = true; return result; };
  await assert.rejects(f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v2', confirmReplace: true }), { code: 'LWB_BUSY' });
});

test('history replay rechecks all versions at confirmation and rejects cross-game tokens', async () => {
  const f = fixture(); await start(f);
  f.show('a', 2, 'v2', '<state>数据.金币: +3</state>');
  const p = await f.service.migrationPreview({ gameId: 'a', expectedTextVersion: 'v2', mode: 'history', initialText: initial, from: 2, to: 2 });
  assert.equal(p.engine.variables.数据.金币, 3);
  await assert.rejects(f.service.migrationCommit({ gameId: 'b', token: p.token, expectedTextVersion: 'greeting-b', confirmReplace: true }), { code: 'LWB_MIGRATION' });
  f.game('a').texts.set(2, '<state>数据.金币: +9</state>');
  await assert.rejects(f.service.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v2', confirmReplace: true }), { code: 'LWB_STALE' });
});

test('export is a separate explicit data export, unload cancels queued work', async () => {
  const f = fixture(); await start(f);
  const output = await f.service.exportState({ gameId: 'a' });
  const parsed = JSON.parse(output.text);
  assert.equal(parsed.spec, 'dsh-tavern-lwb/export');
  assert.equal(parsed.engine.variables.数据.生命值, 100);
  assert.equal(parsed.gameId, undefined);
  await f.service.dispose();
  await assert.rejects(f.service.process({ gameId: 'a', expectedTextVersion: 'greeting-a' }), { code: 'LWB_UNLOADED' });
});
