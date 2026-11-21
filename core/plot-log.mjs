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
  let engine = validateEngine(base);
  if (Object.keys(engine.LWB_RULES_V2).length) fail('旧plot-log数值子集不迁移守卫规则；请使用无约束的明确基线。');
  if (!Array.isArray(blocks) || blocks.length !== 1) fail('plot-log数值子集仅接受单个JSON块，避免消息分组语义歧义。');
  for (const block of boundedCopy(blocks)) {
    if (!plain(block) || !Object.keys(block).length || Object.keys(block).some(key => !['set', 'bump'].includes(key))) fail('仅支持严格JSON中的set/bump，拒绝push/del/guard/别名或其它指令。');
    const ops = [], seen = new Set();
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
        const identity = JSON.stringify(path);
        if (seen.has(identity)) fail('同一路径set/bump重叠与原版消息前值语义有差异，不能转换。');
        seen.add(identity);
        ops.push(kind === 'set' ? { op: 'set', path: path.join('.'), value } : { op: 'inc', path: path.join('.'), delta: value });
        if (ops.length > 128) fail('每块最多128个操作。');
      }
      walk(block[kind], []);
    }
    const result = applyText(engine, JSON.stringify({ ops }));
    if (!['success', 'noop'].includes(result.status)) fail('plot-log数值转换失败，不采用部分结果。');
    engine = result.engine;
    for (const op of ops) if (op.op === 'set') engine.LWB_RULES_V2[op.path] = { typeLock: 'number' };
    engine = validateEngine(engine);
  }
  return engine;
}
