// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const sampleEngine = { variables: { 数据: { 角色: { 生命值: 100, 金币: 0 } } }, LWB_RULES_V2: {}, roots: ['数据'] };
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(ui, dom) {
  let definition;
  dom.window.__ModuleLoader__ = { load(value) { definition = value; } };
  const context = vm.createContext({ window: dom.window, document: dom.window.document, console, URL: dom.window.URL, Blob: dom.window.Blob, setTimeout, clearTimeout });
  vm.runInContext(source, context, { filename: 'client.js' });
  const plugin = definition.factory(name => { assert.equal(name, 'react'); return React; });
  plugin.apply({ tavernUi: ui });
  return definition;
}

test('batch panel restores metadata without auto-commit, confirms explicitly, and clears scope on game switch', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.invalid/' });
  const old = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let panel, confirmed = false;
  const calls = [], plan = { token: 'synthetic-a', turn: 1, textVersion: 'v1', expired: false, targets: [{ turn: 1, textVersion: 'v1' }] };
  const ui = { apiVersion: 7, registerPanel(value) { panel = value; },
    watchTurnState(_id, callback) { callback({ turn: 1, textVersion: 'v1', settled: true, busy: false }); return () => {}; },
    watchState() { return () => {}; },
    async callHost(method, args) {
      calls.push([method, args]);
      if (method.endsWith('/read')) return { enabled: true, busy: false, turn: 1, textVersion: 'v1', record: { engine: sampleEngine }, limits: {} };
      if (method.endsWith('/history-batch-inspect')) return args.gameId === 'a' ? plan : null;
      if (method.endsWith('/history-batch-commit')) return { completed: 1 };
      throw Error('Unexpected ' + method);
    } };
  dom.window.confirm = () => confirmed;
  load(ui, dom);
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
  const button = text => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text);
  await act(async () => { root.render(panel.render({ gameId: 'a' })); await settle(); });
  await act(async () => { button('查看或恢复回填计划').click(); await settle(); });
  assert.ok(button('确认执行或续跑回填'));
  assert.equal(calls.filter(([method]) => method.endsWith('/history-batch-commit')).length, 0);
  await act(async () => { button('确认执行或续跑回填').click(); await settle(); });
  assert.equal(calls.filter(([method]) => method.endsWith('/history-batch-commit')).length, 0);
  confirmed = true;
  await act(async () => { button('确认执行或续跑回填').click(); await settle(); });
  const commits = calls.filter(([method]) => method.endsWith('/history-batch-commit'));
  assert.equal(commits.length, 1); assert.equal(commits[0][1].token, 'synthetic-a'); assert.equal(commits[0][1].confirmReplace, true);
  await act(async () => { root.render(panel.render({ gameId: 'b' })); await settle(); });
  assert.equal(button('确认执行或续跑回填'), undefined);
});

test('real React panel enables, previews, confirms initialization; edits invalidate preview; UI text is escaped', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.invalid/' });
  const old = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let panel, watch, publish, stops = 0;
  let snapshot = { version: '0.1.0-alpha.1', enabled: false, busy: false, turn: 1, textVersion: 'v1', record: null, initializable: true, limits: {} };
  const calls = [];
  const ui = {
    apiVersion: 7,
    registerPanel(value) { panel = value; },
    watchTurnState(id, callback) { watch = callback; callback({ turn: 1, textVersion: 'v1', settled: true, busy: false }); return () => stops++; },
    watchState(id, name, callback) { publish = callback; callback(null); return () => stops++; },
    async callHost(method, args) {
      calls.push([method, args]);
      if (method.endsWith('/read')) return structuredClone(snapshot);
      if (method.endsWith('/enable')) { snapshot.enabled = args.enabled; return { enabled: args.enabled }; }
      if (method.endsWith('/preview')) return { status: 'success', errors: [], corrections: [], changes: [], operationCount: 1, engine: sampleEngine };
      if (method.endsWith('/migration-preview')) return { token: 'restore-token', engine: sampleEngine, report: [], turn: 1, textVersion: 'v1' };
      if (method.endsWith('/migration-commit')) return { saved: true };
      if (method.endsWith('/initialize')) { snapshot.record = { engine: { ...sampleEngine, variables: { '<img src=x onerror=alert(1)>': '测试' } }, diagnostics: { status: 'success' } }; snapshot.initializable = false; return { saved: true }; }
      throw new Error('Unexpected ' + method);
    },
  };
  load(ui, dom);
  assert.equal(panel.id, 'state');
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => { await act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  async function settle() { for (let i = 0; i < 3; i++) await tick(); }
  await act(async () => { root.render(panel.render({ gameId: 'game-a' })); await settle(); });
  const button = text => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text);
  await act(async () => { button('开启本局').click(); await settle(); });
  assert.ok(button('关闭本局'));
  assert.equal(calls.some(([method]) => method.endsWith('/process')), false);
  await act(async () => { button('预览').click(); await settle(); });
  assert.equal(button('确认初始化').disabled, false, 'success status should unlock confirmation');
  await act(async () => { watch({ turn: 2, textVersion: 'v2', settled: false, busy: true }); await settle(); });
  assert.equal(button('确认初始化').disabled, true);
  await act(async () => { watch({ turn: 1, textVersion: 'v1', settled: true, busy: false }); await settle(); });
  await act(async () => { button('预览').click(); await settle(); });
  await act(async () => { button('确认初始化').click(); await settle(); });
  assert.equal(calls.filter(([method]) => method.endsWith('/initialize')).length, 1);
  assert.ok(dom.window.document.body.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(dom.window.document.querySelector('img'), null);
  dom.window.confirm = () => true;
  await act(async () => { button('预览历史回放').click(); await settle(); });
  assert.ok(button('确认建立迁移基线'));
  await act(async () => { button('确认建立迁移基线').click(); await settle(); });
  assert.equal(calls.filter(([name]) => name.endsWith('/migration-commit')).length, 1);
  assert.equal(calls.find(([name]) => name.endsWith('/migration-commit'))[1].confirmReplace, true);
  await act(async () => { root.render(panel.render({ gameId: 'game-b' })); await settle(); });
  assert.equal(stops, 2, 'changing game cleans up old subscriptions');
});

test('client registration failure is contained; old API does not register', () => {
  const dom = new JSDOM('');
  assert.doesNotThrow(() => load({ apiVersion: 7, callHost() {}, registerPanel() { throw new Error('synthetic'); } }, dom));
  let registered = false;
  load({ apiVersion: 6, callHost() {}, registerPanel() { registered = true; } }, dom);
  assert.equal(registered, false);
  dom.window.close();
});
