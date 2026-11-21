// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Deliberately narrow numeric-leaf subset of the pinned v1 plot-log protocol.
import { validateEngine, applyText } from './index.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_PLOT_SUBSET' }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
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
export function replayNumericPlotLog(base, blocks) {
  const engine = validateEngine(base);
  if (Object.keys(engine.LWB_RULES_V2).length) fail('旧plot-log数值子集不迁移守卫规则；请使用无约束的明确基线。');
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 16) fail('需要同一条消息内的1至16个JSON块。');
  const leaves = new Map();
  let count = 0;
  for (const block of boundedCopy(blocks)) {
    if (!plain(block) || !Object.keys(block).length || Object.keys(block).some(key => !['set', 'bump'].includes(key))) fail('仅支持严格JSON中的set/bump，拒绝push/del/guard/别名或其它指令。');
    for (const kind of ['set', 'bump']) {
      if (!Object.hasOwn(block, kind)) continue;
      if (!plain(block[kind])) fail('set/bump必须为根名到字段对象的映射。');
      function walk(value, path) {
        if (plain(value)) {
          if (!Object.keys(value).length) fail('不接受空对象赋值。');
          for (const [key, child] of Object.entries(value)) {
            if (!/^[\p{L}\p{N}_-]+$/u.test(key) || /^\d/u.test(key) || ['__proto__', 'prototype', 'constructor', 'length'].includes(key)) fail('字段名包含指令、别名或复杂路径。');
            walk(child, [...path, key]);
          }
          return;
        }
        if (path.length < 2 || typeof value !== 'number' || !Number.isFinite(value)) fail('仅支持已有数值叶字段，不接受字符串增量、根赋值、数组或空值。');
        let current = engine.variables;
        for (const key of path) {
          if (!plain(current) || !Object.hasOwn(current, key)) fail('字段必须已存在于基线中。');
          current = current[key];
        }
        if (!engine.roots.includes(path[0]) || typeof current !== 'number' || !Number.isFinite(current)) fail('字段必须属于已托管的数值基线。');
        if (++count > 128) fail('同一条消息最多128个操作。');
        const identity = path.join('.');
        const leaf = leaves.get(identity) ?? { value: current, locked: false };
        if (kind === 'set') {
          leaf.value = value;
          leaf.locked = true;
        } else {
          // The guard reads persisted message-start state. The executor then
          // subtracts the staged value and adds the resulting delta back to it.
          const target = current + value;
          const delta = target - leaf.value;
          const next = leaf.value + delta;
          if (![target, delta, next].every(Number.isFinite)) fail('plot-log数值计算超出有限范围，不采用部分结果。');
          leaf.value = next;
        }
        leaves.set(identity, leaf);
      }
      walk(block[kind], []);
    }
  }
  const ops = [...leaves].map(([path, leaf]) => ({ op: 'set', path, value: leaf.value }));
  const result = applyText(engine, JSON.stringify({ ops }));
  if (!['success', 'noop'].includes(result.status)) fail('plot-log数值转换失败，不采用部分结果。');
  // Only upstream set installs a lock on an existing numeric leaf.
  for (const [path, leaf] of leaves) if (leaf.locked) result.engine.LWB_RULES_V2[path] = { typeLock: 'number' };
  return validateEngine(result.engine);
}
