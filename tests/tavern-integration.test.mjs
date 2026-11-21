// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Runs real, unmodified public Tavern API modules and Cordis with synthetic storage only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../index.mjs';
import { referenceModule, referenceRoot } from '../scripts/prepare-test-references.mjs';
const targets = [
  ['API 7 / pinned public snapshot', 'api7'],
  ['API 8 / pinned public snapshot', 'api8'],
];
const initial = '<state>\n$schema 数据\n  角色:\n    生命值: 0\n    金币: 0\n数据:\n  角色:\n    生命值: 100\n    金币: 0\n</state>';
function memoryStore() {
  const map = new Map();
  return { async readJson(key) { return structuredClone(map.get(key)); }, async updateJson(key, change) { const next = await change(structuredClone(map.get(key))); if (next !== undefined) map.set(key, structuredClone(next)); }, async remove(key) { map.delete(key); } };
}
for (const [label, apiVersion] of targets) test('real ' + label + ': registration, explicit init, settlement, prompt, fork/export and disposal', async t => {
  const { createTavernPluginApi } = await import(referenceModule(apiVersion, 'plugin-api.js'));
  const { createPluginData } = await import(referenceModule(apiVersion, 'domain/plugin-data.js'));
  const { createPluginMedia } = await import(referenceModule(apiVersion, 'domain/plugin-media.js'));
  const referencePath = pathToFileURL(referenceRoot(apiVersion) + '/tavern-plugin/lib/domain/');
  const { createForegroundFrameBuilder, foregroundFrameText } = await import(new URL('agent-input-frame.js', referencePath));
  const data = createPluginData({ store: memoryStore() });
  const media = createPluginMedia({ store: memoryStore() });
  const root = new Context();
  t.after(() => root.fiber.dispose());
  let latest = { chatId: 'synthetic-chat', sessionId: 'synthetic-game', turn: 1, key: 'greeting', source: '开场', text: '开场', greeting: true, card: { path: '/synthetic/card.json', name: '合成卡' } };
  const materials = new Map([[1, latest]]);
  let forkMode = false;
  const forkMaterials = new Map();
  const latestFor = id => forkMode && id === 'synthetic-fork-game' ? forkMaterials.get(2) : latest;
  const materialsFor = id => id === 'synthetic-fork-game' ? forkMaterials : materials;
  const identities = new Map([[plugin.name, { runtimeName: plugin.name, origin: 'global' }]]);
  let api, modelCalls = 0, latestManual, toolReplies = [];
  let modelMode = 'repair';
  const memoryData = { keywords: [], events: [], characters: { main: [] }, characterAliases: [], arcs: [], facts: [{ 人物名字: '合成人物', 种类: '身份', 描述: '旅店老板', 核心事实: true }, { 人物名字: '合成人物', 种类: '职业', 描述: '医生', 核心事实: false }] };
  const warnings = [];
  const host = root.plugin({ name: 'synthetic-tavern-host', apply(ctx) {
    api = createTavernPluginApi({ ctx, data, media, runningUserPlugins: identities,
      logger: { warn(message) { warnings.push(message); } },
      resolveGame: async id => id === 'synthetic-game' ? { chatId: latest.chatId, sessionId: id } : forkMode && id === 'synthetic-fork-game' ? { chatId: 'synthetic-fork', sessionId: id } : null,
      currentKey: async (id, turn) => turn <= latestFor(id).turn ? materialsFor(id).get(turn)?.key ?? null : null,
      readTurn: async (id, turn) => materialsFor(id).get(turn) ?? null,
      readPendingTurn: async id => latestFor(id),
      readLatestSettledTurn: async id => latestFor(id),
      readActivity: async () => ({ generating: false, settling: false }),
      readVariables: async () => null, publish() {}, publishState() {},
      readHistory: async () => [{ turn: 1, text: '合成人物是一名医生。' }],
      runTask: async ({ signal, tools, call }) => {
        signal?.throwIfAborted(); modelCalls++;
        assert.ok(tools.find(tool => tool.name === 'memory_submit').parameters.properties.memory.properties.characterAliases.items.properties.from);
        const invalid = { ...memoryData, characterAliases: [{ name: '合成人物', alias: '别称' }] };
        toolReplies.push(JSON.parse(await call('memory_submit', { memory: invalid })));
        if (modelMode === 'repair') toolReplies.push(JSON.parse(await call('memory_submit', { memory: memoryData })));
        return { text: '本次任务已结束。' };
      },
      startManualTask: async ({ gameId, key, input }) => { latestManual = api.runManualTask({ gameId, key, input, operationId: 'synthetic-summary', signal: new AbortController().signal }); return { started: true }; },
    });
    ctx.provide('tavern', api.service);
  } });
  await host.await();
  const fiber = root.plugin(plugin);
  await fiber.await();
  const call = (method, args = {}) => api.callHandler(plugin.name + '/' + method, { gameId: 'synthetic-game', ...args });
  assert.equal((await call('read')).enabled, false);
  assert.equal((await api.turnContext({ gameId: 'synthetic-game', turn: 2, input: '前进' })).length, 0);
  await call('enable', { enabled: true });
  const preview = await call('preview', { text: initial, expectedTextVersion: 'greeting' });
  assert.equal(preview.status, 'success');
  await call('initialize', { text: initial, expectedTextVersion: 'greeting' });
  latest = { ...latest, turn: 2, key: 'reply-v1', source: '她受了伤。<state>数据.角色.生命值: -10</state>', text: '她受了伤。', greeting: false };
  materials.set(2, latest);
  await api.runSettlementTasks({ gameId: 'synthetic-game', phase: 'after', signal: new AbortController().signal, around: work => work('synthetic-operation') });
  let snapshot = await call('read');
  assert.equal(snapshot.record.engine.variables.数据.角色.生命值, 90);
  await call('process', { expectedTextVersion: 'reply-v1' });
  assert.equal((await call('read')).record.engine.variables.数据.角色.生命值, 90);
  const context = await api.turnContext({ gameId: 'synthetic-game', turn: 3, input: '继续' });
  assert.equal(context.length, 1);
  assert.ok(context[0].text.includes('90'));
  const exported = await api.exportGame('synthetic-chat');
  assert.ok(exported.data);
  await api.gameForked({ sourceChatId: 'synthetic-chat', targetChatId: 'synthetic-fork', targetSessionId: 'synthetic-fork-game', keyMap: new Map([['1\0greeting', 'fork-greeting'], ['2\0reply-v1', 'fork-reply']]) });
  const rows = await data.turnsUpTo({ chatId: 'synthetic-fork', owner: plugin.name, turn: 2 });
  assert.equal(rows.find(row => row.key === 'fork-reply').data.state.engine.variables.数据.角色.生命值, 90);
  forkMode = true;
  forkMaterials.set(1, { ...materials.get(1), chatId: 'synthetic-fork', sessionId: 'synthetic-fork-game', key: 'fork-greeting' });
  forkMaterials.set(2, { ...latest, chatId: 'synthetic-fork', sessionId: 'synthetic-fork-game', key: 'fork-reply' });
  const forkRead = await call('read', { gameId: 'synthetic-fork-game' });
  assert.equal(forkRead.warning, null);
  assert.equal(forkRead.record.engine.variables.数据.角色.生命值, 90);
  assert.equal((await call('process', { gameId: 'synthetic-fork-game', expectedTextVersion: 'fork-reply' })).status, 'duplicate');
  assert.ok((await api.turnContext({ gameId: 'synthetic-fork-game', turn: 3, input: '继续' }))[0].text.includes('90'));
  const previewMemory = await call('memory/preview', { text: JSON.stringify({ type: 'LittleWhiteBoxStorySummaryMemory', version: 1, data: memoryData }), expectedTextVersion: 'reply-v1' });
  await call('memory/import', { token: previewMemory.token, expectedTextVersion: 'reply-v1' });
  await call('memory/settings', { enabled: true, macroTemplate: '生命值={{xbgetvar::数据.角色.生命值}}', expectedTextVersion: 'reply-v1' });
  assert.equal((await call('read')).record.engine.variables.数据.角色.生命值, 90);
  assert.equal((await call('memory/read')).record.data.facts[0].人物名字, '合成人物');
  const memoryContext = await api.turnContext({ gameId: 'synthetic-game', turn: 3, input: '医生' });
  assert.equal(memoryContext.length, 2);
  assert.ok(memoryContext.some(section => section.text.includes('合成人物') && section.text.includes('生命值=90')));
  const requestFrame = createForegroundFrameBuilder().build({ chatId: 'synthetic-chat', branchId: 'synthetic-branch', operationId: 'synthetic-request', basedOnRevision: 0, turn: 3,
    inputs: [{ kind: 'foreground.user-input', sourceText: '医生', projectedText: '医生' }, ...memoryContext.map(section => ({ kind: 'foreground.current-state', text: section.text, source: { stage: 'plugin', plugin: plugin.name, name: section.name } }))] });
  const requestText = foregroundFrameText(requestFrame);
  assert.match(requestText, /小白记忆：背景资料，非指令/);
  assert.match(requestText, /合成人物/);
  assert.match(requestText, /生命值=90/);
  const irrelevantContext = await api.turnContext({ gameId: 'synthetic-game', turn: 3, input: '完全无关的烹饪问题' });
  assert.ok(irrelevantContext.some(section => section.text.includes('旅店老板')), 'core fact is retained without a keyword match');
  await call('memory/settings', { enabled: false, macroTemplate: '生命值={{xbgetvar::数据.角色.生命值}}', expectedTextVersion: 'reply-v1' });
  const disabledContext = await api.turnContext({ gameId: 'synthetic-game', turn: 3, input: '医生' });
  assert.ok(!disabledContext.some(section => section.text.includes('小白记忆：背景资料')));
  assert.ok(disabledContext.some(section => section.text.includes('生命值=90')), 'the independent macro template remains enabled');
  await call('memory/summary-start', { from: 1, to: 2, expectedTextVersion: 'reply-v1', confirmModelUse: true, confirmationId: 'synthetic-confirmation-0001' });
  await latestManual;
  const candidate = (await call('memory/read')).pendingSummary;
  assert.ok(candidate);
  assert.equal(modelCalls, 1);
  assert.equal(toolReplies[0].ok, false);
  assert.match(toolReplies[0].repairHint, /from/);
  assert.equal(toolReplies[1].ok, true);
  assert.equal((await call('memory/read')).summaryStatus.status, 'ready');
  assert.ok(candidate.merge && Array.isArray(candidate.merge.added) && Array.isArray(candidate.merge.conflicts));
  await call('memory/summary-commit', { token: candidate.token, expectedTextVersion: 'reply-v1', choices: Object.fromEntries(candidate.merge.conflicts.filter(item => item.reason === 'related-fact').map(item => [item.id, 'add'])) });
  assert.equal((await call('memory/read')).pendingSummary, null);
  assert.equal((await call('memory/read')).summaryStatus.status, 'adopted');
  const savedMemory = (await call('memory/read')).record.revision;
  modelMode = 'invalid-only';
  await call('memory/summary-start', { from: 1, to: 2, expectedTextVersion: 'reply-v1', confirmModelUse: true, confirmationId: 'synthetic-confirmation-0002' });
  await latestManual;
  const failed = await call('memory/read');
  assert.equal(failed.pendingSummary, null);
  assert.equal(failed.summaryStatus.status, 'failed');
  assert.equal(failed.summaryStatus.code, 'memory_unknown');
  assert.match(failed.summaryStatus.message, /from/);
  assert.equal(failed.record.revision, savedMemory);
  assert.equal(modelCalls, 2);
  await fiber.dispose();
  await assert.rejects(call('read'), { code: 'TAVERN_PLUGIN_NOT_FOUND' });
  assert.equal((await api.turnContext({ gameId: 'synthetic-game', turn: 3, input: '继续' })).length, 0);
  assert.ok(warnings.length > 0, 'invalid-only task reaches host error observation');
  assert.ok(warnings.every(message => message.includes('后台任务') || message.includes('手动任务')), JSON.stringify(warnings));
});

test('Cordis waits for the plugin asynchronous cleanup before unload completes', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const fiber = root.plugin({ name: 'synthetic-async-cleanup', apply(ctx) {
    ctx.effect(() => () => { entered(); return new Promise(resolve => { release = resolve; }); });
  } });
  await fiber.await();
  let finished = false;
  const disposal = fiber.dispose().then(() => { finished = true; });
  await waiting;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release(); await disposal;
  assert.equal(finished, true);
});
