// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const portable = { '<img src=x onerror=alert(1)>': '<script>bad()</script>' };
const memory = (patch = {}) => ({ record: { data: portable, turn: 3, textVersion: 'v1', revision: 1 }, busy: false, turn: 3, textVersion: 'v1', settings: { enabled: false, macroTemplate: '{{xbgetvar::角色}}' }, limits: { maxBytes: 49152 }, pendingSummary: null, ...patch });
async function setup(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.invalid/' });
  const old = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const calls = [], turns = [], publishes = [], stopped = [], downloads = [], revoked = [];
  let snapshot = memory(), panel, definition, confirmResult = true, confirmations = 0;
  dom.window.confirm = () => { confirmations++; return confirmResult; };
  dom.window.URL.createObjectURL = () => 'blob:memory-test';
  dom.window.URL.revokeObjectURL = url => revoked.push(url);
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, download: this.download }); };
  const ui = {
    apiVersion: 7, registerPanel(value) { panel = value; },
    watchTurnState(gameId, callback) { turns.push({ gameId, callback }); callback({ turn: snapshot.turn, textVersion: snapshot.textVersion, settled: true, busy: false }); return () => stopped.push('turn:' + gameId); },
    watchState(gameId, name, callback) { publishes.push({ gameId, name, callback }); return () => stopped.push(name + ':' + gameId); },
    async callHost(method, args) {
      calls.push([method, args]);
      if (overrides.host) { const result = overrides.host(method, args); if (result !== undefined) return result; }
      if (method === 'dsh-tavern-lwb/read') return { enabled: false, busy: false, turn: 3, textVersion: 'v1', record: null, initializable: true };
      if (method.endsWith('/memory/read')) return structuredClone(snapshot);
      if (method.endsWith('/memory/preview')) return { data: portable, counts: { entries: 2 }, previousCounts: { entries: 1 }, warnings: ['<b>warning</b>'], token: 'import-token' };
      if (method.endsWith('/memory/import')) return { saved: true };
      if (method.endsWith('/memory/settings')) { snapshot.settings = { ...snapshot.settings, ...Object.fromEntries(Object.entries(args).filter(([key]) => ['enabled', 'macroTemplate'].includes(key))) }; return {}; }
      if (method.endsWith('/memory/export')) return { fileName: '../memory.json', text: JSON.stringify(portable) };
      if (method.endsWith('/memory/summary-start')) { snapshot.pendingSummary = { data: portable, counts: { entries: 4 }, merge: { added: [{ id: 'n1', kind: 'keywords', next: { text: '新词' }, selected: true }], conflicts: [], retained: [] }, token: 'candidate-token', turn: snapshot.turn, textVersion: snapshot.textVersion }; return {}; }
      if (method.endsWith('/memory/summary-commit') || method.endsWith('/memory/summary-discard')) { snapshot.pendingSummary = null; return {}; }
      throw new Error('Unexpected ' + method);
    },
  };
  dom.window.__ModuleLoader__ = { load(value) { definition = value; } };
  vm.runInContext(source, vm.createContext({ window: dom.window, document: dom.window.document, URL: dom.window.URL, Blob: dom.window.Blob, console, setTimeout, clearTimeout }));
  definition.factory(() => React).apply({ tavernUi: ui });
  const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
  const update = async action => { await act(async () => { action(); await settle(); }); };
  const button = text => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text);
  const field = label => dom.window.document.querySelector('[aria-label="' + label + '"]');
  const change = async (label, text) => update(() => { const node = field(label); const prototype = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, text); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  const click = async text => { assert.ok(button(text), 'button exists: ' + text); await update(() => button(text).click()); };
  const render = async (gameId = 'game-a') => update(() => root.render(panel.render({ gameId })));
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await render();
  return { dom, panel, calls, turns, publishes, stopped, downloads, revoked, button, field, click, change, render, update, setSnapshot(value) { snapshot = value; }, get snapshot() { return snapshot; }, setConfirm(value) { confirmResult = value; }, get confirmations() { return confirmations; } };
}
const memoryCalls = (s, suffix) => s.calls.filter(([method]) => method.endsWith('/memory/' + suffix));

test('State remains default; memory tabs scroll, read safely, preview and explicitly replace', async t => {
  const s = await setup(t);
  assert.equal(s.panel.id, 'state'); assert.equal(s.panel.title, 'LWB Bridge');
  assert.equal(s.button('State').getAttribute('aria-selected'), 'true');
  assert.equal(memoryCalls(s, 'read').length, 0);
  const outer = s.dom.window.document.getElementById('root').firstElementChild;
  assert.equal(outer.style.height, '100%'); assert.equal(outer.style.minHeight, '0'); assert.equal(outer.style.overflowY, 'auto');
  assert.match(outer.firstElementChild.style.paddingBottom, /88px/);
  await s.click('记忆');
  assert.equal(s.publishes.at(-1).name, 'memory');
  assert.match(s.dom.window.document.body.textContent, /<img src=x/); assert.equal(s.dom.window.document.querySelector('img,script'), null);
  await s.change('记忆 JSON 文本', '{"entries":[]}');
  await s.click('预览记忆 JSON');
  assert.equal(s.button('确认替换记忆').disabled, false);
  assert.match(s.dom.window.document.body.textContent, /原有条目计数/); assert.match(s.dom.window.document.body.textContent, /<b>warning/);
  s.setConfirm(false); await s.click('确认替换记忆'); assert.equal(memoryCalls(s, 'import').length, 0);
  s.setConfirm(true); await s.click('确认替换记忆');
  assert.deepEqual({ ...memoryCalls(s, 'import')[0][1] }, { gameId: 'game-a', token: 'import-token', expectedTextVersion: 'v1' });
  assert.equal(s.button('确认替换记忆').disabled, true);
  await s.click('预览记忆 JSON'); await s.change('记忆 JSON 文本', '{}'); assert.equal(s.button('确认替换记忆').disabled, true);
  assert.equal(memoryCalls(s, 'summary-start').length, 0);
});

test('manual summary confirms model cost, validates 20 rounds, restores candidate, commits and discards', async t => {
  const s = await setup(t); await s.click('记忆');
  assert.match(s.dom.window.document.body.textContent, /宿主可能附带人物卡、世界书和最近剧情/);
  s.setConfirm(false); await s.click('生成记忆候选（使用模型额度）'); assert.equal(memoryCalls(s, 'summary-start').length, 0);
  s.setConfirm(true); await s.click('生成记忆候选（使用模型额度）');
  const startedArgs = { ...memoryCalls(s, 'summary-start')[0][1] }; assert.match(startedArgs.confirmationId, /^[a-zA-Z0-9_-]{16,80}$/); delete startedArgs.confirmationId; assert.deepEqual(startedArgs, { gameId: 'game-a', from: 1, to: 1, expectedTextVersion: 'v1', confirmModelUse: true });
  assert.match(s.dom.window.document.body.textContent, /模型提交的完整提案/);
  assert.match(s.dom.window.document.body.textContent, /旧记忆未出现在新总结中的条目会自动保留/);
  assert.equal(memoryCalls(s, 'summary-commit').length, 0);
  s.setConfirm(false); await s.click('确认采用已选增量'); assert.equal(memoryCalls(s, 'summary-commit').length, 0);
  s.setConfirm(true); await s.click('确认采用已选增量'); assert.equal(memoryCalls(s, 'summary-commit').length, 1);
  assert.equal(JSON.stringify(memoryCalls(s, 'summary-commit')[0][1].choices), '{}');
  s.setSnapshot(memory({ turn: 30, pendingSummary: { data: portable, counts: { entries: 9 }, token: 'restored', turn: 30, textVersion: 'v1' } }));
  await s.update(() => s.turns.at(-1).callback({ turn: 30, textVersion: 'v1', busy: false, settled: true }));
  assert.match(s.dom.window.document.body.textContent, /模型提交的完整提案/);
  await s.click('丢弃候选'); assert.equal(memoryCalls(s, 'summary-discard').at(-1)[1].token, 'restored');
  await s.change('结束轮', '21'); await s.click('生成记忆候选（使用模型额度）');
  assert.equal(memoryCalls(s, 'summary-start').length, 1); assert.match(s.dom.window.document.body.textContent, /最多 20 轮/);
});

test('merge choices are scoped to game and candidate token, and additions can be reselected', async t => {
  const s = await setup(t); await s.click('记忆');
  const candidate = token => ({ token, turn: 3, textVersion: 'v1', data: portable, merge: {
    added: [{ id: 'n1', kind: 'keywords', next: { text: '线索' }, selected: true }],
    conflicts: [{ id: 'c2', kind: 'keywords', reason: 'changed-existing', old: { weight: '低' }, next: { weight: '高' } }], retained: [] } });
  const show = async token => { s.setSnapshot(memory({ pendingSummary: candidate(token) })); await s.update(() => s.publishes.at(-1).callback({})); };
  const boxes = () => [...s.dom.window.document.querySelectorAll('input[type=checkbox]')];
  await show('A');
  await s.update(() => boxes()[0].click()); assert.equal(boxes()[0].checked, false);
  await s.update(() => boxes()[0].click()); assert.equal(boxes()[0].checked, true);
  await s.update(() => boxes()[1].click()); assert.equal(boxes()[1].checked, true);
  await s.click('确认采用已选增量');
  assert.equal(memoryCalls(s, 'summary-commit').at(-1)[1].choices.n1, true);
  assert.equal(memoryCalls(s, 'summary-commit').at(-1)[1].choices.c2, 'replace');
  await show('B'); assert.equal(boxes()[1].checked, false);
  await s.update(() => boxes()[1].click());
  await s.render('game-b'); await s.click('记忆');
  assert.equal(boxes()[1].checked, false, 'same candidate id in another game has safe defaults');
});

test('settings and Blob download use host endpoints; busy disables controls and subscriptions clean up', async t => {
  const s = await setup(t); await s.click('记忆'); await s.click('开启记忆');
  assert.equal(memoryCalls(s, 'settings')[0][1].enabled, true);
  await s.change('记忆宏模板', '{{xbgetvar_yaml_idx::角色[0][\"姓名\"]}}'); await s.click('保存记忆模板');
  assert.equal(memoryCalls(s, 'settings').at(-1)[1].macroTemplate, '{{xbgetvar_yaml_idx::角色[0][\"姓名\"]}}');
  assert.match(s.dom.window.document.body.textContent, /引号键/);
  assert.match(s.dom.window.document.body.textContent, /只展开本模板/);
  await s.click('导出记忆 JSON'); assert.deepEqual(s.downloads, [{ href: 'blob:memory-test', download: '.._memory.json' }]);
  await s.update(() => s.turns.at(-1).callback({ turn: 3, textVersion: 'v1', busy: true, settled: false }));
  for (const node of s.dom.window.document.querySelectorAll('section button,section input,section textarea')) assert.equal(node.disabled, node.textContent !== '刷新记忆', node.textContent);
  await s.render('game-b'); assert.ok(s.stopped.includes('memory:game-a')); assert.deepEqual(s.revoked, ['blob:memory-test']);
});

test('late preview, file and read results cannot survive edits, game switch or version publication', async t => {
  const preview = deferred(); let deferPreview = true;
  const s = await setup(t, { host(method) { if (method.endsWith('/memory/preview') && deferPreview) return preview.promise; } });
  await s.click('记忆'); await s.change('记忆 JSON 文本', '{}');
  await s.click('预览记忆 JSON');
  await s.update(() => { s.setSnapshot(memory({ textVersion: 'v2' })); s.turns.at(-1).callback({ turn: 3, textVersion: 'v2', settled: true, busy: false }); });
  await s.update(() => preview.resolve({ token: 'stale', data: {}, counts: {}, previousCounts: {}, warnings: [] }));
  assert.equal(s.button('确认替换记忆').disabled, true);
  deferPreview = false;
  const file = deferred(); const fileInput = s.field('记忆 JSON 文件');
  await s.update(() => { Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size: 10, text: () => file.promise }] }); fileInput.dispatchEvent(new s.dom.window.Event('change', { bubbles: true })); });
  await s.change('记忆 JSON 文本', '{"keep":true}'); await s.update(() => file.resolve('overwritten'));
  assert.equal(s.field('记忆 JSON 文本').value, '{"keep":true}');
  await s.update(() => { Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size: 49153, text: () => { throw new Error('must not read'); } }] }); fileInput.dispatchEvent(new s.dom.window.Event('change', { bubbles: true })); });
  assert.match(s.dom.window.document.body.textContent, /49152 字节/);
  await s.click('预览记忆 JSON'); assert.equal(s.button('确认替换记忆').disabled, false);
  await s.update(() => s.publishes.at(-1).callback({})); assert.equal(s.button('确认替换记忆').disabled, true);
  const oldTurn = s.turns.at(-1); await s.render('game-b'); await s.click('记忆');
  await s.update(() => oldTurn.callback({ turn: 99, textVersion: 'old', busy: true }));
  assert.equal(s.button('开启记忆').disabled, false);
  const lateFile = deferred(), nextInput = s.field('记忆 JSON 文件');
  await s.update(() => { Object.defineProperty(nextInput, 'files', { configurable: true, value: [{ size: 8, text: () => lateFile.promise }] }); nextInput.dispatchEvent(new s.dom.window.Event('change', { bubbles: true })); });
  await s.render('game-c'); await s.click('记忆'); await s.update(() => lateFile.resolve('old-game-file'));
  assert.equal(s.field('记忆 JSON 文本').value, '');
});

test('mutation lock prevents duplicate writes and late reads do not overwrite a newer version', async t => {
  const read = deferred(), write = deferred(); let holdRead = false, holdWrite = false;
  const s = await setup(t, { host(method) { if (holdRead && method.endsWith('/memory/read')) return read.promise; if (holdWrite && method.endsWith('/memory/settings')) return write.promise; } });
  await s.click('记忆'); holdWrite = true;
  await s.update(() => { s.button('开启记忆').click(); s.button('开启记忆').click(); });
  assert.equal(memoryCalls(s, 'settings').length, 1); assert.equal(s.button('保存记忆模板').disabled, true);
  holdWrite = false; await s.update(() => write.resolve({}));
  holdRead = true; await s.click('刷新记忆');
  assert.equal(s.button('开启记忆').disabled, true, 'refresh read disables actions');
  assert.equal(s.field('记忆 JSON 文件').disabled, true);
  await s.update(() => { s.setSnapshot(memory({ textVersion: 'v2' })); s.turns.at(-1).callback({ turn: 3, textVersion: 'v2', settled: true, busy: false }); });
  holdRead = false; await s.update(() => read.resolve(memory({ textVersion: 'v1', settings: { enabled: false, macroTemplate: 'STALE' } })));
  assert.notEqual(s.field('记忆宏模板').value, 'STALE');
  await s.change('记忆 JSON 文本', '{}'); await s.click('预览记忆 JSON');
  assert.equal(memoryCalls(s, 'preview').at(-1)[1].expectedTextVersion, 'v2');
});
