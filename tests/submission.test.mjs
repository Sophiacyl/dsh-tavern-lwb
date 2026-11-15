// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_LIMITS, emptyMemory, normalizeMemoryData } from '../memory/core.mjs';
import { MEMORY_SUBMISSION_TOOL_NAME, createMemorySubmission } from '../memory/submission.mjs';

const fixture = () => ({
  keywords: [{ text: ' 信物 ', weight: '高' }],
  events: [{ id: 'e1', title: '相逢', summary: '桥上相逢。', participants: ['小雪'], causedBy: [] }],
  characters: { main: [{ name: '小雪' }] },
  characterAliases: [{ from: '旅人', to: '小雪', evidence: '自报姓名' }],
  arcs: [{ name: '信任', trajectory: '逐渐信任', progress: 0.5, moments: [{ text: '交付信物' }] }],
  facts: [{ 人物名字: '小雪', 种类: '物品', 描述: '持有信物', 核心事实: true, 趋势: '持平' }],
});
const failed = (result, code) => {
  assert.equal(result.ok, false);
  assert.equal(typeof result.error.message, 'string');
  if (code) assert.equal(result.error.code, code);
};

// An independent, small JSON Schema interpreter checks the advertised contract.
function conforms(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    if (Object.entries(value).some(([key, item]) => schema.properties[key] && !conforms(item, schema.properties[key]))) return false;
  }
  if (schema.type === 'array' && (!Array.isArray(value) || value.length > schema.maxItems || value.some(item => !conforms(item, schema.items)))) return false;
  if (schema.type === 'string' && (typeof value !== 'string' || value.length > schema.maxLength || value.length < (schema.minLength || 0) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return false;
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum)) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (!schema.type && schema.required?.some(key => !Object.hasOwn(value, key) || !conforms(value[key], schema.properties[key]))) return false;
  return !schema.anyOf || schema.anyOf.some(option => conforms(value, option));
}

test('public tool exposes complete strict bounded six-collection schema', () => {
  const { tool } = createMemorySubmission();
  assert.equal(MEMORY_SUBMISSION_TOOL_NAME, 'memory_submit');
  assert.equal(tool.name, MEMORY_SUBMISSION_TOOL_NAME);
  assert.equal(typeof tool.description, 'string');
  assert.equal(typeof tool.execute, 'function');
  assert.deepEqual(tool.parameters.required, ['memory']);
  assert.equal(tool.parameters.additionalProperties, false);
  const schema = tool.parameters.properties.memory;
  assert.deepEqual(Object.keys(schema.properties), ['keywords', 'events', 'characters', 'characterAliases', 'arcs', 'facts']);
  assert.deepEqual(schema.required, ['facts']);
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') assert.equal(node.additionalProperties, false);
    if (node.type === 'array') assert.equal(node.maxItems, 200);
    if (node.type === 'string') assert.equal(node.maxLength, 4000);
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
  };
  visit(tool.parameters);
  assert.deepEqual(schema.properties.characterAliases.items.required, ['from', 'to']);
  assert.deepEqual(schema.properties.facts.items.required, ['人物名字', '种类', '描述']);
  assert.equal(schema.properties.facts.items.properties.核心事实.type, 'boolean');
  assert.equal(schema.properties.arcs.items.properties.progress.maximum, 1);
  assert.ok(conforms({ memory: fixture() }, tool.parameters));
  assert.ok(!conforms({ memory: { ...emptyMemory(), characterAliases: [{ name: 'a', alias: 'b' }] } }, tool.parameters));
  assert.ok(!conforms({ memory: { facts: [{ 人物名字: 'a', 种类: 'b', 描述: 'x'.repeat(4001) }] } }, tool.parameters));
  assert.ok(!conforms({ memory: { facts: [], events: [{}] } }, tool.parameters));
});

test('bad alias receives repair hint and can be corrected in the same submission', async () => {
  const submission = createMemorySubmission();
  const data = fixture(); data.characterAliases = [{ unknownFirst: '秘密', name: '秘密角色', alias: '秘密别名' }];
  const rejected = await submission.tool.execute({ memory: data });
  failed(rejected, 'memory_unknown');
  assert.match(rejected.repairHint, /from.*to.*evidence/u);
  assert.ok(!JSON.stringify(rejected).includes('秘密'));
  assert.equal(submission.getSubmission(), null);
  data.characterAliases = fixture().characterAliases;
  assert.deepEqual(await submission.tool.execute({ memory: data }), { ok: true });
  assert.deepEqual(submission.getSubmission(), normalizeMemoryData(data));
});

test('empty arrays and minimal portable memory are legitimate submissions', async () => {
  for (const data of [emptyMemory(), { facts: [] }]) {
    const submission = createMemorySubmission();
    assert.deepEqual(await submission.tool.execute({ memory: data }), { ok: true });
    assert.deepEqual(submission.getSubmission(), emptyMemory());
  }
});

test('optional fields and normalizer character/moment shorthand remain supported', async () => {
  const data = {
    facts: [{ 人物名字: 'a', 种类: 'b', 描述: 'c' }], keywords: [{ text: 'a' }], events: [{ summary: 'event' }],
    characters: ['a', { name: 'b' }], characterAliases: [{ from: 'a', to: 'b' }], arcs: [{ name: 'arc', moments: ['one', { text: 'two' }] }],
  };
  const submission = createMemorySubmission();
  assert.ok(conforms({ memory: data }, submission.tool.parameters));
  assert.deepEqual(await submission.tool.execute({ memory: data }), { ok: true });
  assert.deepEqual(submission.getSubmission(), normalizeMemoryData(data));
});

test('wrong arguments are rejected without reading getters or echoing input', async () => {
  const submission = createMemorySubmission();
  const argumentsList = [undefined, null, [], 'secret', {}, { memory: emptyMemory(), secret: 'secret' }, { memory: emptyMemory(), [Symbol('secret')]: 1 }, Object.create({ memory: emptyMemory() })];
  let called = false;
  argumentsList.push(Object.defineProperty({}, 'memory', { enumerable: true, get() { called = true; throw Error('secret'); } }));
  for (const args of argumentsList) {
    const result = await submission.tool.execute(args);
    failed(result, 'memory_arguments'); assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(called, false);
  assert.equal(submission.getSubmission(), null);
});

test('unknown fields at every depth including removable host fields fail closed', async () => {
  const mutations = [
    d => { d.secretKey = 'private'; }, d => { d._addedAt = 1; }, d => { d.keywords[0].unknown = 1; },
    d => { d.events[0].unknown = 1; }, d => { d.characters.unknown = 1; }, d => { d.characters.main[0].unknown = 1; },
    d => { d.characterAliases[0].unknown = 1; }, d => { d.arcs[0].unknown = 1; }, d => { d.arcs[0].moments[0].unknown = 1; },
    d => { d.facts[0].unknown = 'private'; }, d => { d.facts[0].id = 'private'; },
  ];
  for (const mutate of mutations) {
    const submission = createMemorySubmission(), data = fixture(); mutate(data);
    const result = await submission.tool.execute({ memory: data });
    failed(result); assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('secretKey'));
    assert.equal(submission.getSubmission(), null);
  }
});

test('wrong required fields and types cannot be accepted by the tool', async () => {
  const bad = [
    {}, { facts: null }, { facts: [{ s: 'secret', p: 'private', o: 'hidden' }] },
    { facts: [{ 人物名字: 'a', 种类: 'b' }] }, { facts: [{ 人物名字: 'a', 种类: 'b', 描述: 'c', 核心事实: 'true' }] },
    { facts: [], keywords: [{ text: '   ' }] }, { facts: [], events: [{}] },
    { facts: [], characterAliases: [{ from: 'a' }] }, { facts: [], arcs: [{ name: 'a', progress: 2 }] },
    { facts: [], arcs: [{ name: 'a', moments: [{ text: false }] }] },
  ];
  for (const memory of bad) failed(await createMemorySubmission().tool.execute({ memory }));
});

test('strings, individual arrays, aggregate items and bytes enforce core limits', async () => {
  const oversized = [
    { facts: [{ 人物名字: 'a', 种类: 'b', 描述: 'x'.repeat(4001) }] },
    { facts: [], keywords: Array.from({ length: 201 }, () => ({ text: 'a' })) },
    { facts: [], keywords: Array.from({ length: 200 }, () => ({ text: 'a' })), characters: ['a'] },
    { facts: Array.from({ length: 10 }, () => ({ 人物名字: 'a', 种类: 'b', 描述: '雪'.repeat(2000) })) },
  ];
  for (const memory of oversized) {
    const submission = createMemorySubmission(); failed(await submission.tool.execute({ memory })); assert.equal(submission.getSubmission(), null);
  }
});

test('capacity checks include the complete exported package overhead', async () => {
  const memory = emptyMemory();
  memory.facts = Array.from({ length: 13 }, () => ({ 人物名字: 'a', 种类: 'b', 描述: 'x' }));
  let left = MEMORY_LIMITS.packageBytes - 50 - Buffer.byteLength(JSON.stringify(memory));
  for (const fact of memory.facts) { const add = Math.min(left, 3999); fact.描述 += 'x'.repeat(add); left -= add; }
  assert.equal(left, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(normalizeMemoryData(memory))) < MEMORY_LIMITS.packageBytes);
  const submission = createMemorySubmission();
  failed(await submission.tool.execute({ memory }), 'memory_size');
  assert.equal(submission.getSubmission(), null);
});

test('accessors, non-JSON data, shared values and unsafe shapes never run user code', async () => {
  let called = 0;
  const getter = { facts: [] }; Object.defineProperty(getter, 'keywords', { enumerable: true, get() { called++; throw Error('SECRET'); } });
  const hidden = { facts: [] }; Object.defineProperty(hidden, 'keywords', { value: [] });
  const shared = { text: 'shared' };
  const sparse = { facts: [], keywords: new Array(2) };
  const extraArray = []; extraArray.secret = 'SECRET';
  const cases = [getter, hidden, { facts: [], keywords: [shared, shared] }, sparse, { facts: extraArray }, { facts: [], arcs: [{ name: 'a', progress: Infinity }] }, Object.create({ facts: [] }), JSON.parse('{"facts":[],"__proto__":{}}')];
  for (const memory of cases) {
    const result = await createMemorySubmission().tool.execute({ memory }); failed(result); assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  assert.equal(called, 0);
});

test('only the first legal normalized submission is retained; duplicates are idempotent', async () => {
  const submission = createMemorySubmission(), data = fixture();
  assert.deepEqual(await submission.tool.execute({ memory: data }), { ok: true });
  const first = submission.getSubmission();
  assert.deepEqual(await submission.tool.execute({ memory: normalizeMemoryData(data) }), { ok: true, duplicate: true });
  failed(await submission.tool.execute({ memory: { facts: [] }, extra: true }), 'memory_arguments');
  failed(await submission.tool.execute({ memory: emptyMemory() }), 'already_submitted');
  assert.deepEqual(submission.getSubmission(), first);
});

test('both caller mutation and returned snapshot mutation cannot change accepted content', async () => {
  const submission = createMemorySubmission(), data = fixture(), expected = normalizeMemoryData(data);
  await submission.tool.execute({ memory: data });
  data.facts[0].描述 = 'mutated'; data.characters.main.push({ name: 'mutated' });
  const copy = submission.getSubmission(); copy.facts[0].描述 = 'changed copy'; copy.arcs[0].moments.length = 0;
  assert.deepEqual(submission.getSubmission(), expected);
});

test('checkActive runs before copy and after copy, including duplicate ok responses', async () => {
  let calls = 0;
  const submission = createMemorySubmission({ checkActive: () => { calls++; } });
  await submission.tool.execute({ memory: emptyMemory() }); assert.equal(calls, 2);
  await submission.tool.execute({ memory: emptyMemory() }); assert.equal(calls, 4);
  await submission.tool.execute({ memory: {} }); assert.equal(calls, 5);
});

test('checkActive cancellation may throw or reject and never accepts partial data', async () => {
  const cancelled = Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
  for (const cancelAt of [1, 2]) {
    let calls = 0;
    const submission = createMemorySubmission({ checkActive: () => { if (++calls === cancelAt) throw cancelled; } });
    await assert.rejects(submission.tool.execute({ memory: emptyMemory() }), error => error === cancelled);
    assert.equal(submission.getSubmission(), null);
  }
  const rejected = createMemorySubmission({ checkActive: async () => { throw cancelled; } });
  await assert.rejects(rejected.tool.execute({ memory: emptyMemory() }), error => error === cancelled);
});

test('close rejects calls, including close during either asynchronous activity check', async () => {
  const closed = createMemorySubmission(); closed.close(); closed.close();
  await assert.rejects(closed.tool.execute({ memory: emptyMemory() }), { code: 'submission_closed' });
  for (const closeAt of [1, 2]) {
    let calls = 0, release;
    const submission = createMemorySubmission({ checkActive: () => ++calls === closeAt ? new Promise(resolve => { release = resolve; }) : undefined });
    const result = submission.tool.execute({ memory: fixture() });
    while (!release) await Promise.resolve();
    submission.close(); release();
    await assert.rejects(result, { code: 'submission_closed' });
    assert.equal(submission.getSubmission(), null);
  }
});

test('cancellation and close preserve an already accepted snapshot', async () => {
  let cancelled = false;
  const submission = createMemorySubmission({ checkActive: () => { if (cancelled) throw Error('cancel'); } });
  await submission.tool.execute({ memory: fixture() });
  const expected = submission.getSubmission(); cancelled = true;
  await assert.rejects(submission.tool.execute({ memory: fixture() }), /cancel/u);
  submission.close();
  await assert.rejects(submission.tool.execute({ memory: emptyMemory() }), { code: 'submission_closed' });
  assert.deepEqual(submission.getSubmission(), expected);
});

test('microtask cancellation after the last asynchronous check never returns first or duplicate ok', async () => {
  for (const duplicate of [false, true]) {
    const controller = new AbortController(); let calls = 0, armed = false;
    const submission = createMemorySubmission({ signal: controller.signal, checkActive() {
      if (armed && ++calls === 2) queueMicrotask(() => controller.abort(new Error('microtask cancel')));
    } });
    if (duplicate) await submission.tool.execute({ memory: emptyMemory() });
    armed = true;
    await assert.rejects(submission.tool.execute({ memory: emptyMemory() }), /microtask cancel/);
    assert.equal(submission.getSubmission() === null, !duplicate);
  }
});

test('concurrent valid submissions admit one snapshot and do not overwrite it', async () => {
  const submission = createMemorySubmission();
  const results = await Promise.all([submission.tool.execute({ memory: fixture() }), submission.tool.execute({ memory: emptyMemory() })]);
  assert.equal(results.filter(result => result.ok).length, 1);
  failed(results.find(result => !result.ok), 'already_submitted');
  assert.deepEqual(submission.getSubmission(), normalizeMemoryData(fixture()));
});
