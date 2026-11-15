// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyEngine, applyText, extractStateBlocks, LIMITS } from '../core/index.mjs';
import { createGuardCore } from '../vendor/state2/guard-core.js';
import { executeStateOperations } from '../vendor/state2/executor.js';

const json = ops => JSON.stringify({ ops });
const apply = (text, engine = emptyEngine(), options) => applyText(engine, text, options);
const ok = (result, status = 'success') => { assert.equal(result.status, status, JSON.stringify(result.errors)); return result; };
function rejected(text, code, engine = emptyEngine(), options) {
  const before = structuredClone(engine);
  const result = apply(text, engine, options);
  assert.equal(result.status, 'failed', JSON.stringify(result));
  if (code) assert.equal(result.errors[0].code, code);
  assert.deepEqual(result.engine, before);
  assert.deepEqual(engine, before);
  assert.match(result.errors[0].message, /[\u3400-\u9fff]/);
  return result;
}

test('emptyEngine and immutable, fully serializable snapshots', () => {
  const first = emptyEngine(), second = emptyEngine();
  assert.deepEqual(first, { variables: {}, LWB_RULES_V2: {}, roots: [] });
  first.variables.foo = 1;
  assert.deepEqual(second.variables, {});
  const input = emptyEngine(); Object.freeze(input.variables); Object.freeze(input.roots); Object.freeze(input);
  const result = ok(apply('hero: {"hp":5,"bag":[]}', input));
  assert.deepEqual(input, emptyEngine());
  assert.deepEqual(result.engine, JSON.parse(JSON.stringify(result.engine)));
  assert.deepEqual(result.engine.roots, ['hero']);
  const next = ok(apply('hero.hp: +2', result.engine));
  assert.equal(next.engine.variables.hero.hp, 7);
  assert.equal(result.engine.variables.hero.hp, 5);
});

test('range and step preserve upstream corrections', () => {
  const result = ok(apply('$range=[0,10] $step=3 hp\nhp: 8\nhp: +8'));
  assert.equal(result.engine.variables.hp, 10);
  assert.equal(result.operationCount, 2);
  assert.equal(result.corrections.length, 1);
  assert.match(result.corrections[0].note, /步长/);
  assert.match(result.corrections[0].note, /范围/);
});

test('schema type lock, whitelist, nested wildcard and array templates', () => {
  const source = '$schema hero\n  hp: 0\n  bag:\n    - name: ""\n      n: 0\n  flags:\n    "*": false\nhero: {"hp":"12","bag":[],"flags":{"ready":true}}\nhero.bag: +{"name":"potion","n":2}';
  const result = ok(apply(source));
  assert.equal(result.engine.variables.hero.hp, 12);
  assert.deepEqual(result.engine.variables.hero.bag, [{ name: 'potion', n: 2 }]);
  const partial = ok(apply('hero.extra: 1\nhero.hp: 3', result.engine), 'partial');
  assert.equal(partial.engine.variables.hero.hp, 3);
  assert.equal(partial.errors[0].code, 'rule_rejected');
  assert.equal(Object.hasOwn(partial.engine.variables.hero, 'extra'), false);
  const type = apply('hero.hp: "bad"', result.engine);
  assert.equal(type.status, 'failed');
  assert.equal(type.errors[0].code, 'rule_rejected');
  assert.deepEqual(type.engine, result.engine);
});

test('increment and deep paths cannot bypass schema types, whitelist or readonly ancestors', () => {
  const initial = ok(apply('$schema 数据\n  名称: ""\n  生命值: 0\n  背包: []\n数据: {"名称":"abc","生命值":100,"背包":[]}')).engine;
  for (const text of ['数据.名称: +1', '数据.陌生: +1', '数据.生命值.extra: 1', '数据.背包.name: 1']) {
    const result = apply(text, initial);
    assert.equal(result.status, 'failed', text);
    assert.equal(result.errors[0].code, 'rule_rejected');
    assert.deepEqual(result.engine, initial, text);
  }
  const protectedRoot = ok(apply('$ro 数据', initial)).engine;
  for (const text of ['数据.生命值: +1', '数据.背包: +"item"', '数据.名称: null']) {
    assert.equal(apply(text, protectedRoot).status, 'failed', text);
  }
  const numeric = ok(apply('$enum={1,2} n\nn: 1')).engine;
  assert.equal(apply('n: +2', numeric).status, 'failed');
});

test('push/remove/del follow original equality and index ordering', () => {
  const initial = ok(apply('bag: ["a","b","c","d"]')).engine;
  const removed = ok(apply(json([{ op: 'remove', path: 'bag', value: ['b'] }, { op: 'push', path: 'bag', value: ['e', 'f'] }]), initial));
  assert.deepEqual(removed.engine.variables.bag, ['a', 'c', 'd', 'e', 'f']);
  const deleted = ok(apply(json([{ op: 'del', path: 'bag[0]' }, { op: 'del', path: 'bag[2]' }]), initial));
  assert.deepEqual(deleted.engine.variables.bag, ['b', 'd']);
  rejected(json([{ op: 'del', path: 'bag[0]' }, { op: 'set', path: 'bag[2]', value: 'x' }]), 'conflicting_operations', initial);
  const rootDeleted = ok(apply('bag: null', initial));
  assert.deepEqual(rootDeleted.engine.variables, {});
  assert.ok(rootDeleted.engine.roots.includes('bag'));
});

test('JSON public schema and unmanaged-root behavior', () => {
  const result = apply(json([{ op: 'set', path: 'new', value: 1 }]));
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'unmanaged_root');
  assert.deepEqual(result.engine, emptyEngine());
  const initial = ok(apply('hp: 1')).engine;
  const partial = ok(apply(json([{ op: 'inc', path: 'hp', delta: 2 }, { op: 'set', path: 'unknown', value: 3 }]), initial), 'partial');
  assert.equal(partial.engine.variables.hp, 3);
  for (const input of ['[]', '{"ops":[],"extra":1}', '{"ops":[{"op":"pop","path":"hp","value":1}]}', '{"ops":[{"op":"inc","path":"hp","delta":"2"}]}', '{"ops":[{"op":"set","path":"hp"}]}']) rejected(input, undefined, initial);
});

test('requireBlocks only closed blocks, and fatal incomplete blocks never partly run', () => {
  ok(apply('narration hp: 100', emptyEngine(), { requireBlocks: true }), 'noop');
  const good = ok(apply('before\n<state lang="state2">hp: 2</state>\nother text\n<STATE>hp: +1</STATE>', emptyEngine(), { requireBlocks: true }));
  assert.equal(good.engine.variables.hp, 3);
  assert.deepEqual(extractStateBlocks('a<state>x: 1</state>b'), ['x: 1']);
  for (const input of ['<state>hp: 1', '<state>hp: 1</state><state>hp: 2', '<state', '<state><state>x: 2</state></state>', '</state>', '<state/>']) rejected(input, undefined, emptyEngine(), { requireBlocks: true });
  ok(apply('<statement>hello</statement>', emptyEngine(), { requireBlocks: true }), 'noop');
});

test('fatal parse warnings, unrecognized lines, and malformed schemas roll back', () => {
  const bad = ['hp: \"unterminated', 'hp: -\"unterminated', 'hp: 1\nnot an operation', 'hp: 1\n  ignored: 2', 'hp: [bad', 'hp: +[bad', '$unknown hp\nhp: 1', '$ro', '$schema hp', '$schema\n  hp: 0', '$schemaX hp\n  x: 1', '$schema hp\n  - 1\n  - 2', '$schema hp\n  x: null', '$schema hp\n  x: 2025-01-01', '$schema hp\n  x.y: 0', '$schema hp\n  x: .inf', '$range=[0,Infinity] hp', '$enum={} hp'];
  for (const input of bad) rejected(input);
});

test('prototype and special keys rejected in JSON, text, YAML, schema and engine', () => {
  for (const key of ['__proto__', 'prototype', 'constructor', 'length']) {
    for (const path of [key, `a.${key}`, `a["${key}"]`]) {
      rejected(`${path}: 1`);
      rejected(json([{ op: 'set', path, value: 1 }]));
    }
    rejected(`a: {"${key}":1}`);
    rejected(`a:\n  ${key}: 1`);
    rejected(`$schema a\n  ${key}: 0`);
    const input = JSON.parse(`{"variables":{"${key}":1},"LWB_RULES_V2":{},"roots":[]}`);
    assert.equal(apply('', input).status, 'failed');
  }
  assert.equal({}.polluted, undefined);
});

test('strict path syntax and bounded indices', () => {
  for (const path of ['a..b', 'a.', '.a', 'a[1', 'a[-1]', 'a[1.5]', 'a[1e3]', 'a[2001]', 'a[9999999999999999999]', 'a["x.y"]', 'a.*', 'a["length"]', '1.x']) rejected(`${path}: 1`);
  const tooMany = Array.from({ length: 25 }, (_, i) => `p${i}`).join('.');
  rejected(`${tooMany}: 1`, 'path_limit');
  const max = ok(apply('arr[2000]: 1'));
  assert.equal(max.engine.variables.arr.length, 2001);
  assert.equal(max.engine.variables.arr[1999], null);
});

test('YAML remains available but aliases, tags, complex keys and nonfinite values fail', () => {
  const good = ok(apply('hero:\n  hp: 4\n  bag:\n    - a\n    - b'));
  assert.deepEqual(good.engine.variables.hero, { hp: 4, bag: ['a', 'b'] });
  for (const yaml of ['x: &a [1,2]\n  y: *a', 'x: !!js/function abc', 'x: .inf', 'x: .nan', 'x: 2025-01-01', '? [a, b]\n: 1', 'x: {a: 1, a: 2}', 'x: !!set {a: null}', 'x: &a [*a]', 'x: &a [1]\ny: {<<: *a}']) rejected(`root:\n${yaml.split('\n').map(line => '  ' + line).join('\n')}`);
  for (const value of ['.inf', '.NaN', 'Infinity', '1e999', '-1e999']) rejected(`hp: ${value}`);
});

test('all engines, repeated calls and guard factories remain independent', () => {
  const locked = ok(apply('$ro hp')).engine;
  const unlocked = ok(apply('hp: 1')).engine;
  for (let i = 0; i < 3; i++) {
    assert.equal(apply('hp: 2', locked).errors[0].code, 'rule_rejected');
    assert.equal(ok(apply('hp: 2', unlocked)).engine.variables.hp, 2);
    assert.deepEqual(ok(apply('hp: 2')).engine.variables.hp, 2);
  }
  const a = createGuardCore(), b = createGuardCore();
  a.setRule('hp', { ro: true });
  assert.equal(a.validate('set', 'hp', 1).allow, false);
  assert.equal(b.validate('set', 'hp', 1).allow, true);
});

test('reentrant executor calls cannot replace the outer guard table', () => {
  const meta = { variables: { hp: 1 }, LWB_RULES_V2: { hp: { ro: true } } };
  const before = structuredClone(meta);
  let reentered = false;
  const result = executeStateOperations(meta, [], [{ op: 'set', path: 'free', value: 1 }, { op: 'set', path: 'hp', value: 2 }], {
    memory: true, boundary: () => {
      reentered = true;
      executeStateOperations({ variables: {}, LWB_RULES_V2: {} }, [], [{ op: 'set', path: 'hp', value: 99 }], { memory: true });
    },
  });
  assert.ok(reentered);
  assert.equal(meta.variables.hp, before.variables.hp);
  assert.equal(result.errors[0].code, 'rule_rejected');
});

test('text UTF8 bytes, operations and rules limits apply to entire input', () => {
  rejected('#' + '中'.repeat(11000), 'text_limit');
  rejected('x: 1\n'.repeat(129), 'operation_limit');
  rejected(Array.from({ length: 129 }, (_, i) => `$ro r${i}`).join('\n'), 'rule_limit');
  const rules = ok(apply(Array.from({ length: 128 }, (_, i) => `$ro r${i}`).join('\n'))).engine;
  rejected('$ro extra', 'rule_limit', rules);
  assert.equal(LIMITS.textBytes, 32768);
  assert.equal(LIMITS.engineBytes, 49152);
});

test('depth/node boundaries and generated arrays stay bounded', () => {
  const nested = depth => { let value = 1; while (depth--) value = { x: value }; return value; };
  rejected(`root: ${JSON.stringify(nested(21))}`, 'depth_limit');
  const many = { a: Array(2001).fill(0), b: Array(2001).fill(0) };
  rejected(`root: ${JSON.stringify(many)}`, 'node_limit');
  rejected(`root: ${JSON.stringify(Array(2002).fill(0))}`, 'array_limit');
  const arr = ok(apply(`root: ${JSON.stringify(Array(2001).fill(0))}`)).engine;
  rejected('root: +[1]', 'array_limit', arr);
  const sparse = emptyEngine(); sparse.variables.a = Array(2);
  assert.equal(apply('', sparse).errors[0].code, 'sparse_array');
});

test('finite inputs cannot overflow through inc or numeric coercion', () => {
  const engine = { variables: { hp: Number.MAX_VALUE }, LWB_RULES_V2: {}, roots: ['hp'] };
  rejected(json([{ op: 'inc', path: 'hp', delta: Number.MAX_VALUE }]), 'invalid_value', engine);
  rejected(`$schema hero\n  hp: 0\nhero: {"hp":"${'9'.repeat(400)}"}`);
});

test('engine byte budget rolls back, and diagnostics keep result below 64KiB', () => {
  const initial = ok(apply(`big: "${'x'.repeat(26000)}"`)).engine;
  rejected(`other: "${'y'.repeat(26000)}"`, 'engine_limit', initial);
  const malformed = emptyEngine(); malformed.variables.x = Infinity;
  assert.equal(apply('', malformed).status, 'failed');
  const result = ok(apply(Array.from({ length: 128 }, (_, i) => `x: "${'z'.repeat(200)}${i}"`).join('\n')));
  assert.ok(Buffer.byteLength(JSON.stringify({ errors: result.errors, corrections: result.corrections, changes: result.changes })) < LIMITS.diagnosticBytes + 100);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
});

test('accessors/functions/complex objects and invalid options never reach the host', () => {
  let touched = false; const engine = emptyEngine();
  Object.defineProperty(engine.variables, 'x', { enumerable: true, get() { touched = true; throw new Error('private payload'); } });
  assert.doesNotThrow(() => apply('', engine));
  assert.equal(touched, false);
  for (const options of [null, true, { requireBlocks: 'true' }, { unsupported: true }, Object.defineProperty({}, 'requireBlocks', { get() { throw new Error('x'); } })]) {
    assert.doesNotThrow(() => apply('', emptyEngine(), options));
    assert.equal(apply('', emptyEngine(), options).status, 'failed');
  }
  const thrown = new Proxy({}, { get() { throw new Error('must not read exception'); }, getPrototypeOf() { throw new Error('must not inspect exception'); } });
  const hostile = new Proxy({}, { getPrototypeOf() { throw thrown; } });
  assert.doesNotThrow(() => apply('', hostile));
  assert.equal(apply('', hostile).errors[0].code, 'parse_failed');
  for (const value of [new Date(), new Map(), () => {}, NaN, Symbol('x')]) {
    const bad = emptyEngine(); bad.variables.value = value;
    assert.equal(apply('', bad).status, 'failed');
  }
});

test('wildcard rule priority is stable and lookup scales with rules, not path combinations', () => {
  const guard = createGuardCore();
  guard.setRule('r.*.x', { min: 1 });
  guard.setRule('r.a.*', { min: 2 });
  guard.setRule('r.[*].x', { min: 3 });
  assert.equal(guard.getRuleNode('r.a.x').min, 2);
  assert.equal(guard.getRuleNode('r.0.x').min, 3);
  guard.setRule('r.a.x', { min: 4 });
  assert.equal(guard.getRuleNode('r.a.x').min, 4);
  const deep = 'r.' + Array(23).fill('0').join('.');
  assert.equal(guard.getRuleNode(deep), null);
});

test('YAML warnings, malformed quote and multi-block total limits fail atomically', () => {
  rejected('root:\n  %YAML 1.3\n  ---\n  x: 1');
  rejected('x: \"unterminated');
  rejected('<state>' + 'x: 1\n'.repeat(65) + '</state><state>' + 'y: 2\n'.repeat(65) + '</state>', 'operation_limit');
  const deepYaml = 'root:\n' + Array.from({ length: 150 }, (_, i) => ' '.repeat(i * 2 + 2) + 'x:').join('\n');
  rejected(deepYaml);
  const initial = ok(apply('r: 1')).engine;
  rejected('<state>r: 2</state><state>r: [bad</state>', 'parse_warning', initial);
});

test('parse failures never print input or diagnostics to stdout/stderr', () => {
  const captured = []; const names = ['log', 'warn', 'error', 'info', 'debug'];
  const originals = names.map(name => console[name]);
  try {
    names.forEach(name => { console[name] = (...args) => captured.push(args); });
    apply('secret: +[private-invalid');
    apply('$schema secret\n  : [private-invalid');
    apply('secret:\n  x: [private-invalid');
  } finally { names.forEach((name, i) => { console[name] = originals[i]; }); }
  assert.deepEqual(captured, []);
});
