// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { validateEngine, emptyEngine, applyText } from './index.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_MIGRATION' }); };
export function parseStateBackup(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 64 * 1024) fail('状态备份必须为不超过64 KiB的JSON文本。');
  let raw; try { raw = JSON.parse(text); } catch { fail('状态备份JSON格式错误。'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('状态备份须为JSON对象。');
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
  } else fail('仅接受Bridge导出包或显式上游当前快照封装；不接受整个聊天metadata、WAL、检查点或脚本。');
  const engine = validateEngine(candidate);
  if (!engine.roots.length || !Object.keys(engine.variables).length) fail('状态备份没有可恢复的变量。');
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
