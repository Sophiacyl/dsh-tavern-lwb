// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { validateEngine, emptyEngine, applyText, applyRecordedEntry } from './index.mjs';
import { replayNumericPlotLog, parseNumericPlotLogSource } from './plot-log.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_MIGRATION' }); };
const plotInputs = ['source', 'blocks'];
function replayPlotMessage(engine, input, envelope = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !plotInputs.includes(key) && !(envelope && ['spec', 'version', 'baseEngine'].includes(key)))) fail('数值plot-log消息仅接受source或blocks。');
  const hasSource = Object.hasOwn(input, 'source');
  if (hasSource === Object.hasOwn(input, 'blocks')) fail('数值plot-log消息须明确提供source或blocks之一。');
  return replayNumericPlotLog(engine, hasSource ? parseNumericPlotLogSource(input.source) : input.blocks);
}
export function parseStateBackup(text, { onDiagnostics, onSelection } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 64 * 1024) fail('状态备份必须为不超过64 KiB的JSON文本。');
  let raw; try { raw = JSON.parse(text); } catch { fail('状态备份JSON格式错误。'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('状态备份须为JSON对象。');
  const branchMap = [];
  if (raw.spec === 'dsh-tavern-lwb/legacy-state-log' && raw.version === 1) {
    const log = raw.log;
    if (!log || log.version !== 1 || !log.floors || typeof log.floors !== 'object' || Array.isArray(log.floors)) fail('旧State2日志须为version:1及floors映射。');
    const floors = Object.keys(log.floors);
    if (floors.length > 100 || floors.some(key => !/^(0|[1-9][0-9]*)$/u.test(key) || !Number.isSafeInteger(Number(key)))) fail('旧日志楼层须为最多100个规范非负整数。');
    let initialRecord = null;
    if (!Object.hasOwn(log.floors, '0')) {
      const checkpoint = raw.initialCheckpoint;
      const point = checkpoint?.points?.['0'];
      if (checkpoint?.version !== 1 || !point || !point.vars || typeof point.vars !== 'object' || Array.isArray(point.vars) || !point.rules || typeof point.rules !== 'object' || Array.isArray(point.rules)) fail('缺第0楼时须显式提供旧version:1检查点points[0]，不能猜测初值。');
      const rules = Object.entries(point.rules).filter(([, rule]) => rule && typeof rule === 'object' && !Array.isArray(rule) && Object.keys(rule).length).map(([path, rule]) => ({ path, rule }));
      if (rules.length !== Object.keys(point.rules).length || !rules.length) fail('初始检查点规则必须为非空有效声明。');
      const roots = [...new Set(rules.map(item => item.path.split(/[.\[]/u)[0]))];
      const selected = Object.create(null);
      for (const root of roots) {
        if (!Object.hasOwn(point.vars, root) || typeof point.vars[root] !== 'string' || !point.vars[root].trim()) fail('检查点受管根初值缺失或为空，不能无损恢复。');
        Object.defineProperty(selected, root, { value: point.vars[root], enumerable: true });
      }
      const decoded = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/upstream-snapshot', version: 1, variables: selected, roots, LWB_RULES_V2: point.rules }));
      initialRecord = { v: 1, entries: [
        { kind: 'call', source: 'text', blocks: [], roots, rules: [], ops: roots.map(root => ({ op: 'set', path: root, value: decoded.variables[root], source: 'text' })) },
        { kind: 'call', source: 'text', blocks: [], roots, rules, ops: [] }
      ] };
      branchMap.push({ floor: 0, selected: 0, source: 'explicit-legacy-checkpoint' });
    }
    const records = floors.sort((a, b) => Number(a) - Number(b)).map(floor => {
      const old = log.floors[floor];
      if (!old || typeof old.signature !== 'string' || !Array.isArray(old.rules) || !Array.isArray(old.ops)) fail('旧日志缺少signature/rules/ops。');
      const ops = old.ops.map(op => ({ ...op, source: 'text' }));
      const rules = old.rules.filter(item => {
        if (!item || typeof item.path !== 'string' || !item.path.trim() || !item.rule || typeof item.rule !== 'object' || Array.isArray(item.rule)) fail('旧日志规则结构无效。');
        return Object.keys(item.rule).length > 0;
      });
      const roots = Array.isArray(old.roots) ? [...new Set(old.roots.map(root => {
        if (root !== null && typeof root === 'object') fail('旧日志根名不接受复杂对象。');
        return String(root);
      }).filter(Boolean))] : [...new Set([...old.rules, ...ops].map(item => {
        if (!item || typeof item.path !== 'string') fail('旧日志路径无效。');
        return item.path.split(/[.\[]/u)[0];
      }))];
      branchMap.push({ floor: Number(floor), selected: 0 });
      return { v: 1, entries: [{ kind: 'text', blocks: [], rules, ops, roots }] };
    });
    if (initialRecord) {
      if (records.length >= 100) fail('检查点加旧日志总楼层超过100。');
      records.unshift(initialRecord);
    }
    raw = { spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records };
  }
  if (raw.spec === 'dsh-tavern-lwb/upstream-swipes' && raw.version === 1) {
    if (!Array.isArray(raw.floors) || !raw.floors.length || raw.floors.length > 100) fail('分支迁移需要1至100个明确排序的楼层。');
    const records = []; let previous = -1, candidates = 0;
    for (const row of raw.floors) {
      if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['floor', 'selected', 'records'].includes(key)) || !Number.isSafeInteger(row.floor) || row.floor < 0 || row.floor <= previous) fail('楼层必须为递增非负整数，不能重复或自动重排。');
      if (!Array.isArray(row.records) || !row.records.length || (candidates += row.records.length) > 200 || !Number.isSafeInteger(row.selected) || row.selected < 0 || row.selected >= row.records.length || !Object.hasOwn(row.records, row.selected)) fail('每层须明确选择存在的候选，不能回退到其它候选。');
      previous = row.floor;
      const record = row.records[row.selected];
      if (record === null) fail('选中候选缺少状态记录，不能推断为无变化；请明确提供空entries。');
      records.push(record);
      branchMap.push({ floor: row.floor, selected: row.selected });
    }
    raw = { spec: 'dsh-tavern-lwb/upstream-wal', version: 1, records };
  }
  let candidate;
  if (raw.spec === 'dsh-tavern-lwb/export' && raw.version === 1 && raw.engine) {
    if (raw.warning) fail('备份带有失效警告，不能自动恢复；请先核查来源。');
    candidate = raw.engine;
  } else if (raw.spec === 'dsh-tavern-lwb/upstream-snapshot' && raw.version === 1) {
    // Explicit user-selected roots only: never import the entire native variable table.
    if (!raw.variables || typeof raw.variables !== 'object' || Array.isArray(raw.variables) || !Array.isArray(raw.roots)) fail('上游快照需要variables字符串表、roots托管根和LWB_RULES_V2规则。');
    const variables = Object.create(null);
    for (const root of raw.roots) {
      if (typeof root !== 'string' || ['__proto__', 'constructor', 'prototype', 'length'].includes(root) || !Object.hasOwn(raw.variables, root)) fail('上游托管根无效或缺少值。');
      const value = raw.variables[root];
      if (typeof value !== 'string') fail('上游variables根值须为字符串，不能混用已解码快照。');
      let decoded = value;
      const trimmed = value.trim();
      if (trimmed && Number.isFinite(Number(trimmed))) decoded = Number(trimmed);
      else if (/^(?:true|false)$/u.test(trimmed) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { decoded = JSON.parse(trimmed); } catch { fail('上游根值JSON无法解码。'); }
      }
      if (!trimmed) fail('上游空根在原版表示未定义，无法无损迁移；请明确整理为有效初值。');
      variables[root] = decoded;
    }
    if (!raw.LWB_RULES_V2 || typeof raw.LWB_RULES_V2 !== 'object' || Array.isArray(raw.LWB_RULES_V2)) fail('上游快照缺少明确规则表；不从值推断约束。');
    candidate = { variables, roots: raw.roots, LWB_RULES_V2: raw.LWB_RULES_V2 };
  } else if (raw.spec === 'dsh-tavern-lwb/plot-log-numeric' && raw.version === 1) {
    candidate = replayPlotMessage(raw.baseEngine, raw, true);
  } else if (raw.spec === 'dsh-tavern-lwb/plot-log-numeric-log' && raw.version === 1) {
    if (!Array.isArray(raw.messages) || !raw.messages.length || raw.messages.length > 100 ||
        Object.keys(raw).some(key => !['spec', 'version', 'baseEngine', 'messages'].includes(key))) fail('数值plot-log消息链须包含1至100条显式顺序消息。');
    candidate = raw.messages.reduce((engine, message) => replayPlotMessage(engine, message), validateEngine(raw.baseEngine));
  } else if (raw.spec === 'dsh-tavern-lwb/upstream-wal' && raw.version === 1) {
    if (!Array.isArray(raw.records) || !raw.records.length || raw.records.length > 100) fail('WAL必须为1至100条按楼层排序的消息记录。');
    let engine = emptyEngine(), entries = 0;
    for (const record of raw.records) {
      if (record === null) continue;
      if (!record || record.v !== 1 || !Array.isArray(record.entries) || Object.keys(record).some(key => !['v', 'entries'].includes(key))) fail('WAL消息记录格式无效。');
      for (const entry of record.entries) {
        if (++entries > 128) fail('WAL回放最多128个entry。');
        engine = applyRecordedEntry(engine, entry, { onDiagnostics: diagnostics => {
          if (onDiagnostics) onDiagnostics({ entry: entries, ...diagnostics });
        } });
      }
    }
    const owned = new Set(engine.roots);
    for (const root of Object.keys(engine.variables)) if (!owned.has(root)) delete engine.variables[root];
    for (const path of Object.keys(engine.LWB_RULES_V2)) if (!owned.has(path.split(/[.\[]/u)[0])) delete engine.LWB_RULES_V2[path];
    candidate = engine;
  } else fail('仅接受受支持的Bridge备份、显式快照或日志封装；不接受整个聊天metadata、独立检查点或脚本。');
  const engine = validateEngine(candidate);
  if (!engine.roots.length || !Object.keys(engine.variables).length) fail('状态备份没有可恢复的变量。');
  if (branchMap.length && onSelection) onSelection(branchMap);
  return engine;
}
export function replayStateHistory(initialText, materials) {
  if (!Array.isArray(materials) || materials.length > 100) fail('历史回放每次最多100轮。');
  let result = applyText(emptyEngine(), initialText);
  if (result.status !== 'success' || !result.engine.roots.length) fail('历史回放需要有效初始化文本。');
  let engine = result.engine, total = 0; const report = [];
  for (const material of materials) {
    const text = material.rawText;
    if (typeof text !== 'string' || (total += Buffer.byteLength(text)) > 256 * 1024) fail('历史原文缺失或总量超过256 KiB。');
    if (/<\/?(?:plot-log|varevent)\b/iu.test(text)) fail('第' + material.turn + '轮包含plot-log或varevent旧协议，不能作为State2无损回放。');
    result = applyText(engine, text, { requireBlocks: true });
    if (!['success', 'noop'].includes(result.status)) fail('第' + material.turn + '轮不能完整回放：' + (result.errors[0]?.message || result.status));
    engine = result.engine;
    report.push({ turn: material.turn, textVersion: material.textVersion, status: result.status, operations: result.operationCount });
  }
  return { engine: validateEngine(engine), report };
}
