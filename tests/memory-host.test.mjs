// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordStore } from '../host/records.mjs';
import { createStateService } from '../host/service.mjs';
import { createMemoryService } from '../host/memory-service.mjs';
import { randomUUID } from 'node:crypto';
import { apply as applyPlugin } from '../index.mjs';
const data = name => ({ keywords: [], events: [], characters: { main: [] }, characterAliases: [], arcs: [], facts: [{ 人物名字: name, 种类: '职业', 描述: name === '小雪' ? '是一名医生' : '医生', 核心事实: true }] });
const pack = name => JSON.stringify({ type: 'LittleWhiteBoxStorySummaryMemory', version: 1, data: data(name) });
function fixture() {
  const docs = new Map(), configs = new Map(), games = new Map(); let modelCalls = 0, task;
  const game = id => { if (!games.has(id)) games.set(id, { turn: 1, textVersion: 'v1', busy: false, settled: true, keys: new Map([[1, 'v1']]) }); return games.get(id); };
  const tavern = {
    apiVersion: 7,
    async getTurnState({ gameId }) { const g = game(gameId); return { ...g, keys: undefined }; },
    async getTurn({ gameId, turn }) { return { gameId, turn, textVersion: game(gameId).keys.get(turn), rawText: '<state>数据.生命值: -10</state>' }; },
    async readTurnData({ gameId, turn }) { const g = game(gameId); for (let t = Math.min(turn, g.turn); t >= 1; t--) { const key = g.keys.get(t), value = docs.get(JSON.stringify([gameId, t, key])); if (value) return { turn: t, textVersion: key, data: structuredClone(value) }; } return null; },
    async saveTurnData({ gameId, turn, textVersion, data }) { if (game(gameId).keys.get(turn) !== textVersion) throw Object.assign(new Error('stale'), { code: 'TAVERN_PLUGIN_STALE_VERSION' }); docs.set(JSON.stringify([gameId, turn, textVersion]), structuredClone(data)); },
    async readGameData({ gameId }) { return structuredClone(configs.get(gameId) ?? null); },
    async saveGameData({ gameId, data }) { configs.set(gameId, structuredClone(data)); },
    async publishState() {},
    async startTask(input) { task = input; return { started: true }; },
    async getHistory({ from, to }) { return Array.from({ length: to - from + 1 }, (_, i) => ({ turn: from + i, text: '合成剧情：小雪是一名医生。' })); },
  };
  const store = createRecordStore(tavern), state = createStateService(store.stateApi, { withLock: store.withLock }), memory = createMemoryService(tavern, store, { readStateEngine: state.readEngine });
  async function previewImport(name = '小雪') { const g = game('a'), p = await memory.preview({ gameId: 'a', text: pack(name), expectedTextVersion: g.textVersion }); await memory.importMemory({ gameId: 'a', token: p.token, expectedTextVersion: g.textVersion }); return p; }
  return { tavern, store, state, memory, docs, configs, game, previewImport,
    show(id, turn, version) { const g = game(id); Object.assign(g, { turn, textVersion: version }); g.keys.set(turn, version); },
    async runSummary(extra = {}) { return memory.runSummary({ gameId: task.gameId, turn: game(task.gameId).turn, textVersion: game(task.gameId).textVersion, input: task.input, runAgent: async () => { modelCalls++; const proposed = data('小雪'); proposed.facts[0].描述 = '出身于海港'; return { text: JSON.stringify(proposed) }; }, ...extra }); },
    modelCalls: () => modelCalls, task: () => task };
}

test('preview is read-only; imports require matching preview and retain state fields; exact retry is idempotent', async () => {
  const f = fixture(); await f.state.enable({ gameId: 'a', enabled: true });
  await f.state.initialize({ gameId: 'a', text: '数据.生命值: 100', expectedTextVersion: 'v1' });
  const preview = await f.memory.preview({ gameId: 'a', text: pack('小雪'), expectedTextVersion: 'v1' });
  assert.equal((await f.memory.read({ gameId: 'a' })).record, null);
  await assert.rejects(f.memory.importMemory({ gameId: 'b', token: preview.token, expectedTextVersion: 'v1' }), { code: 'LWB_MEMORY_PREVIEW' });
  const first = await f.memory.importMemory({ gameId: 'a', token: preview.token, expectedTextVersion: 'v1' });
  assert.equal(first.saved, true);
  assert.equal((await f.memory.importMemory({ gameId: 'a', token: preview.token, expectedTextVersion: 'v1' })).status, 'duplicate');
  assert.equal((await f.state.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 100);
  assert.equal(JSON.parse((await f.memory.exportMemory({ gameId: 'a' })).text).data.facts[0].人物名字, '小雪');
});

test('state processing, memory import and per-game settings share ownership without clobbering', async () => {
  const f = fixture(); await f.state.enable({ gameId: 'a', enabled: true });
  await f.state.initialize({ gameId: 'a', text: '数据.生命值: 100', expectedTextVersion: 'v1' });
  await f.previewImport();
  await f.memory.saveSettings({ gameId: 'a', enabled: true, macroTemplate: '生命值={{xbgetvar::数据.生命值}}', expectedTextVersion: 'v1' });
  assert.equal((await f.state.read({ gameId: 'a' })).enabled, true);
  f.show('a', 2, 'v2'); await f.state.process({ gameId: 'a', expectedTextVersion: 'v2' });
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '小雪');
  assert.equal((await f.state.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
  const prompt = await f.memory.prompt({ gameId: 'a', turn: 3, input: '医生' });
  assert.ok(prompt.includes('小雪')); assert.ok(prompt.includes('90'));
  assert.equal(await f.memory.prompt({ gameId: 'b', turn: 2 }), '');
});

test('state backup restore preserves same-turn memory and rejects a changed state preview', async () => {
  const f = fixture(); await f.state.enable({ gameId: 'a', enabled: true });
  await f.state.initialize({ gameId: 'a', text: '数据.生命值: 100', expectedTextVersion: 'v1' });
  const backup = await f.state.exportState({ gameId: 'a' });
  await f.previewImport();
  const memoryRevision = (await f.memory.read({ gameId: 'a' })).record.revision;
  f.show('a', 2, 'v2'); await f.state.process({ gameId: 'a', expectedTextVersion: 'v2' });
  const p = await f.state.migrationPreview({ gameId: 'a', text: backup.text, expectedTextVersion: 'v2' });
  await f.state.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v2', confirmReplace: true });
  assert.equal((await f.state.readEngine('a', 2)).variables.数据.生命值, 100);
  assert.equal((await f.memory.read({ gameId: 'a' })).record.revision, memoryRevision);
  const row = await f.store.stateAt('a', 2); assert.equal(row.data.parent, null);
  await assert.rejects(f.state.migrationCommit({ gameId: 'a', token: p.token, expectedTextVersion: 'v2', confirmReplace: true }), { code: 'LWB_MIGRATION' });
  const stale = await f.state.migrationPreview({ gameId: 'a', text: backup.text, expectedTextVersion: 'v2' });
  const alternate = await f.state.migrationPreview({ gameId: 'a', text: JSON.stringify({ ...JSON.parse(backup.text), engine: { variables: { 数据: { 生命值: 80 } }, roots: ['数据'], LWB_RULES_V2: {} } }), expectedTextVersion: 'v2' });
  await f.state.migrationCommit({ gameId: 'a', token: alternate.token, expectedTextVersion: 'v2', confirmReplace: true });
  await assert.rejects(f.state.migrationCommit({ gameId: 'a', token: stale.token, expectedTextVersion: 'v2', confirmReplace: true }), { code: 'LWB_PARENT_CHANGED' });
  assert.equal((await f.memory.read({ gameId: 'a' })).record.revision, memoryRevision);
});

test('stale preview and concurrent imports reject before memory replacement', async () => {
  const f = fixture(), p = await f.memory.preview({ gameId: 'a', text: pack('甲'), expectedTextVersion: 'v1' });
  await f.previewImport('乙');
  await assert.rejects(f.memory.importMemory({ gameId: 'a', token: p.token, expectedTextVersion: 'v1' }), { code: 'LWB_MEMORY_CONFLICT' });
  const p2 = await f.memory.preview({ gameId: 'a', text: pack('丙'), expectedTextVersion: 'v1' });
  f.show('a', 2, 'v2');
  await assert.rejects(f.memory.importMemory({ gameId: 'a', token: p2.token, expectedTextVersion: 'v1' }), { code: 'LWB_STALE' });
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '乙');
});

test('summary requires explicit model confirmation; adoption merges while preserving omitted facts', async () => {
  const f = fixture(); await f.previewImport();
  await assert.rejects(f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1' }), { code: 'LWB_MODEL_CONFIRM' });
  assert.equal(f.task(), undefined);
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary(); assert.equal(f.modelCalls(), 1);
  const view = await f.memory.read({ gameId: 'a' });
  assert.equal(view.record.data.facts[0].人物名字, '小雪');
  assert.equal(view.pendingSummary.data.facts[0].人物名字, '小雪');
  const relatedFact = view.pendingSummary.merge.conflicts.find(item => item.reason === 'related-fact');
  assert.ok(relatedFact, 'existing and proposed facts are surfaced for explicit review');
  await f.memory.commitSummary({ gameId: 'a', token: view.pendingSummary.token, expectedTextVersion: 'v1', choices: { [relatedFact.id]: 'add' } });
  const merged = (await f.memory.read({ gameId: 'a' })).record.data;
  assert.deepEqual(merged.facts.map(item => item.描述), ['是一名医生', '出身于海港']);
});

test('summary draft survives service restart and is adopted exactly once', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary();
  const before = await f.memory.read({ gameId: 'a' });
  assert.ok(f.configs.get('a').memory.summaryDraft);
  const restarted = createMemoryService(f.tavern, f.store);
  const restored = await restarted.read({ gameId: 'a' });
  assert.equal(restored.pendingSummary.token, before.pendingSummary.token);
  assert.deepEqual(restored.pendingSummary.merge, before.pendingSummary.merge);
  const choices = { [restored.pendingSummary.merge.conflicts.find(item => item.reason === 'related-fact').id]: 'add' };
  const result = await restarted.commitSummary({ gameId: 'a', token: restored.pendingSummary.token, expectedTextVersion: 'v1', choices });
  assert.equal(result.saved, true);
  assert.equal(f.configs.get('a').memory.summaryDraft, null);
  assert.equal((await restarted.commitSummary({ gameId: 'a', token: restored.pendingSummary.token, expectedTextVersion: 'v1', choices: {} })).status, 'duplicate');
  assert.deepEqual((await f.memory.read({ gameId: 'a' })).record.data.facts.map(item => item.描述), ['是一名医生', '出身于海港']);
});

test('adoption retry after cleanup failure is idempotent', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary();
  const candidate = (await f.memory.read({ gameId: 'a' })).pendingSummary;
  const save = f.tavern.saveGameData.bind(f.tavern); let failCleanup = true;
  f.tavern.saveGameData = async input => {
    if (failCleanup && input.data.memory?.summaryStatus?.status === 'adopted') { failCleanup = false; throw new Error('synthetic cleanup failure'); }
    return save(input);
  };
  await assert.rejects(f.memory.commitSummary({ gameId: 'a', token: candidate.token, expectedTextVersion: 'v1' }), /synthetic cleanup failure/);
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts.length, 1);
  const restarted = createMemoryService(f.tavern, f.store);
  assert.equal((await restarted.commitSummary({ gameId: 'a', token: candidate.token, expectedTextVersion: 'v1' })).status, 'duplicate');
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts.length, 1);
});

test('retrying adopted A after restart preserves newer pending candidate B', async () => {
  const f = fixture(); await f.previewImport();
  const start = () => f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await start(); await f.runSummary();
  const a = (await f.memory.read({ gameId: 'a' })).pendingSummary;
  await f.memory.commitSummary({ gameId: 'a', token: a.token, expectedTextVersion: 'v1' });
  await start(); await f.runSummary();
  const b = (await f.memory.read({ gameId: 'a' })).pendingSummary;
  const restarted = createMemoryService(f.tavern, f.store);
  assert.equal((await restarted.commitSummary({ gameId: 'a', token: a.token, expectedTextVersion: 'v1' })).status, 'duplicate');
  const view = await restarted.read({ gameId: 'a' });
  assert.equal(view.pendingSummary.token, b.token);
  assert.equal(view.summaryStatus.status, 'ready');
});

test('ordinary new additions accept boolean true after deselect and reselect', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary({ runAgent: async () => ({ text: JSON.stringify({ ...data('新人物'), keywords: [{ text: '新线索', weight: '高' }] }) }) });
  const candidate = (await f.memory.read({ gameId: 'a' })).pendingSummary;
  const addition = candidate.merge.added.find(item => item.kind === 'keywords');
  await f.memory.commitSummary({ gameId: 'a', token: candidate.token, expectedTextVersion: 'v1', choices: { [addition.id]: true } });
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.keywords[0].text, '新线索');
});

test('terminal expiry and stale status remain stable across repeated reads', async () => {
  for (const expired of [true, false]) {
    const f = fixture(); let clock = 100;
    const service = createMemoryService(f.tavern, f.store, { now: () => clock });
    await service.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
    await service.runSummary({ gameId: 'a', turn: 1, textVersion: 'v1', input: f.task().input, runAgent: async () => ({ text: JSON.stringify(data('小雪')) }) });
    if (expired) clock += 16 * 60 * 1000; else f.show('a', 2, 'v2');
    for (let i = 0; i < 3; i++) assert.equal((await service.read({ gameId: 'a' })).summaryStatus.status, expired ? 'expired' : 'stale');
  }
});

test('persisted summary draft expires and clears on read', async () => {
  const f = fixture(); await f.previewImport(); let clock = 100;
  const service = createMemoryService(f.tavern, f.store, { now: () => clock });
  await service.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await service.runSummary({ gameId: 'a', turn: 1, textVersion: 'v1', input: f.task().input, runAgent: async () => ({ text: JSON.stringify(data('小雪')) }) });
  const token = (await service.read({ gameId: 'a' })).pendingSummary.token;
  clock += 16 * 60 * 1000;
  const restarted = createMemoryService(f.tavern, f.store, { now: () => clock });
  const expired = await restarted.read({ gameId: 'a' });
  assert.equal(expired.pendingSummary, null);
  assert.equal(expired.summaryStatus.status, 'expired');
  assert.equal(f.configs.get('a').memory.summaryDraft, null);
  await assert.rejects(restarted.commitSummary({ gameId: 'a', token, expectedTextVersion: 'v1' }), { code: 'LWB_MEMORY_PREVIEW' });
});

test('persisted candidate becomes stale after the story version changes', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary();
  f.show('a', 2, 'v2');
  const restarted = createMemoryService(f.tavern, f.store);
  const view = await restarted.read({ gameId: 'a' });
  assert.equal(view.pendingSummary, null);
  assert.equal(view.summaryStatus.status, 'stale');
  assert.equal(f.configs.get('a').memory.summaryDraft, null);
});

test('discarded persisted candidate does not reappear after restart', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary(); const token = (await f.memory.read({ gameId: 'a' })).pendingSummary.token;
  await f.memory.discardSummary({ gameId: 'a', token });
  const restarted = createMemoryService(f.tavern, f.store);
  const restored = await restarted.read({ gameId: 'a' });
  assert.equal(restored.pendingSummary, null);
  assert.equal(restored.summaryStatus.status, 'discarded');
});

test('summary merge rejects when the base memory changes after candidate review', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary();
  const candidate = (await f.memory.read({ gameId: 'a' })).pendingSummary;
  await f.previewImport('后来导入');
  await assert.rejects(f.memory.commitSummary({ gameId: 'a', token: candidate.token, expectedTextVersion: 'v1' }), { code: 'LWB_MEMORY_CONFLICT' });
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '后来导入');
});

test('cancelled, malformed and late summary candidates never change saved memory or retry model', async () => {
  const f = fixture(); await f.previewImport();
  const start = () => f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await start(); await assert.rejects(f.runSummary({ signal: AbortSignal.abort(new Error('停止')) }), /停止/);
  assert.equal(f.modelCalls(), 0);
  await start(); await assert.rejects(f.runSummary({ runAgent: async () => ({ text: '坏JSON' }) }));
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '小雪');
  await start(); await assert.rejects(f.runSummary({ runAgent: async () => { f.show('a', 2, 'v2'); return { text: JSON.stringify(data('迟到')) }; } }), { code: 'LWB_STALE' });
  assert.equal((await f.memory.read({ gameId: 'a' })).pendingSummary, null);
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '小雪');
});

test('real runTask path receives combined version/unload signal and never retries a cancelled request', async () => {
  const f = fixture(); await f.previewImport();
  const version = new AbortController(); let received, attempts = 0, finish;
  f.tavern.versionSignal = async () => version.signal;
  f.tavern.runTask = ({ signal }) => { received = signal; attempts++; return new Promise((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); };
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  const job = f.runSummary();
  while (!received) await new Promise(resolve => setImmediate(resolve));
  version.abort(new Error('版本变化'));
  await assert.rejects(job, /版本变化/);
  assert.equal(received.aborted, true); assert.equal(attempts, 1);
  finish({ text: JSON.stringify(data('迟到')) });
  assert.equal((await f.memory.read({ gameId: 'a' })).pendingSummary, null);
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '小雪');
});

test('same confirmed model intent is admitted once across completion, restart and failure', async () => {
  const f = fixture(); await f.previewImport();
  const intent = { gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() };
  await f.memory.summaryStart(intent); await f.runSummary();
  assert.equal((await f.memory.summaryStart(intent)).status, 'already-admitted');
  const fresh = createMemoryService(f.tavern, f.store);
  assert.equal((await fresh.summaryStart(intent)).status, 'already-admitted');
  assert.equal(f.modelCalls(), 1);
  const candidate = (await f.memory.read({ gameId: 'a' })).pendingSummary;
  const commit = { gameId: 'a', token: candidate.token, expectedTextVersion: 'v1' };
  await f.memory.commitSummary(commit);
  assert.equal((await f.memory.commitSummary(commit)).status, 'duplicate');
  const failed = { ...intent, confirmationId: randomUUID() };
  const realStart = f.tavern.startTask; let starts = 0;
  f.tavern.startTask = async () => { starts++; throw new Error('unknown task admission'); };
  await assert.rejects(f.memory.summaryStart(failed), { code: 'LWB_SUMMARY_START_FAILED' });
  assert.equal((await f.memory.summaryStart(failed)).status, 'already-admitted');
  assert.equal(starts, 1); f.tavern.startTask = realStart;
});

test('large imports remain compact-exportable and long player input does not suppress memory', async () => {
  const f = fixture(); await f.previewImport();
  await f.memory.saveSettings({ gameId: 'a', enabled: true, expectedTextVersion: 'v1' });
  assert.ok((await f.memory.prompt({ gameId: 'a', turn: 2, input: '长'.repeat(8000) })).includes('小雪'));
  const output = await f.memory.exportMemory({ gameId: 'a' });
  assert.ok(Buffer.byteLength(output.text) <= 49152);
  const p = await f.memory.preview({ gameId: 'a', text: output.text, expectedTextVersion: 'v1' });
  assert.equal(p.data.facts[0].人物名字, '小雪');
});

test('concurrent state and memory writes preserve both fields and combined quota rejects atomically', async () => {
  const f = fixture(); await f.state.enable({ gameId: 'a', enabled: true });
  await f.state.initialize({ gameId: 'a', text: '数据.生命值: 100', expectedTextVersion: 'v1' });
  f.show('a', 2, 'v2');
  const p = await f.memory.preview({ gameId: 'a', text: pack('小雪'), expectedTextVersion: 'v2' });
  await Promise.all([f.memory.importMemory({ gameId: 'a', token: p.token, expectedTextVersion: 'v2' }), f.state.process({ gameId: 'a', expectedTextVersion: 'v2' })]);
  assert.equal((await f.state.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
  assert.equal((await f.memory.read({ gameId: 'a' })).record.data.facts[0].人物名字, '小雪');
  const before = structuredClone(f.docs);
  await assert.rejects(f.store.withLock('a', () => f.store.saveMemory({ gameId: 'a', turn: 2, textVersion: 'v2', data: { oversized: 'x'.repeat(64000) } })), { code: 'LWB_COMBINED_SIZE' });
  assert.deepEqual(f.docs, before);
});

test('actual plugin effect waits for in-flight summary after delivering unload cancellation', async () => {
  const f = fixture(), handlers = new Map(), disposers = [];
  let summary, signalled, rejectModel, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  Object.assign(f.tavern, {
    handle(name, fn) { handlers.set(name, fn); }, turnSection() {}, settlementTask() {},
    manualTask(value) { summary = value.run; },
    async runTask({ signal }) { return new Promise((_resolve, reject) => { rejectModel = reject; signal.addEventListener('abort', () => { signalled = true; }); entered(); }); },
  });
  applyPlugin({ tavern: f.tavern, effect(setup) { disposers.push(setup()); } });
  const args = { gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() };
  await handlers.get('dsh-tavern-lwb/memory/summary-start')(args);
  const job = summary({ gameId: 'a', turn: 1, textVersion: 'v1', input: f.task().input, signal: new AbortController().signal });
  await waiting;
  let finished = false;
  const cleanup = disposers[0]().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signalled, true); assert.equal(finished, false);
  rejectModel(new Error('unloaded')); await assert.rejects(job, /unloaded/); await cleanup;
  assert.equal(finished, true);
});

test('summary submits via runTask tool, so multi-message JSON fragments still produce a candidate', async () => {
  const f = fixture(); await f.previewImport();
  let passed;
  f.tavern.runTask = async ({ tools }) => {
    passed = tools && tools.find(entry => entry.name === 'memory_submit');
    if (passed) await passed.execute({ memory: data('总结人物') });
    return { text: '{"keywords":[{"text":"残缺' };
  };
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await f.runSummary();
  assert.ok(passed, 'memory_submit 工具已随任务下发');
  const view = await f.memory.read({ gameId: 'a' });
  assert.equal(view.pendingSummary.data.facts[0].人物名字, '总结人物');
});

test('invalid screenshot aliases are rejected before ok and failure is visible after reload without replacing memory', async () => {
  const f = fixture(); await f.previewImport();
  const before = (await f.memory.read({ gameId: 'a' })).record.revision;
  let reply;
  f.tavern.runTask = async ({ tools }) => {
    reply = await tools[0].execute({ memory: { ...data('错误候选'), characterAliases: [{ name: '合成角色', alias: '别称' }] } });
    return { text: '已提交' };
  };
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  assert.equal((await f.memory.read({ gameId: 'a' })).summaryStatus.status, 'queued');
  await assert.rejects(f.runSummary(), { code: 'memory_unknown' });
  assert.equal(reply.ok, false); assert.match(reply.repairHint, /from/);
  let view = await f.memory.read({ gameId: 'a' });
  assert.equal(view.pendingSummary, null); assert.equal(view.summaryStatus.status, 'failed');
  assert.equal(view.summaryStatus.code, 'memory_unknown'); assert.match(view.summaryStatus.message, /name／alias/);
  assert.equal(view.record.revision, before);
  const fresh = createMemoryService(f.tavern, f.store);
  view = await fresh.read({ gameId: 'a' }); assert.equal(view.summaryStatus.status, 'failed');
  assert.equal(view.record.revision, before);
});

test('candidate expiration, version invalidation and restart explain why no candidate remains', async () => {
  const f = fixture(); await f.previewImport();
  let clock = 10;
  const service = createMemoryService(f.tavern, f.store, { now: () => clock });
  const start = () => service.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  const run = () => service.runSummary({ gameId: 'a', turn: 1, textVersion: 'v1', input: f.task().input, runAgent: async () => ({ text: JSON.stringify(data('候选')) }) });
  await start(); await run(); clock += 16 * 60 * 1000;
  assert.equal((await service.read({ gameId: 'a' })).summaryStatus.status, 'expired');
  await start(); await run(); f.show('a', 2, 'v2');
  const stale = await service.read({ gameId: 'a' });
  assert.equal(stale.pendingSummary, null); assert.equal(stale.summaryStatus.status, 'stale');
  f.show('a', 1, 'v1'); await start();
  const reloaded = createMemoryService(f.tavern, f.store, { now: () => clock });
  assert.equal((await reloaded.read({ gameId: 'a' })).summaryStatus.code, 'LWB_SUMMARY_INTERRUPTED');
});

test('tool success without host task text is reported as incomplete instead of silently adopting data', async () => {
  const f = fixture(); await f.previewImport();
  f.tavern.runTask = async ({ tools }) => { assert.equal((await tools[0].execute({ memory: data('候选') })).ok, true); throw new Error('后台 Agent 没有返回任务结果'); };
  await f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await assert.rejects(f.runSummary(), { code: 'LWB_SUMMARY_NO_TEXT' });
  const view = await f.memory.read({ gameId: 'a' });
  assert.equal(view.summaryStatus.code, 'LWB_SUMMARY_NO_TEXT'); assert.equal(view.pendingSummary, null);
});

test('unknown provider code and startup message never enter public or persisted status', async () => {
  const f = fixture(); await f.previewImport();
  f.tavern.runTask = async () => { throw Object.assign(new Error('Bearer SECRET_SYNTHETIC_PROVIDER'), { code: 'SECRET_TOKEN_abc123' }); };
  const start = () => f.memory.summaryStart({ gameId: 'a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true, confirmationId: randomUUID() });
  await start(); await assert.rejects(f.runSummary());
  let view = await f.memory.read({ gameId: 'a' });
  assert.equal(view.summaryStatus.code, 'LWB_SUMMARY_FAILED');
  assert.ok(!JSON.stringify([...f.configs.values()]).includes('SECRET'));
  f.tavern.startTask = async () => { throw new Error('Bearer SECRET_SYNTHETIC_START'); };
  await assert.rejects(start(), error => error.code === 'LWB_SUMMARY_START_FAILED' && !error.message.includes('SECRET'));
  view = await f.memory.read({ gameId: 'a' }); assert.equal(view.summaryStatus.code, 'LWB_SUMMARY_START_FAILED');
  assert.ok(!JSON.stringify(view).includes('SECRET'));
  assert.ok(!JSON.stringify([...f.configs.values()]).includes('SECRET'));
});

test('legacy alpha state is readable and migrates only on a successful write', async () => {
  const f = fixture();
  await f.state.enable({ gameId: 'a', enabled: true });
  await f.state.initialize({ gameId: 'a', text: '数据.生命值: 90\n数据.金币: 5', expectedTextVersion: 'v1' });
  const raw = structuredClone(f.docs.get(JSON.stringify(['a', 1, 'v1'])).state);
  f.docs.set(JSON.stringify(['a', 1, 'v1']), structuredClone(raw));
  assert.deepEqual((await f.store.stateAt('a', 1)).data, raw);
  assert.deepEqual(f.docs.get(JSON.stringify(['a', 1, 'v1'])), raw);
  await f.previewImport();
  assert.deepEqual((await f.store.stateAt('a', 1)).data, raw);
  assert.ok(f.docs.get(JSON.stringify(['a', 1, 'v1'])).memory);
  assert.equal((await f.state.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 90);
  assert.equal(JSON.parse((await f.state.exportState({ gameId: 'a' })).text).engine.variables.数据.金币, 5);
  f.show('a', 2, 'v2'); await f.state.process({ gameId: 'a', expectedTextVersion: 'v2' });
  assert.equal((await f.state.read({ gameId: 'a' })).record.engine.variables.数据.生命值, 80);
});
