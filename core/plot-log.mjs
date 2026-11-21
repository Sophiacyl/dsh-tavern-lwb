// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Deliberately narrow numeric-leaf subset of the pinned v1 plot-log protocol.
import { validateEngine, applyText } from './index.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_PLOT_SUBSET' }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
// Fixed top-level operation names from upstream varevent-editor.js OP_ALIASES.
const opNames = new Map(Object.entries({
  set: ['set', '记下', '記下', '记录', '記錄', '录入', '錄入', 'record'],
  bump: ['bump', '推移', '变更', '變更', '调整', '調整', 'adjust'],
}).flatMap(([kind, names]) => names.map(name => [name, kind])));
function boundedCopy(input) {
  const seen = new Set(); let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 4000 || depth > 20) fail('plot-log结构超过深度或节点预算。');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (!value || typeof value !== 'object' || (!Array.isArray(value) && !plain(value)) || seen.has(value)) fail('plot-log只接受无循环的普通JSON结构。');
    seen.add(value);
    if (Array.isArray(value) && (value.length > 128 || Object.keys(value).length !== value.length ||
        Array.from({ length: value.length }, (_, i) => !Object.hasOwn(value, i)).some(Boolean))) fail('plot-log数组超限或包含空洞。');
    if (typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length > 4000) fail('plot-log对象字段超限。');
    const out = Array.isArray(value) ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !d?.enumerable || !Object.hasOwn(d, 'value') || ['__proto__', 'constructor', 'prototype', 'length'].includes(key)) fail('plot-log字段包含访问器或危险键。');
      out[key] = visit(d.value, depth + 1);
    }
    return out;
  }
  return visit(input, 0);
}
// Explicit single-message import only. This does not scan live Tavern history.
export function parseNumericPlotLogSource(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 32 * 1024) fail('plot-log原文须为不超过32 KiB的单条消息。');
  // Also detect tag lookalikes: upstream's opening pattern accepts this prefix.
  const tags = /<\s*(\/?)\s*plot-log/giu;
  const blocks = [];
  let start = null;
  for (const tag of source.matchAll(tags)) {
    const boundary = tag.index + tag[0].length;
    const suffix = /^\s*>/u.exec(source.slice(boundary));
    if (!suffix) fail('plot-log原文仅接受不带属性的完整开关标签。');
    if (!tag[1]) {
      if (start !== null) fail('plot-log原文不接受嵌套块。');
      start = boundary + suffix[0].length;
      continue;
    }
    if (start === null) fail('plot-log原文存在未配对的结束标签。');
    if (blocks.length === 16) fail('同一消息最多16个plot-log块。');
    let block;
    try { block = JSON.parse(source.slice(start, tag.index)); }
    catch { fail('plot-log块必须为严格JSON，不回放部分消息。'); }
    blocks.push(block);
    start = null;
  }
  if (start !== null || !blocks.length) fail('需要1至16个闭合plot-log块。');
  return blocks;
}
export function replayNumericPlotLog(base, blocks) {
  const engine = validateEngine(base);
  // Only exact numeric leaves can carry this subset of v1 guards.
  for (const [path, rule] of Object.entries(engine.LWB_RULES_V2)) {
    const keys = path.split('.');
    let leaf = engine.variables;
    for (const key of keys) {
      if (!/^[\p{L}\p{N}_-]+$/u.test(key) || /^\d/u.test(key) || !plain(leaf) || !Object.hasOwn(leaf, key)) {
        leaf = undefined; break;
      }
      leaf = leaf[key];
    }
    if (Object.keys(rule).some(key => !['typeLock', 'min', 'max', 'step'].includes(key)) ||
        (Object.hasOwn(rule, 'typeLock') && rule.typeLock !== 'number') || keys.length < 2 ||
        !engine.roots.includes(keys[0]) || typeof leaf !== 'number') fail('旧plot-log基线仅支持已有托管数值叶的number类型锁、min/max与step。');
  }
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 16) fail('需要同一条消息内的1至16个JSON块。');
  const leaves = new Map();
  let count = 0;
  for (const block of boundedCopy(blocks)) {
    if (!plain(block) || !Object.keys(block).length) fail('需要非空JSON操作对象。');
    const groups = new Map();
    for (const [key, value] of Object.entries(block)) {
      const kind = opNames.get(key.toLowerCase().trim());
      if (!kind) fail('仅支持set/bump及其固定操作名别名。');
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(value);
    }
    for (const kind of ['set', 'bump']) {
      if (!groups.has(kind)) continue;
      const combined = new Map();
      function walk(value, path) {
        if (plain(value)) {
          if (!Object.keys(value).length) fail('不接受空对象赋值。');
          for (const [key, child] of Object.entries(value)) {
            if (!/^[\p{L}\p{N}_-]+$/u.test(key) || /^\d/u.test(key) || ['__proto__', 'prototype', 'constructor', 'length'].includes(key)) fail('字段名包含指令、别名或复杂路径。');
            walk(child, [...path, key]);
          }
          return;
        }
        // Upstream coerces bump payloads through Number. Accept only explicit
        // decimal notation here, not empty strings, radix prefixes or aliases.
        if (kind === 'bump' && typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim())) value = Number(value);
        // parseValueForSet also requires valid JSON, excluding leading zeros.
        if (kind === 'set' && typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value.trim())) value = JSON.parse(value.trim());
        if (path.length < 2 || typeof value !== 'number' || !Number.isFinite(value)) fail('仅支持已有数值叶及相应的有限数值字符串，不接受根赋值、数组或空值。');
        let current = engine.variables;
        for (const key of path) {
          if (!plain(current) || !Object.hasOwn(current, key)) fail('字段必须已存在于基线中。');
          current = current[key];
        }
        if (!engine.roots.includes(path[0]) || typeof current !== 'number' || !Number.isFinite(current)) fail('字段必须属于已托管的数值基线。');
        if (++count > 128) fail('同一条消息最多128个操作。');
        const identity = path.join('.');
        const merged = kind === 'set' ? value : (combined.get(identity)?.value ?? 0) + value;
        if (!Number.isFinite(merged)) fail('plot-log同块增量合计超出有限范围，不采用部分结果。');
        combined.set(identity, { current, value: merged });
      }
      for (const group of groups.get(kind)) {
        if (!plain(group)) fail('set/bump必须为根名到字段对象的映射。');
        walk(group, []);
      }
      // Upstream putSet overwrites and putBump sums before emitting a group.
      for (const [identity, { current, value }] of combined) {
        const leaf = leaves.get(identity) ?? { value: current, locked: false };
        const { min, max, step } = engine.LWB_RULES_V2[identity] ?? {};
        const clampStep = n => step === undefined ? n : Math.min(step, Math.max(-step, n));
        let target = kind === 'set' && step === undefined ? value
          : current + clampStep(kind === 'set' ? value - current : value);
        if (!Number.isFinite(target)) fail('plot-log数值计算超出有限范围，不采用部分结果。');
        if (min !== undefined) target = Math.max(target, min);
        if (max !== undefined) target = Math.min(target, max);
        if (kind === 'set') {
          leaf.value = target;
          leaf.locked = true;
        } else {
          // The guard reads persisted message-start state. The executor then
          // subtracts the staged value and adds the resulting delta back to it.
          const delta = target - leaf.value;
          const next = leaf.value + delta;
          if (![target, delta, next].every(Number.isFinite)) fail('plot-log数值计算超出有限范围，不采用部分结果。');
          leaf.value = next;
        }
        leaves.set(identity, leaf);
      }
    }
  }
  const ops = [...leaves].map(([path, leaf]) => ({ op: 'set', path, value: leaf.value }));
  // Values already passed v1's guards; State2 must not apply them again.
  const result = applyText({ ...engine, LWB_RULES_V2: {} }, JSON.stringify({ ops }));
  if (!['success', 'noop'].includes(result.status)) fail('plot-log数值转换失败，不采用部分结果。');
  // Only upstream set installs a lock on an existing numeric leaf.
  result.engine.LWB_RULES_V2 = engine.LWB_RULES_V2;
  for (const [path, leaf] of leaves) if (leaf.locked) result.engine.LWB_RULES_V2[path] = { ...engine.LWB_RULES_V2[path], typeLock: 'number' };
  return validateEngine(result.engine);
}
