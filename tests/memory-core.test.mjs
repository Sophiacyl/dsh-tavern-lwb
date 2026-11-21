// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_LIMITS, emptyMemory, normalizeMemoryData, parseMemoryPackage, exportMemoryPackage, parseSummaryResponse, memoryPrompt } from '../memory/core.mjs';
import { expandLwbMacros } from '../memory/macros.mjs';
import { load } from '../vendor/js-yaml.mjs';

const fixture = () => ({
  keywords: [{ text: '信物', weight: '高' }],
  events: [{ id: 'e-1', title: '相逢', timeLabel: '春', summary: '在桥上相逢。', participants: ['小雪'], memoryRole: '具体经历', causedBy: [] }],
  characters: { main: [{ name: '小雪' }] },
  characterAliases: [{ from: '旅人', to: '小雪', evidence: '她说出了名字' }],
  arcs: [{ name: '小雪', trajectory: '愿意信任', progress: 0.5, moments: [{ text: '交付信物' }] }],
  facts: [{ 人物名字: '小雪', 种类: '物品', 描述: '信物', 核心事实: true, 趋势: '持平' }],
});
const wrap = data => ({ type: 'LittleWhiteBoxStorySummaryMemory', version: 1, data });
const rejects = (fn, code) => assert.throws(fn, e => e.code === code && /[\u3400-\u9fff]/u.test(e.message));

test('portable upstream shape round-trips every collection without mutation', () => {
  const input = fixture(), before = structuredClone(input), output = exportMemoryPackage(input);
  assert.equal(output.type, 'LittleWhiteBoxStorySummaryMemory');
  assert.equal(output.version, 1);
  assert.ok(Number.isFinite(Date.parse(output.exportedAt)));
  assert.deepEqual(output.counts, { keywords: 1, events: 1, characters: 1, aliases: 1, arcs: 1, facts: 1 });
  const parsed = parseMemoryPackage(JSON.stringify(output));
  assert.deepEqual(parsed, { data: input, counts: output.counts, warnings: [] });
  assert.deepEqual(input, before);
  parsed.data.facts[0].描述 = '副本';
  assert.deepEqual(input, before);
  assert.deepEqual(normalizeMemoryData(emptyMemory()), emptyMemory());
});

test('known source ownership, vectors and undo are removed with warnings', () => {
  const data = fixture();
  data._addedAt = 90; data.summaryHistory = [{ undo: {} }]; data.vector = { cache: [1, 2] };
  data.events[0]._addedAt = 99; data.events[0].sourceFloor = 100;
  data.events[0].summary += ' (#90-100)'; data.arcs[0].moments[0]._addedAt = 99;
  data.facts[0].id = 'old-fact-id';
  const before = structuredClone(data), result = parseMemoryPackage(JSON.stringify(wrap(data)));
  assert.deepEqual(result.data, fixture());
  assert.ok(result.warnings.length >= 8);
  assert.ok(result.warnings.some(w => w.includes('楼层源标记')));
  assert.deepEqual(data, before);
});

test('portable facts required; internal or malformed facts never silently clear', () => {
  for (const data of [{}, { facts: {} }, { facts: [{ s: '小雪', p: '物品', o: '信物' }] }, { facts: [{ ...fixture().facts[0], s: '混合内部' }] }]) {
    rejects(() => normalizeMemoryData(data), 'memory_facts');
  }
  for (const fact of [{ 人物名字: '小雪', 种类: '物品' }, { 人物名字: ' ', 种类: '物品', 描述: '信物' }, { ...fixture().facts[0], 核心事实: 'false' }]) {
    rejects(() => normalizeMemoryData({ facts: [fact] }), 'memory_shape');
  }
  assert.deepEqual(normalizeMemoryData({ facts: [] }), emptyMemory());
});

test('unknown fields reject at every portable boundary; package counts are recomputed', () => {
  const mutations = [d => { d.typo = 1; }, d => { d.events[0].titleTypo = 'x'; }, d => { d.facts[0].extra = true; }, d => { d.characters.extra = []; }, d => { d.arcs[0].moments[0].extra = 1; }];
  for (const mutate of mutations) {
    const data = fixture(); mutate(data);
    rejects(() => normalizeMemoryData(data), 'memory_unknown');
  }
  rejects(() => parseMemoryPackage(JSON.stringify({ ...wrap(fixture()), bad: 1 })), 'memory_unknown');
  rejects(() => parseMemoryPackage(JSON.stringify({ ...wrap(fixture()), version: 2 })), 'memory_package');
  const parsed = parseMemoryPackage(JSON.stringify({ ...wrap(fixture()), counts: { facts: 30 } }));
  assert.equal(parsed.counts.facts, 1); assert.equal(parsed.warnings.length, 1);
});

test('byte, array, aggregate item and string bounds reject instead of truncating', () => {
  assert.deepEqual(MEMORY_LIMITS, { packageBytes: 48 * 1024, items: 200, stringChars: 4000, promptChars: 3000 });
  rejects(() => parseMemoryPackage(' '.repeat(MEMORY_LIMITS.packageBytes + 1)), 'memory_size');
  rejects(() => normalizeMemoryData({ facts: [], keywords: Array.from({ length: 201 }, () => ({ text: 'a' })) }), 'memory_items');
  rejects(() => normalizeMemoryData({ facts: [], keywords: Array.from({ length: 200 }, () => ({ text: 'a' })), characters: { main: ['a'] } }), 'memory_items');
  rejects(() => normalizeMemoryData({ facts: [{ 人物名字: 'a', 种类: 'b', 描述: 'x'.repeat(4001) }] }), 'memory_string');
  rejects(() => normalizeMemoryData({ facts: Array.from({ length: 10 }, () => ({ 人物名字: 'a', 种类: 'b', 描述: '雪'.repeat(2000) })) }), 'memory_size');
  const data = normalizeMemoryData({ facts: [{ 人物名字: 'a', 种类: 'b', 描述: 'x'.repeat(4000) }] });
  assert.equal(data.facts[0].描述.length, 4000);
});

test('safe JSON copy rejects prototypes, accessors, special values and structural bombs', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const data = JSON.parse(`{"facts":[],"${key}":{}}`);
    rejects(() => normalizeMemoryData(data), 'memory_key');
    rejects(() => parseMemoryPackage(JSON.stringify(wrap(data))), 'memory_key');
  }
  let called = false;
  const accessor = { facts: [] };
  Object.defineProperty(accessor, 'unknown', { enumerable: true, get() { called = true; throw Error('getter'); } });
  rejects(() => normalizeMemoryData(accessor), 'memory_value'); assert.equal(called, false);
  rejects(() => normalizeMemoryData(Object.create({ facts: [] })), 'memory_value');
  for (const bad of [undefined, NaN, Infinity, () => {}, new Date(), 1n]) rejects(() => normalizeMemoryData({ facts: [], undo: bad }), 'memory_value');
  const cycle = {}; cycle.a = cycle;
  rejects(() => normalizeMemoryData({ facts: [], undo: cycle }), 'memory_value');
  const shared = {}; rejects(() => normalizeMemoryData({ facts: [], undo: [shared, shared] }), 'memory_value');
  rejects(() => normalizeMemoryData({ facts: [], undo: new Array(2) }), 'memory_value');
  let deep = {}; for (let i = 0; i < 20; i++) deep = { next: deep };
  rejects(() => normalizeMemoryData({ facts: [], undo: deep }), 'memory_depth');
  const broad = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 0));
  rejects(() => normalizeMemoryData({ facts: [], undo: broad }), 'memory_nodes');
});

test('summary parser accepts only complete portable JSON or a single json fence', () => {
  assert.deepEqual(parseSummaryResponse(JSON.stringify(fixture())), fixture());
  assert.deepEqual(parseSummaryResponse(`\n\`\`\`json\n${JSON.stringify(fixture())}\n\`\`\`\n`), fixture());
  assert.deepEqual(parseSummaryResponse(JSON.stringify(wrap(fixture()))), fixture());
  for (const text of ['说明\n{}', '{}{}', '```json\n{}\n```\nextra', '```js\n{}\n```', '{"facts":[],}', '[]', 'null', '{"data":{"facts":[]}}', '{"json":{"facts":[]}}']) assert.throws(() => parseSummaryResponse(text));
});

test('convenient character/moment string forms normalize without losing content', () => {
  const data = normalizeMemoryData({ facts: [], characters: [' 小雪 '], arcs: [{ name: '信任', moments: ['约定'] }] });
  assert.deepEqual(data.characters, { main: [{ name: '小雪' }] });
  assert.deepEqual(data.arcs[0], { name: '信任', trajectory: '', progress: 0, moments: [{ text: '约定' }] });
});

test('query recall is deterministic, core-first, bounded, deduplicated and inert', () => {
  const data = fixture();
  data.facts.push({ 人物名字: '陌生人', 种类: '经历', 描述: '寻找蓝桥' });
  data.events.push({ id: 'e2', title: '蓝桥', summary: '寻找蓝桥' });
  data.facts[0].描述 = '{{xbgetvar::secret}}';
  const before = structuredClone(data), prompt = memoryPrompt(data, { query: '蓝桥' });
  assert.equal(prompt, memoryPrompt(data, { query: '蓝桥' }));
  assert.ok(prompt.indexOf('核心事实') < prompt.indexOf('寻找蓝桥'));
  assert.ok(prompt.indexOf('寻找蓝桥') < prompt.indexOf('在桥上相逢'));
  assert.equal(prompt.match(/寻找蓝桥/gu).length, 1);
  assert.ok(prompt.includes('{{xbgetvar::secret}}'));
  assert.deepEqual(data, before);
  for (const maxChars of [0, 1, 20, 200, 3000, 9000]) assert.ok(memoryPrompt(data, { query: '蓝桥', maxChars }).length <= Math.min(maxChars, 3000));
  const repeated = { facts: Array.from({ length: 20 }, (_, i) => ({ 人物名字: `人物${i}`, 种类: '经历', 描述: `回忆${i}${'x'.repeat(1000)}` })) };
  assert.ok(memoryPrompt(repeated).length <= 3000);
  rejects(() => memoryPrompt(data, { maxChars: -1 }), 'memory_prompt');
});

const engine = () => ({ variables: { 人物: { 名字: '小雪', 列表: [{ text: 'a\nb: #x', quote: '"\\' }, ['yes', null], {}], 空: [], 数字: 0, 假: false, 无: null }, raw: '<tag>"\\\n{{xbgetvar::人物.名字}}' }, roots: ['人物'], LWB_RULES_V2: {} });

test('macros expand own dotted/bracket paths, JSON objects, raw scalars and safe defaults', () => {
  const e = engine(), before = structuredClone(e);
  const result = expandLwbMacros('{{xbgetvar::人物.名字}}|{{xbgetvar::人物.列表[0].text}}|{{xbgetvar::人物.数字}}|{{xbgetvar::人物.假}}|{{xbgetvar::人物.无}}|{{xbgetvar::人物.不存在}}', e);
  assert.equal(result.text, '小雪|a\nb: #x|0|false||');
  assert.equal(result.diagnostics[0].code, 'macro_missing');
  assert.deepEqual(JSON.parse(expandLwbMacros('{{xbgetvar::人物}}', e).text), e.variables.人物);
  assert.equal(expandLwbMacros('{{xbgetvar::raw}}', e).text, e.variables.raw);
  assert.deepEqual(e, before);
  assert.deepEqual(expandLwbMacros('普通模板', undefined), { text: '普通模板', diagnostics: [] });
});

test('YAML and YAML idx preserve nesting/ambiguous scalars and index comment semantics', () => {
  const e = engine();
  for (const name of ['xbgetvar_yaml', 'xbgetvar_yaml_idx']) {
    const result = expandLwbMacros(`{{${name}::人物}}`, e);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(load(result.text), e.variables.人物);
    assert.equal(expandLwbMacros(`{{${name}::人物.名字}}`, e).text, '小雪');
  }
  const text = expandLwbMacros('{{xbgetvar_yaml_idx::人物.列表}}', e).text;
  assert.ok(text.includes('# [0]')); assert.ok(text.includes('# [1]')); assert.ok(text.includes('# [2]'));
  assert.deepEqual(load(text), e.variables.人物.列表);
  assert.equal(expandLwbMacros('{{xbgetvar_yaml_idx::人物.空}}', e).text, '[]');
});

test('legacy quoted-key and whitespace macro paths normalize within the restricted reader', () => {
  const value = { variables: { A: [{ name: '小雪' }], 人物: { '名字': '旅人' } } };
  assert.equal(expandLwbMacros('{{ xbgetvar :: A[0].name }}', value).text, '小雪');
  assert.equal(expandLwbMacros('{{xbgetvar::人物["名字"]}}', value).text, '旅人');
  assert.equal(expandLwbMacros("{{xbgetvar::人物['名字']}}", value).text, '旅人');
  assert.equal(expandLwbMacros('{{xbgetvar::人物[名字]}}', value).text, '旅人');
  for (const path of ['人物[bad key]', '人物[-1]', '人物["bad key"]', '人物["constructor"]']) {
    const macro = `{{xbgetvar::${path}}}`, result = expandLwbMacros(macro, value);
    assert.equal(result.text, macro); assert.equal(result.diagnostics.length, 1);
  }
});

test('unknown and invalid macros remain with diagnostics; no execution or inherited reads', () => {
  const e = engine();
  const unknown = '{{getglobalvar::secret}} {{xbsetvar::人物.名字::恶意}} {{xbgetvar::人物.名字::default}}';
  const result = expandLwbMacros(unknown, e);
  assert.equal(result.text, unknown); assert.equal(result.diagnostics.length, 3);
  for (const path of ['人物.__proto__', '人物.constructor.name', '人物.prototype', '人物[-1]', '人物[bad key]', '人物["bad key"]', '人物..名字', Array(18).fill('x').join('.')]) {
    const text = `{{xbgetvar::${path}}}`;
    const r = expandLwbMacros(text, e);
    assert.equal(r.text, text); assert.equal(r.diagnostics.length, 1);
  }
  const inherited = Object.create({ secret: '不可读' }); inherited.own = '可读';
  assert.equal(expandLwbMacros('{{xbgetvar::root.secret}}', { variables: { root: inherited } }).text, '');
  let called = false; const access = {};
  Object.defineProperty(access, 'secret', { enumerable: true, get() { called = true; return 'bad'; } });
  assert.equal(expandLwbMacros('{{xbgetvar::root.secret}}', { variables: { root: access } }).diagnostics[0].code, 'macro_value');
  assert.equal(called, false);
  assert.equal(e.variables.人物.名字, '小雪');
});

test('macro boundaries reject oversized input/output without truncation and contain bad values', () => {
  rejects(() => expandLwbMacros('x'.repeat(8001), engine()), 'macro_size');
  assert.equal(expandLwbMacros('x'.repeat(8000), engine()).text.length, 8000);
  const e = { variables: { big: 'x'.repeat(5000) } };
  rejects(() => expandLwbMacros('{{xbgetvar::big}}{{xbgetvar::big}}', e), 'macro_size');
  assert.equal(expandLwbMacros('{{xbgetvar::big}}', e).text.length, 5000);
  const cyclic = {}; cyclic.self = cyclic;
  const r = expandLwbMacros('{{xbgetvar::x}}', { variables: { x: cyclic } });
  assert.equal(r.text, '{{xbgetvar::x}}'); assert.equal(r.diagnostics[0].code, 'macro_value');
  assert.equal(expandLwbMacros('{{xbgetvar::x}}', {}).diagnostics[0].code, 'macro_engine');
});

test('UTF-8 input bounds run before JSON parsing and stripped metadata is validated', () => {
  rejects(() => parseMemoryPackage(' '.repeat(49153)), 'memory_size');
  rejects(() => parseMemoryPackage('雪'.repeat(16385)), 'memory_size');
  rejects(() => parseSummaryResponse(' '.repeat(49153)), 'memory_size');
  rejects(() => parseMemoryPackage(' '), 'memory_json');
  let called = false;
  const hidden = { facts: [] };
  Object.defineProperty(hidden, 'toJSON', { value() { called = true; return { facts: [] }; } });
  rejects(() => normalizeMemoryData(hidden), 'memory_value');
  assert.equal(called, false);
  const data = { facts: [], undo: JSON.parse('{"__proto__":{}}') };
  rejects(() => normalizeMemoryData(data), 'memory_key');
});

test('nested portable collections share the 200-item budget', () => {
  const data = { facts: [], arcs: [{ name: '轨迹', moments: Array.from({ length: 199 }, () => ({ text: '片段' })) }] };
  assert.equal(normalizeMemoryData(data).arcs[0].moments.length, 199);
  data.keywords = [{ text: '超限' }];
  rejects(() => normalizeMemoryData(data), 'memory_items');
});

test('macro size rejection applies to values as well as final output', () => {
  rejects(() => expandLwbMacros('{{xbgetvar::x}}', { variables: { x: 'x'.repeat(8001) } }), 'macro_size');
  rejects(() => expandLwbMacros('{{xbgetvar_yaml::x}}', { variables: { x: { text: 'x'.repeat(8000) } } }), 'macro_size');
  const raw = '"'.repeat(8000);
  assert.equal(expandLwbMacros('{{xbgetvar::x}}', { variables: { x: raw } }).text, raw);
});

test('nested and incomplete macros stay inert and substitutions are single pass', () => {
  const e = engine();
  for (const template of ['{{unknown::{{xbgetvar::人物.名字}}}}', '{{xbgetvar::{{xbgetvar::人物.名字}}}}', '{{xbgetvar::人物.名字']) {
    const r = expandLwbMacros(template, e);
    assert.equal(r.text, template);
    assert.equal(r.diagnostics.length, 1);
    assert.equal(r.diagnostics[0].code, 'macro_syntax');
  }
  const e2 = { variables: { x: '{{xbgetvar::y}}', y: '不能递归' } };
  assert.equal(expandLwbMacros('{{xbgetvar::x}}', e2).text, '{{xbgetvar::y}}');
});
