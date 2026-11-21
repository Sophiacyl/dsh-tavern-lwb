// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryMerge, applyMemoryMerge } from '../memory/merge.mjs';

const memory = (facts, keywords = []) => ({ keywords, events: [], characters: { main: [] }, characterAliases: [], arcs: [], facts });
const fact = (description, kind = '约定') => ({ 人物名字: '小雪', 种类: kind, 描述: description, 核心事实: true });

test('merge preview distinguishes new, unchanged, conflicting and retained entries', () => {
  const base = memory([fact('钟楼见面'), fact('持有银钥匙', '物品')], [{ text: '旧线索', weight: '高' }]);
  const proposed = memory([fact('钟楼见面'), fact('改在港口见面'), fact('获得蓝宝石', '物品')], [{ text: '新线索', weight: '高' }]);
  const plan = createMemoryMerge(base, proposed);
  assert.equal(plan.preview.added.length, 3);
  assert.equal(plan.preview.conflicts.length, 2);
  assert.ok(plan.preview.added.some(item => item.kind === 'keywords' && item.next.text === '新线索'));
  assert.ok(plan.preview.conflicts.filter(item => item.reason === 'related-fact').length === 2);
  assert.ok(plan.preview.retained.some(item => item.value.描述 === '钟楼见面'));
  assert.ok(plan.preview.retained.some(item => item.value.描述 === '持有银钥匙'));
  assert.ok(plan.preview.retained.some(item => item.value.text === '旧线索'));
});

test('merge defaults to preserving conflicts and retains omitted old entries', () => {
  const base = memory([fact('钟楼见面'), fact('持有银钥匙', '物品')]);
  const proposed = memory([fact('改在港口见面'), fact('获得蓝宝石', '物品')]);
  const merged = applyMemoryMerge(base, proposed);
  assert.deepEqual(merged.facts.map(item => item.描述), ['钟楼见面', '持有银钥匙']);
});

test('merge applies explicit conflict replacement and can reject a proposed addition', () => {
  const base = memory([fact('钟楼见面')]);
  const proposed = memory([fact('改在港口见面'), fact('新增信物', '物品')]);
  const baseWithKeyword = { ...base, keywords: [{ text: '旧词', weight: '低' }] };
  const proposedWithKeyword = { ...proposed, keywords: [{ text: '旧词', weight: '高' }, { text: '新词', weight: '高' }] };
  const preview = createMemoryMerge(baseWithKeyword, proposedWithKeyword).preview;
  const relatedFact = preview.conflicts.find(item => item.reason === 'related-fact');
  const merged = applyMemoryMerge(baseWithKeyword, proposedWithKeyword, { [preview.conflicts.find(item => item.kind === 'keywords').id]: 'replace', [relatedFact.id]: 'add', [preview.added.find(item => item.kind === 'keywords').id]: false });
  assert.equal(merged.keywords[0].weight, '高');
  assert.deepEqual(merged.facts.map(item => item.描述), ['钟楼见面', '新增信物', '改在港口见面']);
});

test('same fact with changed core flag or trend is an explicitly reviewable replacement', () => {
  const base = memory([{ ...fact('信任'), 核心事实: false, 趋势: '持平' }]);
  const proposed = memory([{ ...fact('信任'), 核心事实: true, 趋势: '上升' }]);
  const preview = createMemoryMerge(base, proposed).preview;
  assert.equal(preview.conflicts.length, 1);
  assert.equal(applyMemoryMerge(base, proposed).facts[0].核心事实, false);
  const merged = applyMemoryMerge(base, proposed, { [preview.conflicts[0].id]: 'replace' });
  assert.equal(merged.facts[0].核心事实, true); assert.equal(merged.facts[0].趋势, '上升');
});

test('duplicate proposal facts are not admitted twice', () => {
  const proposed = memory([fact('同一条'), fact('同一条')]);
  const preview = createMemoryMerge(memory([]), proposed).preview;
  assert.equal(preview.added.length, 1);
  assert.equal(preview.conflicts.length, 0);
});
