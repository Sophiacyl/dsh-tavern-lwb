// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Original, host-independent portable-memory boundary. No storage or template execution.
export const MEMORY_LIMITS = Object.freeze({ packageBytes: 48 * 1024, items: 200, stringChars: 4000, promptChars: 3000 });
const PACKAGE_TYPE = 'LittleWhiteBoxStorySummaryMemory';
const MAX_DEPTH = 16, MAX_NODES = 4000;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const metadata = new Set(['_addedAt', 'sourceFloor', 'sourceFloors', 'sourceMesId', 'sourceMesIds', 'sourceInvalidFromFloor', 'sourceRollbackFromFloor', 'lastSummarizedMesId', 'pendingImportBoundary', 'summaryHistory', 'undo', 'undoHistory', 'rollback', 'vectors', 'vector', 'embedding', 'embeddings', 'stateAtoms', 'l0Index', 'l1Index', 'l2Index']);
const bytes = text => new TextEncoder().encode(text).length;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Copy descriptors before serialization: accessors/toJSON never run. Shared references
// are rejected as well as cycles so later JSON serialization cannot amplify them.
function safeCopy(value) {
  const seen = new Set(); let nodes = 0, size = 0;
  function account(text) {
    size += bytes(text);
    if (size > MEMORY_LIMITS.packageBytes) fail('memory_size', '记忆数据超过 48 KiB 限制');
  }
  function visit(v, depth) {
    if (++nodes > MAX_NODES) fail('memory_nodes', '记忆结构节点数超过限制');
    if (depth > MAX_DEPTH) fail('memory_depth', '记忆结构深度超过限制');
    if (typeof v === 'string') {
      if (v.length > MEMORY_LIMITS.stringChars) fail('memory_string', '记忆字段超过 4000 字符限制');
      account(JSON.stringify(v)); return v;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) { account(JSON.stringify(v)); return v; }
    if (!v || typeof v !== 'object') fail('memory_value', '记忆仅接受安全 JSON 值');
    if (seen.has(v)) fail('memory_value', '记忆不能含循环或共享对象引用');
    const arr = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (!arr && proto !== Object.prototype && proto !== null) fail('memory_value', '记忆仅接受普通 JSON 对象');
    if (arr && v.length > MEMORY_LIMITS.items) fail('memory_items', '记忆数组超过 200 项限制');
    seen.add(v); account(arr ? '[]' : '{}');
    const out = arr ? [] : {}; let entries = 0;
    for (const key of Reflect.ownKeys(v)) {
      if (arr && key === 'length') continue;
      if (typeof key !== 'string' || unsafe.has(key)) fail('memory_key', '记忆包含不安全的原型键');
      if (key.length > MEMORY_LIMITS.stringChars) fail('memory_string', '记忆字段名过长');
      if (arr && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) fail('memory_value', '记忆数组包含额外属性');
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('memory_value', '记忆不能含访问器或隐藏属性');
      if (entries) account(',');
      if (!arr) account(`${JSON.stringify(key)}:`);
      out[key] = visit(d.value, depth + 1); entries++;
    }
    if (arr && entries !== v.length) fail('memory_value', '记忆不能含稀疏数组');
    return out;
  }
  const out = visit(value, 0);
  if (bytes(JSON.stringify(out)) > MEMORY_LIMITS.packageBytes) fail('memory_size', '记忆数据超过 48 KiB 限制');
  return out;
}
function readJson(text) {
  if (typeof text !== 'string') fail('memory_json', '请输入完整 JSON 记忆对象');
  if (bytes(text) > MEMORY_LIMITS.packageBytes) fail('memory_size', '记忆包超过 48 KiB 限制');
  if (!text.trim()) fail('memory_json', '请输入完整 JSON 记忆对象');
  let raw;
  try { raw = JSON.parse(text); } catch { fail('memory_json', 'JSON 格式错误：必须为单一完整对象'); }
  return safeCopy(raw);
}
function fields(item, allowed, path, warnings, extraRemoved = []) {
  if (!object(item)) fail('memory_shape', `${path} 必须为对象`);
  for (const key of Object.keys(item)) {
    if (allowed.includes(key)) continue;
    if (metadata.has(key) || extraRemoved.includes(key)) { warnings.push(`已移除宿主字段 ${path}.${key}`); continue; }
    fail('memory_unknown', `${path} 包含未知字段：${key}`);
  }
}
function str(v, path, required = false) {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && !v.trim())) fail('memory_shape', `${path} 必须为${required ? '非空' : ''}字符串`);
  return v.trim();
}
function list(v, path) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail('memory_shape', `${path} 必须为数组`);
  return v;
}
function normalize(input, warnings) {
  fields(input, ['keywords', 'events', 'characters', 'characterAliases', 'arcs', 'facts'], 'data', warnings);
  if (!Object.hasOwn(input, 'facts') || !Array.isArray(input.facts)) fail('memory_facts', '必须提供 portable facts 数组，不能导入内部记忆');
  const out = emptyMemory();
  out.keywords = list(input.keywords, 'keywords').map((v, i) => {
    const p = `keywords[${i}]`; fields(v, ['text', 'weight'], p, warnings);
    return { text: str(v.text, `${p}.text`, true), weight: str(v.weight, `${p}.weight`) };
  });
  out.events = list(input.events, 'events').map((v, i) => {
    const p = `events[${i}]`; fields(v, ['id', 'title', 'timeLabel', 'summary', 'participants', 'memoryRole', 'causedBy'], p, warnings);
    const summary = str(v.summary, `${p}.summary`);
    const portableSummary = summary.replace(/\s*\(#\d+(?:-\d+)?\)\s*$/u, '').trim();
    if (summary !== portableSummary) warnings.push(`已移除楼层源标记 ${p}.summary`);
    const result = { id: str(v.id, `${p}.id`), title: str(v.title, `${p}.title`), timeLabel: str(v.timeLabel, `${p}.timeLabel`), summary: portableSummary, participants: list(v.participants, `${p}.participants`).map(n => str(n, `${p}.participants`, true)), memoryRole: str(v.memoryRole, `${p}.memoryRole`), causedBy: list(v.causedBy, `${p}.causedBy`).map(n => str(n, `${p}.causedBy`, true)) };
    if (!result.id && !result.title && !result.summary) fail('memory_shape', `${p} 不能为空事件`);
    return result;
  });
  let main = [];
  if (Array.isArray(input.characters)) main = input.characters;
  else if (input.characters !== undefined) {
    fields(input.characters, ['main'], 'characters', warnings); main = list(input.characters.main, 'characters.main');
  }
  out.characters.main = main.map((v, i) => {
    const p = `characters.main[${i}]`;
    if (typeof v === 'string') return { name: str(v, p, true) };
    fields(v, ['name'], p, warnings); return { name: str(v.name, `${p}.name`, true) };
  });
  out.characterAliases = list(input.characterAliases, 'characterAliases').map((v, i) => {
    const p = `characterAliases[${i}]`; fields(v, ['from', 'to', 'evidence'], p, warnings);
    return { from: str(v.from, `${p}.from`, true), to: str(v.to, `${p}.to`, true), evidence: str(v.evidence, `${p}.evidence`) };
  });
  out.arcs = list(input.arcs, 'arcs').map((v, i) => {
    const p = `arcs[${i}]`; fields(v, ['name', 'trajectory', 'progress', 'moments'], p, warnings);
    const progress = v.progress === undefined ? 0 : v.progress;
    if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) fail('memory_shape', `${p}.progress 必须为 0 到 1 的数字`);
    return { name: str(v.name, `${p}.name`, true), trajectory: str(v.trajectory, `${p}.trajectory`), progress, moments: list(v.moments, `${p}.moments`).map((m, j) => {
      if (typeof m === 'string') return { text: str(m, `${p}.moments[${j}]`, true) };
      fields(m, ['text'], `${p}.moments[${j}]`, warnings); return { text: str(m.text, `${p}.moments[${j}].text`, true) };
    }) };
  });
  out.facts = input.facts.map((v, i) => {
    const p = `facts[${i}]`;
    if (object(v) && ['s', 'p', 'o', '_isState', 'isState', 'trend'].some(k => Object.hasOwn(v, k))) fail('memory_facts', `${p} 是内部事实；请使用 人物名字/种类/描述/核心事实/趋势`);
    fields(v, ['人物名字', '种类', '描述', '核心事实', '趋势'], p, warnings, ['id']);
    const result = { 人物名字: str(v.人物名字, `${p}.人物名字`, true), 种类: str(v.种类, `${p}.种类`, true), 描述: str(v.描述, `${p}.描述`, true) };
    if (v.核心事实 !== undefined) {
      if (typeof v.核心事实 !== 'boolean') fail('memory_shape', `${p}.核心事实 必须为布尔值`);
      result.核心事实 = v.核心事实;
    }
    if (v.趋势 !== undefined) result.趋势 = str(v.趋势, `${p}.趋势`);
    return result;
  });
  const items = Object.values(counts(out)).reduce((a, b) => a + b, 0)
    + out.events.reduce((n, e) => n + e.participants.length + e.causedBy.length, 0)
    + out.arcs.reduce((n, a) => n + a.moments.length, 0);
  if (items > MEMORY_LIMITS.items) fail('memory_items', '记忆及嵌套条目总数超过 200 项限制');
  if (bytes(JSON.stringify(out)) > MEMORY_LIMITS.packageBytes) fail('memory_size', '规范记忆超过 48 KiB 限制');
  return out;
}
function counts(d) { return { keywords: d.keywords.length, events: d.events.length, characters: d.characters.main.length, aliases: d.characterAliases.length, arcs: d.arcs.length, facts: d.facts.length }; }
export function emptyMemory() { return { keywords: [], events: [], characters: { main: [] }, characterAliases: [], arcs: [], facts: [] }; }
// Takes portable DATA, not the package wrapper. Unknown fields fail closed.
export function normalizeMemoryData(data) { return normalize(safeCopy(data), []); }
function packageData(raw, warnings) {
  fields(raw, ['type', 'version', 'data', 'counts', 'exportedAt'], 'package', warnings);
  if (raw.type !== PACKAGE_TYPE || raw.version !== 1) fail('memory_package', '不支持的记忆包类型或版本（需要 LittleWhiteBoxStorySummaryMemory/version 1）');
  if (raw.exportedAt !== undefined) str(raw.exportedAt, 'package.exportedAt');
  const data = normalize(raw.data, warnings), actual = counts(data);
  if (raw.counts !== undefined) {
    fields(raw.counts, Object.keys(actual), 'package.counts', warnings);
    for (const key of Object.keys(raw.counts)) {
      if (metadata.has(key)) continue;
      if (!Number.isSafeInteger(raw.counts[key]) || raw.counts[key] < 0) fail('memory_shape', '记忆包 counts 必须为非负整数');
    }
    if (JSON.stringify(actual) !== JSON.stringify(Object.fromEntries(Object.keys(actual).map(k => [k, raw.counts[k]])))) warnings.push('记忆包 counts 与内容不一致，已按内容重算');
  }
  return data;
}
export function parseMemoryPackage(text) {
  const warnings = [], data = packageData(readJson(text), warnings);
  return { data, counts: counts(data), warnings };
}
export function exportMemoryPackage(data) {
  const normalized = normalizeMemoryData(data);
  const result = { type: PACKAGE_TYPE, version: 1, data: normalized, counts: counts(normalized), exportedAt: new Date().toISOString() };
  if (bytes(JSON.stringify(result)) > MEMORY_LIMITS.packageBytes) fail('memory_size', '导出的记忆包超过 48 KiB 限制');
  return result;
}
// Model contract: return portable DATA. A complete v1 export package is also
// accepted explicitly; arbitrary {data: ...}/{json: ...} wrappers are rejected.
export function parseSummaryResponse(text) {
  if (typeof text !== 'string' || bytes(text) > MEMORY_LIMITS.packageBytes) fail('memory_size', '总结响应必须为不超过 48 KiB 的 JSON 文本');
  const source = text.trim(), fence = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(source);
  const raw = readJson(fence ? fence[1] : source);
  return object(raw) && Object.hasOwn(raw, 'type') ? packageData(raw, []) : normalize(raw, []);
}
export function memoryPrompt(data, { query = '', maxChars = MEMORY_LIMITS.promptChars } = {}) {
  const d = normalizeMemoryData(data);
  if (typeof query !== 'string' || query.length > MEMORY_LIMITS.stringChars) fail('memory_query', '查询词必须为不超过 4000 字符的字符串');
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) fail('memory_prompt', '提示词字符上限必须为非负整数');
  const budget = Math.min(maxChars, MEMORY_LIMITS.promptChars);
  const terms = [...new Set(query.toLowerCase().split(/[\s,，。；;、!?！？]+/u).filter(Boolean))];
  const rows = [];
  function add(kind, value, payload, core = false) {
    const text = `${kind}：${JSON.stringify(value)}`;
    const hit = terms.length && terms.some(term => text.toLowerCase().includes(term));
    rows.push({ text, payload, priority: core ? 0 : hit ? 1 : kind === '事件' ? 2 : 3, index: rows.length });
  }
  for (const f of d.facts) add('事实', f, f.描述, f.核心事实 === true);
  for (const e of d.events) add('事件', e, e.summary || JSON.stringify(e));
  for (const a of d.arcs) add('轨迹', a, a.trajectory || JSON.stringify(a));
  for (const a of d.characterAliases) add('别名', a, JSON.stringify(a));
  for (const k of d.keywords) add('关键词', k, JSON.stringify(k));
  for (const c of d.characters.main) add('人物', c, JSON.stringify(c));
  rows.sort((a, b) => a.priority - b.priority || a.index - b.index);
  const seen = new Set(), result = []; let length = 0;
  for (const row of rows) {
    if (seen.has(row.payload)) continue;
    const cost = row.text.length + (result.length ? 1 : 0);
    if (length + cost > budget) continue;
    seen.add(row.payload); result.push(row.text); length += cost;
  }
  return result.join('\n');
}
