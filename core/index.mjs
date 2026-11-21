// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Based on LittleWhiteBox by biex; standalone verification adapter.
// Upstream: 707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a. See ../vendor/NOTICE-LittleWhiteBox.
import { parseStateBlock } from '../vendor/state2/parser.js';
import { parseJsonInput, validateJsonBatch, StateInputError } from '../vendor/state2/json-input.js';
import { executeStateOperations, splitPath } from '../vendor/state2/executor.js';

export const LIMITS = Object.freeze({
  textBytes: 32768, operations: 128, rules: 128, depth: 20, nodes: 4000,
  pathSegments: 24, arrayIndex: 2000, engineBytes: 48 * 1024,
  diagnosticBytes: 8192, diagnosticItems: 128,
});
const unsafe = new Set(['prototype', '__proto__', 'constructor', 'length']);
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value).length;
class BoundaryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new BoundaryError(code, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const pathPattern = /^[^.[\]\s]+(?:(?:\.[^.[\]\s]+)|(?:\[(?:[0-9]+|"[^"]+"|'[^']+')\]))*$/u;

// Descriptor-based copy never invokes accessors, toJSON or user conversion methods.
function snapshot(value, { maxNodes = LIMITS.nodes, maxDepth = LIMITS.depth } = {}) {
  let nodes = 0;
  const seen = new Set();
  function walk(item, depth) {
    if (++nodes > maxNodes) fail('node_limit', '结构节点数超过限制');
    if (depth > maxDepth) fail('depth_limit', '结构深度超过限制');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item === 0 ? 0 : item;
    if (!item || typeof item !== 'object') fail('invalid_value', '仅接受有限数字和 JSON 数据');
    if (seen.has(item)) fail('invalid_value', '不接受循环或重复引用对象');
    if (!Array.isArray(item) && !plain(item)) fail('invalid_value', '不接受复杂对象或 YAML 类型');
    seen.add(item);
    const array = Array.isArray(item);
    if (array && item.length > LIMITS.arrayIndex + 1) fail('array_limit', '数组长度超过限制');
    const out = array ? [] : {};
    const keys = Reflect.ownKeys(item);
    let count = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || unsafe.has(key)) fail('unsafe_key', '禁止使用原型链或特殊键');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) > LIMITS.arrayIndex)) fail('array_limit', '数组下标无效或超过限制');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_value', '不接受访问器或隐藏属性');
      Object.defineProperty(out, key, { value: walk(descriptor.value, depth + 1), writable: true, enumerable: true, configurable: true });
      count++;
    }
    if (array && count !== item.length) fail('sparse_array', '不接受稀疏数组');
    // Reject sharing too, so a bounded input cannot expand during later cloning.
    return out;
  }
  return walk(value, 0);
}

function checkPath(path, rule = false) {
  if (typeof path !== 'string' || !path || path !== path.trim()) fail('invalid_path', '路径必须为非空、无边缘空白的字符串');
  // Schema paths use the upstream canonical .[*] spelling.
  const syntax = rule ? path.replaceAll('.[*]', '["*"]').replaceAll('[*]', '["*"]') : path;
  if (!pathPattern.test(syntax)) fail('invalid_path', '路径格式不受支持');
  const segments = splitPath(path);
  if (!segments.length || typeof segments[0] !== 'string') fail('invalid_path', '根名称不能是数组下标');
  if (segments.length > LIMITS.pathSegments) fail('path_limit', '路径段数超过限制');
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Number.isSafeInteger(segment) || segment < 0 || segment > LIMITS.arrayIndex) fail('array_limit', '数组下标超过限制');
      continue;
    }
    if (unsafe.has(segment)) fail('unsafe_key', '禁止使用原型链或特殊键');
    if (rule && ['*', '[*]'].includes(segment)) continue;
    if (!segment.trim() || /[.\[\]\s'"\\*]/u.test(segment)) fail('invalid_path', '路径段包含不受支持字符');
  }
  if (rule && ['*', '[*]'].includes(segments[0])) fail('invalid_path', '规则必须指定根名称');
  return segments;
}

const ruleFields = new Set(['ro', 'min', 'max', 'step', 'enum', 'typeLock', 'arrayGrow', 'objectExt', 'hasWildcard', 'allowedKeys']);
function checkRule(rule) {
  if (!plain(rule) || !Object.keys(rule).length) fail('invalid_rule', '规则不能为空');
  for (const [key, value] of Object.entries(rule)) {
    if (!ruleFields.has(key)) fail('invalid_rule', '规则包含未支持的字段');
    if (['ro', 'arrayGrow', 'objectExt', 'hasWildcard'].includes(key) && typeof value !== 'boolean') fail('invalid_rule', '规则开关须为布尔值');
    if (['min', 'max', 'step'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || (key === 'step' && value < 0))) fail('invalid_rule', '规则数值无效');
    if (key === 'typeLock' && !['string', 'number', 'boolean', 'object', 'array'].includes(value)) fail('invalid_rule', '规则类型无效');
    if (['enum', 'allowedKeys'].includes(key)) {
      if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v.trim())) fail('invalid_rule', '规则列表须包含非空字符串');
      if (key === 'allowedKeys' && value.some(v => unsafe.has(v) || /[.\[\]]/.test(v))) fail('unsafe_key', '模板字段包含危险或不受支持的键');
    }
  }
  if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) fail('invalid_rule', '范围上下限无效');
}

function checkEngine(input) {
  const engine = snapshot(input);
  if (!plain(engine) || Object.keys(engine).length !== 3 || !plain(engine.variables) || !plain(engine.LWB_RULES_V2) || !Array.isArray(engine.roots)) fail('invalid_engine', '引擎须为完整快照');
  if (Object.keys(engine.LWB_RULES_V2).length > LIMITS.rules) fail('rule_limit', '规则数量超过限制');
  for (const [path, rule] of Object.entries(engine.LWB_RULES_V2)) { checkPath(path, true); checkRule(rule); }
  for (const root of Object.keys(engine.variables)) { if (checkPath(root).length !== 1) fail('invalid_engine', '变量表必须仅包含根名称'); }
  for (const root of engine.roots) { if (typeof root !== 'string' || checkPath(root).length !== 1) fail('invalid_engine', '托管根列表无效'); }
  if (new Set(engine.roots).size !== engine.roots.length) fail('invalid_engine', '托管根列表不能重复');
  if (bytes(JSON.stringify(engine)) > LIMITS.engineBytes) fail('engine_limit', '引擎快照超过 48 KiB 限制');
  return engine;
}

export function emptyEngine() { return { variables: {}, LWB_RULES_V2: {}, roots: [] }; }
// Explicit migration boundary: throws on invalid input rather than returning an empty fallback.
export function validateEngine(input) { return checkEngine(input); }

// Replay an explicitly scoped upstream WAL entry through the same bounded executor.
export function applyRecordedEntry(input, entry) {
  const original = checkEngine(input), value = snapshot(entry);
  if (!plain(value)) fail('invalid_record', 'WAL条目结构无效');
  if (value.rules === undefined) value.rules = [];
  if (value.blocks === undefined) value.blocks = [];
  if (!['text', 'call'].includes(value.kind) || !Array.isArray(value.rules) || !Array.isArray(value.ops) || !Array.isArray(value.roots) || !Array.isArray(value.blocks)) fail('invalid_record', 'WAL条目结构无效');
  if (Object.keys(value).some(key => !['kind', 'source', 'blocks', 'rules', 'ops', 'roots'].includes(key))) fail('invalid_record', 'WAL条目包含未知字段');
  if (value.source !== undefined && !['text', 'json'].includes(value.source)) fail('invalid_record', 'WAL来源无效');
  if (value.blocks.some(block => typeof block !== 'string' || !/^[0-9a-f]{16}$/u.test(block))) fail('invalid_record', 'WAL正文指纹无效');
  if (value.rules.length > LIMITS.rules || value.ops.length > LIMITS.operations) fail('operation_limit', 'WAL单条操作或规则超限');
  const claims = new Set(value.roots);
  for (const root of claims) if (checkPath(root).length !== 1) fail('invalid_record', 'WAL托管根无效');
  if (claims.size !== value.roots.length) fail('invalid_record', 'WAL托管根重复');
  for (const item of value.rules) {
    if (!plain(item) || Object.keys(item).some(key => !['path', 'rule'].includes(key))) fail('invalid_record', 'WAL规则结构无效');
    checkPath(item.path, true); checkRule(item.rule);
  }
  for (const op of value.ops) {
    if (!plain(op) || !['text', 'json'].includes(op.source) || !['set', 'inc', 'push', 'pop', 'del'].includes(op.op)) fail('invalid_record', 'WAL操作或来源无效');
    const allowed = ['path', 'op', 'source', ...(op.op === 'inc' ? ['delta'] : op.op === 'del' ? [] : ['value'])];
    if (Object.keys(op).some(key => !allowed.includes(key)) || (op.op !== 'del' && !Object.hasOwn(op, op.op === 'inc' ? 'delta' : 'value'))) fail('invalid_record', 'WAL操作字段无效');
    const root = String(checkPath(op.path)[0]);
    if (!claims.has(root) && !original.roots.includes(root)) fail('invalid_record', 'WAL操作未声明托管根，不能无损迁移');
    if (op.op === 'inc' && (typeof op.delta !== 'number' || !Number.isFinite(op.delta))) fail('invalid_delta', 'WAL增量无效');
  }
  validateJsonBatch(value.ops);
  const next = checkEngine(original), owned = new Set(next.roots);
  const result = executeStateOperations(next, value.rules, value.ops, { memory: true, report: true, ownedRoots: owned, claimRoots: claims,
    validatePayload: item => snapshot(item), boundary() {
      for (const root of Object.keys(next.variables)) if (next.variables[root] === undefined) delete next.variables[root];
      next.roots = [...owned]; checkEngine(next);
    } });
  if (result.errors.length) fail('invalid_record', 'WAL包含无法完整执行的操作，不迁移部分结果');
  for (const root of claims) owned.add(root);
  next.roots = [...owned];
  return checkEngine(next);
}

function scanBlocks(text) {
  const blocks = [];
  const pattern = /<\/?state(?=[\s/>]|$)/giu;
  let opened = null, match;
  while ((match = pattern.exec(text))) {
    const closing = text[match.index + 1] === '/';
    const end = text.indexOf('>', pattern.lastIndex);
    if (end === -1) fail('unclosed_state', 'state 块未闭合');
    const tag = text.slice(match.index, end + 1);
    if (closing) {
      if (!/^<\/state\s*>$/iu.test(tag) || opened === null) fail('invalid_state_block', 'state 块标签不匹配');
      blocks.push(text.slice(opened, match.index));
      opened = null;
    } else {
      if (opened !== null || /\/\s*>$/u.test(tag)) fail('invalid_state_block', '不支持嵌套或自闭合 state 块');
      opened = end + 1;
    }
    pattern.lastIndex = end + 1;
  }
  if (opened !== null) fail('unclosed_state', 'state 块未闭合');
  return blocks;
}

// Optional helper follows upstream's array-of-block-content shape. applyText contains all errors.
export function extractStateBlocks(text) {
  if (typeof text !== 'string') return [];
  try { if (bytes(text) > LIMITS.textBytes) return []; return scanBlocks(text); } catch { return []; }
}

function parseContents(contents) {
  const rules = [], ops = [];
  for (const content of contents) {
    if (!content.trim()) continue;
    let parsed;
    if (/^[{[]/u.test(content.trimStart())) {
      // Preserve the public JSON operation schema and conflict validator.
      parsed = { rules: [], ops: parseJsonInput(content) };
    } else { parsed = parseStateBlock(content); }
    rules.push(...parsed.rules); ops.push(...parsed.ops);
    if (rules.length > LIMITS.rules) fail('rule_limit', '本批规则数量超过限制');
    if (ops.length > LIMITS.operations) fail('operation_limit', '本批操作数量超过限制');
  }
  // Bound the whole parsed batch, including rules and paths, before execution.
  const batch = snapshot({ rules, ops });
  for (const { path, rule } of batch.rules) { checkPath(path, true); checkRule(rule); }
  for (const operation of batch.ops) {
    if (operation.warning) fail('parse_warning', '状态值解析失败，本批未执行');
    checkPath(operation.path);
    if (!['set', 'inc', 'push', 'pop', 'del'].includes(operation.op)) fail('invalid_operation', '不支持此操作');
    if (operation.op === 'inc' && (typeof operation.delta !== 'number' || !Number.isFinite(operation.delta))) fail('invalid_delta', '增量必须为有限数字');
  }
  validateJsonBatch(batch.ops);
  return batch;
}

function compactDiagnostics(result) {
  let remaining = LIMITS.diagnosticBytes;
  const shrink = value => {
    if (value === undefined) return undefined;
    const encoded = JSON.stringify(value);
    return bytes(encoded) <= 512 ? value : '（内容过长，已省略）';
  };
  const take = (items, mapper) => {
    const out = [];
    for (const item of items.slice(0, LIMITS.diagnosticItems)) {
      const value = mapper(item);
      const cost = bytes(JSON.stringify(value)) + 1;
      if (cost > remaining) break;
      out.push(value); remaining -= cost;
    }
    return out;
  };
  const trim = text => String(text ?? '').slice(0, 160);
  return {
    errors: take(result.errors, e => ({ code: e.code, index: e.index, path: trim(e.path), message: trim(e.message) })),
    corrections: take(result.corrections, c => ({ index: c.index, path: trim(c.path), requested: shrink(c.requested), value: shrink(c.value), note: trim(c.note) })),
    changes: take(result.changes, c => ({ index: c.index, path: trim(c.path), op: c.op, oldValue: shrink(c.oldValue), newValue: shrink(c.newValue), ...(c.delta === undefined ? {} : { delta: c.delta }) })),
  };
}

const knownErrors = {
  invalid_json: '状态 JSON 无法解析', invalid_input: '状态 JSON 结构无效', invalid_operation: '操作结构或名称无效',
  missing_field: '操作缺少必填字段', unexpected_field: '操作含不允许的字段', invalid_path: '路径无效或包含危险键',
  invalid_delta: '增量必须为有限数字', conflicting_operations: '同批下标删除存在冲突',
  schema_empty: 'schema 模板不能为空', schema_invalid: 'schema 模板格式无效', schema_path_required: 'schema 必须指定根路径',
  rule_invalid: '规则指令无法识别', rule_empty: '规则不能为空', yaml_invalid: 'YAML 值无法安全解析',
  unrecognized_line: '存在无法识别的状态行', inline_invalid: '显式字符串格式无效',
  invalid_value: '仅接受有限数字和 JSON 数据', rule_limit: '规则数量超过限制',
};

/** Immutable synchronous application. Fatal parsing/limit errors roll back the entire batch. */
export function applyText(input, text, options = {}) {
  let original = emptyEngine(), operationCount = 0;
  try {
    original = checkEngine(input);
    if (!plain(options)) fail('invalid_options', '选项须为普通对象');
    const optionDescriptors = Object.getOwnPropertyDescriptors(options);
    if (Reflect.ownKeys(optionDescriptors).some(key => key !== 'requireBlocks') || (optionDescriptors.requireBlocks && !Object.hasOwn(optionDescriptors.requireBlocks, 'value'))) fail('invalid_options', '选项字段无效');
    const optionValue = optionDescriptors.requireBlocks?.value;
    const requireBlocks = optionValue === undefined ? false : optionValue;
    if (typeof text !== 'string') fail('invalid_text', '状态输入必须为文本');
    if (typeof requireBlocks !== 'boolean') fail('invalid_options', 'requireBlocks 必须为布尔值');
    if (bytes(text) > LIMITS.textBytes) fail('text_limit', '输入超过 32768 UTF-8 字节限制');
    const blocks = scanBlocks(text);
    if (requireBlocks && !blocks.length) return { engine: original, status: 'noop', errors: [], corrections: [], changes: [], operationCount: 0 };
    const { rules, ops } = parseContents(blocks.length ? blocks : [text]);
    operationCount = ops.length;
    if (!rules.length && !ops.length) return { engine: original, status: 'noop', errors: [], corrections: [], changes: [], operationCount };
    const next = checkEngine(original);
    const ownedRoots = new Set(next.roots);
    const execution = executeStateOperations(next, rules, ops, {
      memory: true, report: true, ownedRoots,
      validatePayload: value => snapshot(value),
      boundary: () => {
        // Upstream represents deleted/empty roots with undefined; JSON snapshots omit them.
        for (const root of Object.keys(next.variables)) {
          if (next.variables[root] === undefined) delete next.variables[root];
        }
        next.roots = [...ownedRoots];
        checkEngine(next);
      },
    });
    next.roots = [...ownedRoots];
    const engine = checkEngine(next);
    const accepted = ops.length - execution.errors.length;
    const status = execution.errors.length ? ((accepted > 0 || rules.length) ? 'partial' : 'failed') : 'success';
    return { engine, status, ...compactDiagnostics(execution), operationCount };
  } catch (error) {
    // Even a hostile accessor/proxy exception must not throw while being reported.
    let code = 'parse_failed', message = '状态解析或执行失败，本批未执行';
    try {
      const inputCode = error instanceof StateInputError && Object.hasOwn(knownErrors, error.code) ? error.code : null;
      code = error instanceof BoundaryError ? error.code : (inputCode || (Object.hasOwn(knownErrors, error?.message) ? error.message : 'parse_failed'));
      message = knownErrors[code] || (error instanceof BoundaryError ? String(error.message).slice(0, 160) : message);
    } catch { code = 'parse_failed'; }
    return { engine: original, status: 'failed', errors: [{ code, message }], corrections: [], changes: [], operationCount };
  }
}
