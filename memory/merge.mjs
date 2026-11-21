// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { normalizeMemoryData, exportMemoryPackage } from './core.mjs';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value);
const keyOf = (kind, value) => {
  switch (kind) {
    case 'keywords': return value.text.trim().toLocaleLowerCase();
    case 'events': return value.id ? 'id:' + value.id : [value.title, value.timeLabel].map(x => x.trim().toLocaleLowerCase()).join('|');
    case 'characters.main': return value.name.trim().toLocaleLowerCase();
    case 'characterAliases': return value.from.trim().toLocaleLowerCase();
    case 'arcs': return value.name.trim().toLocaleLowerCase();
    case 'facts': return [value.人物名字, value.种类, value.描述].map(x => x.trim().toLocaleLowerCase()).join('|');
    default: throw new Error('未知记忆集合');
  }
};
const entriesOf = (data, kind) => kind === 'characters.main' ? data.characters.main : data[kind];
const KINDS = ['keywords', 'events', 'characters.main', 'characterAliases', 'arcs', 'facts'];

export function createMemoryMerge(baseValue, proposedValue) {
  const base = normalizeMemoryData(baseValue), proposed = normalizeMemoryData(proposedValue);
  const operations = [], conflicts = [], retained = [];
  let id = 0;
  for (const kind of KINDS) {
    const oldEntries = entriesOf(base, kind), newEntries = entriesOf(proposed, kind);
    const oldByKey = new Map(oldEntries.map(value => [keyOf(kind, value), value]));
    const seenNew = new Set();
    for (const value of newEntries) {
      const key = keyOf(kind, value);
      if (kind === 'facts') {
        const related = oldEntries.filter(old => old.人物名字 === value.人物名字 && old.种类 === value.种类);
        if (seenNew.has(key)) continue;
        const existing = oldByKey.get(key);
        if (existing) {
          seenNew.add(key);
          if (stable(existing) === stable(value)) retained.push({ kind, key, value: clone(existing) });
          else conflicts.push({ id: 'c' + (++id), kind, key, reason: 'changed-existing', old: clone(existing), next: clone(value) });
          continue;
        }
        seenNew.add(key);
        const item = { id: 'n' + (++id), kind, key, action: 'add', old: null, next: clone(value), selected: related.length === 0 };
        if (related.length) conflicts.push({ id: 'c' + (++id), kind, key, reason: 'related-fact', old: related.map(clone), next: clone(value), additionId: item.id });
        operations.push(item);
        continue;
      }
      if (seenNew.has(key)) { conflicts.push({ id: 'c' + (++id), kind, key, reason: 'duplicate-proposal', old: null, next: clone(value) }); continue; }
      seenNew.add(key);
      const old = oldByKey.get(key);
      if (!old) operations.push({ id: 'n' + (++id), kind, key, action: 'add', old: null, next: clone(value), selected: true });
      else if (stable(old) === stable(value)) retained.push({ kind, key, value: clone(old) });
      else conflicts.push({ id: 'c' + (++id), kind, key, reason: 'changed-existing', old: clone(old), next: clone(value) });
    }
    for (const old of oldEntries) {
      if (!seenNew.has(keyOf(kind, old))) retained.push({ kind, key: keyOf(kind, old), value: clone(old) });
    }
  }
  const preview = { added: operations, conflicts, retained, counts: exportMemoryPackage(base).counts };
  return { base, proposed, preview };
}

export function applyMemoryMerge(baseValue, proposedValue, choices = {}) {
  const plan = createMemoryMerge(baseValue, proposedValue);
  const result = clone(plan.base);
  const gatedFacts = new Set(plan.preview.conflicts.filter(item => item.reason === 'related-fact').map(item => item.additionId));
  for (const item of plan.preview.added) {
    if (gatedFacts.has(item.id)) continue;
    if (choices[item.id] !== false) entriesOf(result, item.kind).push(clone(item.next));
  }
  for (const conflict of plan.preview.conflicts) {
    const choice = choices[conflict.id] || 'keep';
    if (conflict.reason === 'related-fact' && conflict.additionId) {
      if (choice === 'add') {
        const addition = plan.preview.added.find(item => item.id === conflict.additionId);
        if (addition) entriesOf(result, 'facts').push(clone(addition.next));
      }
    } else if (choice === 'replace' && conflict.old) {
      const entries = entriesOf(result, conflict.kind), index = entries.findIndex(value => keyOf(conflict.kind, value) === conflict.key);
      if (index >= 0) entries[index] = clone(conflict.next);
    }
  }
  const data = normalizeMemoryData(result);
  exportMemoryPackage(data);
  return data;
}
