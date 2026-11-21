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
const oldMemory = { entries: [{ text: '保留原有记忆' }] };
const status = (value, patch = {}) => ({ status: value, message: '', turn: 3, from: 1, to: 3, updatedAt: 123, ...patch });
const candidate = { data: { entries: [{ text: '新候选' }] }, counts: { entries: 1 }, token: 'candidate-token', turn: 3, textVersion: 'v1' };
const memory = (patch = {}) => ({ record: { data: oldMemory, turn: 3, textVersion: 'v1' }, busy: false, turn: 3, textVersion: 'v1', settings: { enabled: false, macroTemplate: '' }, pendingSummary: null, summaryStatus: null, ...patch });

async function setup(t, initial = memory(), host = () => undefined) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.invalid/' });
  const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const calls = [], turns = [], publishes = [], stopped = [];
  let snapshot = initial, panel, definition, confirmations = 0;
  dom.window.confirm = () => { confirmations++; return true; };
  const ui = {
    apiVersion: 7, registerPanel(value) { panel = value; },
    watchTurnState(gameId, callback) { turns.push({ gameId, callback }); callback({ turn: 3, textVersion: 'v1', busy: false, settled: true }); return () => stopped.push('turn:' + gameId); },
    watchState(gameId, name, callback) { publishes.push({ gameId, name, callback }); return () => stopped.push(name + ':' + gameId); },
    async callHost(method, args) {
      calls.push([method, args]);
      const result = host(method, args); if (result !== undefined) return result;
      if (method.endsWith('/memory/read')) return structuredClone(snapshot);
      if (method.endsWith('/memory/summary-start')) return {};
      if (method === 'dsh-tavern-lwb/read') return { enabled: false, busy: false, turn: 3, textVersion: 'v1', record: null, initializable: true };
      throw new Error('Unexpected ' + method);
    },
  };
  dom.window.__ModuleLoader__ = { load(value) { definition = value; } };
  vm.runInContext(source, vm.createContext({ window: dom.window, document: dom.window.document, console, setTimeout, clearTimeout }));
  definition.factory(() => React).apply({ tavernUi: ui });
  const update = async action => act(async () => { action(); for (let i = 0; i < 4; i++) await tick(); });
  const button = text => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text);
  const click = async text => { assert.ok(button(text), text); await update(() => button(text).click()); };
  const render = async (gameId = 'game-a') => update(() => root.render(panel.render({ gameId })));
  const summary = () => dom.window.document.querySelector('[role="status"][aria-label="总结状态"]');
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await render(); await click('记忆');
  return { dom, calls, turns, publishes, stopped, button, click, render, update, summary, setSnapshot(value) { snapshot = value; }, get confirmations() { return confirmations; } };
}
const count = (s, suffix) => s.calls.filter(([method]) => method.endsWith('/memory/' + suffix)).length;
const generate = '生成记忆候选（使用模型额度）';
const body = s => s.dom.window.document.body.textContent;

test('idle and failed status stay visible; screenshot alias errors render as safe React text', async t => {
  const s = await setup(t);
  assert.match(s.summary().textContent, /尚未生成记忆候选/);
  const message = '截图 alias <img src=x onerror="alert(1)"> 未找到 <script>bad()</script>';
  const code = '<svg onload=bad()>MODEL_ALIAS_NOT_FOUND';
  s.setSnapshot(memory({ summaryStatus: status('failed', { message, code }) }));
  await s.update(() => s.publishes.at(-1).callback({}));
  assert.match(s.summary().textContent, /不需要反复点击；本次未替换记忆。新的生成仍需确认模型额度/);
  assert.ok(s.summary().textContent.includes(message)); assert.ok(s.summary().textContent.includes(code));
  assert.ok(s.summary().querySelector('[role="alert"]'));
  assert.equal(s.dom.window.document.querySelector('img,script,svg'), null);
  assert.match(body(s), /保留原有记忆/); assert.equal(s.button(generate).disabled, false);
  assert.equal(s.button('确认采用已选增量'), undefined);
});

for (const value of ['queued', 'running', 'ready']) test(value + ' status explains progress and gates candidate actions', async t => {
  const ready = value === 'ready';
  const s = await setup(t, memory({ summaryStatus: status(value, { message: '宿主状态 ' + value }), pendingSummary: ready ? candidate : null }));
  assert.match(s.summary().textContent, ready ? /候选已生成.*下方/ : /等待/);
  assert.match(s.summary().textContent, new RegExp('宿主状态 ' + value));
  assert.equal(s.button(generate).disabled, true);
  assert.equal(s.button('刷新记忆').disabled, false);
  if (ready) { assert.equal(s.button('确认采用已选增量').disabled, false); assert.equal(s.button('丢弃候选').disabled, false); }
  else { await s.click(generate); assert.equal(count(s, 'summary-start'), 0); assert.equal(s.confirmations, 0); }
});

for (const value of ['expired', 'stale']) test(value + ' explains missing candidate while retaining current memory', async t => {
  const message = value === 'expired' ? '候选超过保留时间' : '正文版本从 v1 变为 v2';
  const s = await setup(t, memory({ summaryStatus: status(value, { message }) }));
  assert.match(s.summary().textContent, value === 'expired' ? /候选已过期/ : /回合或正文版本已变化/);
  assert.ok(s.summary().textContent.includes(message)); assert.match(body(s), /保留原有记忆/);
  assert.equal(!!s.summary().querySelector('[role="alert"]'), value === 'stale');
  assert.equal(s.button('确认采用已选增量'), undefined); assert.equal(s.button(generate).disabled, false);
});

for (const [value, text] of [['cancelled', '生成已取消'], ['adopted', '候选已采用'], ['discarded', '候选已丢弃']]) test(value + ' terminal status is distinct from idle', async t => {
  const s = await setup(t, memory({ summaryStatus: status(value) }));
  assert.ok(s.summary().textContent.includes(text)); assert.doesNotMatch(s.summary().textContent, /尚未生成/);
  assert.equal(s.button(generate).disabled, false); assert.match(body(s), /保留原有记忆/);
});

test('summary-start existing status is reported honestly; already-admitted refreshes without resending', async t => {
  let result = { status: 'failed', message: '模型额度不足', code: 'MODEL_QUOTA' };
  const s = await setup(t, memory(), method => method.endsWith('/memory/summary-start') ? result : undefined);
  await s.click(generate);
  assert.match(body(s), /模型额度不足/); assert.doesNotMatch(body(s), /已请求生成/);
  const first = s.calls.find(([method]) => method.endsWith('/summary-start'))[1];
  assert.match(first.confirmationId, /^[a-zA-Z0-9_-]{16,80}$/); assert.equal(first.confirmModelUse, true);
  const beforeRead = count(s, 'read');
  result = { status: 'already-admitted' };
  s.setSnapshot(memory({ summaryStatus: status('running') }));
  await s.click(generate);
  assert.match(body(s), /本次已接纳/); assert.match(s.summary().textContent, /正在生成/);
  assert.ok(count(s, 'read') > beforeRead); assert.equal(count(s, 'summary-start'), 2);
  await s.click(generate); assert.equal(count(s, 'summary-start'), 2); assert.equal(s.confirmations, 2);
});

test('busy allows read-only refresh; loading and mutation still disable refresh', async t => {
  const read = deferred(), write = deferred(); let holdRead = false, holdWrite = false;
  const s = await setup(t, memory({ busy: true, summaryStatus: status('running') }), method => {
    if (holdRead && method.endsWith('/memory/read')) return read.promise;
    if (holdWrite && method.endsWith('/memory/summary-start')) return write.promise;
  });
  await s.update(() => s.turns.at(-1).callback({ turn: 3, textVersion: 'v1', busy: true, settled: false }));
  assert.equal(s.button('刷新记忆').disabled, false); assert.equal(s.button(generate).disabled, true);
  const before = count(s, 'read'); holdRead = true; await s.click('刷新记忆');
  assert.equal(count(s, 'read'), before + 1); assert.equal(s.button('刷新记忆').disabled, true);
  holdRead = false; await s.update(() => read.resolve(memory({ busy: true, summaryStatus: status('failed', { message: '忙碌任务失败' }) })));
  assert.match(s.summary().textContent, /忙碌任务失败/); assert.equal(s.button('刷新记忆').disabled, false);
  s.setSnapshot(memory()); await s.update(() => s.turns.at(-1).callback({ turn: 3, textVersion: 'v1', busy: false, settled: true }));
  holdWrite = true; await s.click(generate); assert.equal(s.button('刷新记忆').disabled, true);
  await s.update(() => write.resolve({ status: 'queued' })); assert.equal(s.button('刷新记忆').disabled, false);
});

test('switching games cleans subscriptions and ignores late summary responses and publications', async t => {
  const write = deferred();
  const s = await setup(t, memory({ summaryStatus: status('failed', { message: '旧局错误' }) }), (method, args) => method.endsWith('/memory/summary-start') && args.gameId === 'game-a' ? write.promise : undefined);
  const oldTurn = s.turns.at(-1), oldPublish = s.publishes.at(-1);
  await s.click(generate); s.setSnapshot(memory()); await s.render('game-b'); await s.click('记忆');
  assert.ok(s.stopped.includes('turn:game-a')); assert.ok(s.stopped.includes('memory:game-a'));
  const before = count(s, 'read');
  await s.update(() => { oldTurn.callback({ turn: 99, textVersion: 'old', busy: true }); oldPublish.callback({}); write.resolve({ status: 'failed', message: '迟到的旧局错误' }); });
  assert.equal(count(s, 'read'), before); assert.match(s.summary().textContent, /尚未生成记忆候选/);
  assert.doesNotMatch(body(s), /旧局错误/); assert.equal(s.button(generate).disabled, false);
});
