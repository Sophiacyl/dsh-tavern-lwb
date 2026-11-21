// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Restricted, explicit-panel template expansion. This does not register host macros.
import { dump } from '../vendor/js-yaml.mjs';
const MAX_CHARS = 8000, MAX_DEPTH = 16, MAX_NODES = 4000;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function ownValue(object, key) {
  if (!object || typeof object !== 'object' || unsafe.has(String(key))) return { found: false };
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { found: false };
  if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('macro_value', '宏不能读取访问器或隐藏属性');
  return { found: true, value: descriptor.value };
}
function normalizeQuotedPath(path) {
  return path.replace(/\[(["'])([\p{L}\p{N}_-]+)\1\]/gu, (_match, _quote, key) => '.' + key);
}
function normalizeLegacyPath(path) {
  let output = '', index = 0;
  while (index < path.length) {
    if (path[index] !== '[') { output += path[index++]; continue; }
    const end = path.indexOf(']', index + 1);
    if (end < 0) return path;
    const inside = path.slice(index + 1, end).trim();
    if (/^(?:0|[1-9][0-9]*)$/u.test(inside)) output += '[' + inside + ']';
    else {
      const match = /^(?:"([A-Za-z0-9_\-\u3400-\u9fff]+)"|'([A-Za-z0-9_\-\u3400-\u9fff]+)'|([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\-\u3400-\u9fff]*))$/u.exec(inside);
      if (!match) fail('macro_path', '方括号键只支持非负索引或简单对象键');
      output += '.' + (match[1] || match[2] || match[3]);
    }
    index = end + 1;
  }
  return output;
}
function pathSegments(path) {
  if (!path || path.length > 1000 || path !== path.trim()) fail('macro_path', '宏路径为空或格式不受支持');
  // Dotted keys and nonnegative indices are supported; quoted keys are normalized below.
  const name = '[^.[\\]\\s\'"\\\\:{}*]+';
  if (!new RegExp(`^${name}(?:(?:\\.${name})|(?:\\[(?:0|[1-9][0-9]*)\\]))*$`, 'u').test(path)) fail('macro_path', '宏路径仅支持点号及简单数组下标');
  const segments = path.replace(/\[(\d+)\]/gu, '.$1').split('.');
  if (segments.length > MAX_DEPTH) fail('macro_depth', '宏路径超过 16 层限制');
  if (segments.some(s => unsafe.has(s))) fail('macro_path', '宏路径禁止访问原型键');
  if (segments.some(s => /^\d+$/u.test(s) && (!Number.isSafeInteger(Number(s)) || Number(s) > 2000))) fail('macro_path', '宏数组下标超过限制');
  return segments;
}
function resolve(engine, path) {
  const segments = pathSegments(path), variables = ownValue(engine, 'variables');
  if (!variables.found || !variables.value || typeof variables.value !== 'object' || Array.isArray(variables.value)) fail('macro_engine', '宏需要 engine.variables 变量快照');
  let current = variables.value;
  for (const segment of segments) {
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/u.test(segment)) return { found: false };
    const next = ownValue(current, segment);
    if (!next.found) return next;
    current = next.value;
  }
  return { found: true, value: current };
}
function jsonValue(value) {
  let nodes = 0; const seen = new Set();
  function copy(v, depth) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) fail('macro_depth', '宏值结构超过深度或节点限制');
    if (typeof v === 'string') {
      if (v.length > MAX_CHARS) fail('macro_size', '宏值超过 8000 字符限制');
      return v;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
    if (!v || typeof v !== 'object') fail('macro_value', '宏仅支持安全 JSON 值');
    if (seen.has(v)) fail('macro_value', '宏值不能含循环或共享对象引用');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (!array && proto !== Object.prototype && proto !== null) fail('macro_value', '宏不能输出复杂对象');
    if (array && v.length > 2000) fail('macro_size', '宏数组过大');
    seen.add(v);
    const out = array ? [] : {}; let entries = 0;
    for (const key of Reflect.ownKeys(v)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || unsafe.has(key)) fail('macro_value', '宏值包含不安全键');
      if (key.length > MAX_CHARS) fail('macro_size', '宏字段名过长');
      if (array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= v.length)) fail('macro_value', '宏数组属性无效');
      const own = ownValue(v, key);
      if (!own.found) fail('macro_value', '宏值不能含隐藏属性');
      out[key] = copy(own.value, depth + 1); entries++;
    }
    if (array && entries !== v.length) fail('macro_value', '宏值不能含稀疏数组');
    return out;
  }
  const result = copy(value, 0);
  if (typeof result !== 'string' && JSON.stringify(result).length > MAX_CHARS) fail('macro_size', '宏序列化内容超过 8000 字符限制');
  return result;
}
const scalar = value => dump(value, { flowLevel: 0, lineWidth: -1, quotingType: '"', noRefs: true, forceQuotes: typeof value === 'string' }).trimEnd();
// Each array item is annotated with its zero-based index. Scalar strings use
// flow-style quoting so newlines/# never swallow an index comment (upstream semantics).
function indexedYaml(value, depth = 0) {
  const indent = '  '.repeat(depth);
  if (!value || typeof value !== 'object') return `${indent}${scalar(value)}`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}[]`;
    return value.map((item, index) => {
      if (item && typeof item === 'object') return `${indent}- # [${index}]\n${indexedYaml(item, depth + 1)}`;
      return `${indent}- ${scalar(item)}  # [${index}]`;
    }).join('\n');
  }
  const entries = Object.entries(value);
  if (!entries.length) return `${indent}{}`;
  return entries.map(([key, item]) => item && typeof item === 'object'
    ? `${indent}${scalar(key)}:\n${indexedYaml(item, depth + 1)}`
    : `${indent}${scalar(key)}: ${scalar(item)}`).join('\n');
}
// Scan outermost pairs once: never expand a macro nested in an unknown macro,
// and never scan inserted values again. This is a template reader, not a runtime.
function* templateMacros(template) {
  let cursor = 0;
  while (cursor < template.length) {
    const start = template.indexOf('{{', cursor);
    if (start < 0) return;
    let end = start + 2, depth = 1;
    while (end < template.length && depth) {
      if (template.startsWith('{{', end)) { depth++; end += 2; }
      else if (template.startsWith('}}', end)) { depth--; end += 2; }
      else end++;
    }
    yield { original: template.slice(start, end), expression: template.slice(start + 2, depth ? end : end - 2), index: start, incomplete: depth !== 0 };
    cursor = end;
  }
}
export function expandLwbMacros(template, engine) {
  if (typeof template !== 'string') fail('macro_template', '宏模板必须为字符串');
  if (template.length > MAX_CHARS) fail('macro_size', '宏模板输入超过 8000 字符限制');
  const diagnostics = []; let length = 0, previous = 0; const chunks = [];
  for (const match of templateMacros(template)) {
    const { original, expression } = match, separator = expression.indexOf('::');
    const name = (separator < 0 ? expression : expression.slice(0, separator)).trim().toLowerCase();
    let replacement = original;
    if (match.incomplete || expression.includes('{{')) {
      diagnostics.push({ code: 'macro_syntax', message: '嵌套或未闭合的宏已整体保留', offset: match.index });
    } else if (!['xbgetvar', 'xbgetvar_yaml', 'xbgetvar_yaml_idx'].includes(name)) {
      diagnostics.push({ code: 'macro_unknown', message: `未支持的宏已保留：${name}`, offset: match.index });
    } else {
      try {
        let path = separator < 0 ? '' : expression.slice(separator + 2).trim();
        if (path.includes('::')) fail('macro_path', '宏路径格式不受支持');
        path = normalizeLegacyPath(path);
        const resolved = resolve(engine, path);
        if (!resolved.found || resolved.value === undefined) {
          replacement = '';
          diagnostics.push({ code: 'macro_missing', message: `宏路径不存在：${path}`, offset: match.index });
        } else {
          const value = jsonValue(resolved.value);
          // Compatible scalar behavior: strings stay raw, not JSON-quoted or HTML-
          // escaped. Hosts must treat the expanded text as text, never HTML/code.
          if (value === null) replacement = '';
          else if (typeof value !== 'object') replacement = String(value);
          else if (name === 'xbgetvar') replacement = JSON.stringify(value);
          else if (name === 'xbgetvar_yaml_idx') replacement = indexedYaml(value);
          else replacement = dump(value, { indent: 2, lineWidth: -1, noRefs: true, quotingType: '"' }).trimEnd();
        }
      } catch (error) {
        if (error.code === 'macro_size') throw error;
        diagnostics.push({ code: error.code || 'macro_value', message: error.message || '宏无法展开，已保留', offset: match.index });
      }
    }
    const prefix = template.slice(previous, match.index);
    length += prefix.length + replacement.length;
    if (length > MAX_CHARS) fail('macro_size', '宏模板输出超过 8000 字符限制');
    chunks.push(prefix, replacement); previous = match.index + original.length;
  }
  const suffix = template.slice(previous);
  if (length + suffix.length > MAX_CHARS) fail('macro_size', '宏模板输出超过 8000 字符限制');
  chunks.push(suffix);
  return { text: chunks.join(''), diagnostics };
}
