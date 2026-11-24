// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Internal builder; callers hold the per-game lock and persist before confirming.
import { parseStateBackup } from '../core/migration.mjs';
import { historyPlanDigest as hash } from '../core/history-batch.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_BATCH_PLAN' }); };
export async function buildHistoryWritePlan({ gameId, text, targets, planId, readMaterial, readRow, now = Date.now }) {
  if (typeof gameId !== 'string' || !gameId.trim() || typeof planId !== 'string' || !planId.trim() ||
      typeof readMaterial !== 'function' || typeof readRow !== 'function' ||
      !Array.isArray(targets) || !targets.length || targets.length > 100) fail('计划身份或目标无效。');
  // Validate the full public envelope before reading any target.
  parseStateBackup(text);
  const source = JSON.parse(text);
  const wal = source.spec === 'dsh-tavern-lwb/upstream-wal';
  const swipes = source.spec === 'dsh-tavern-lwb/upstream-swipes';
  if (!wal && !swipes) fail('计划只接受显式WAL或swipe来源。');
  const floors = wal ? source.records.map((record, floor) => ({ floor, selected: 0, records: [record] })) : source.floors;
  if (floors.length !== targets.length) fail('每个来源楼须有一个目标。');
  const mapping = structuredClone(targets);
  for (const [index, target] of mapping.entries()) {
    if (!target || target.floor !== floors[index].floor || !Number.isSafeInteger(target.turn) || target.turn < 1 ||
        (index && target.turn <= mapping[index - 1].turn) || typeof target.textVersion !== 'string' || !target.textVersion ||
        floors[index].records[floors[index].selected] == null) fail('目标顺序、来源选择或正文版本无效。');
  }
  const steps = [];
  let parent = null, total = 0;
  for (const [index, target] of mapping.entries()) {
    const material = await readMaterial(target.turn);
    if (!material || material.turn !== target.turn || material.textVersion !== target.textVersion || typeof material.rawText !== 'string') fail('目标正文已变化。');
    const row = await readRow(target.turn);
    if (row && (!Number.isSafeInteger(row.turn) || row.turn < 1 || row.turn > target.turn ||
        (row.turn === target.turn && row.textVersion !== target.textVersion))) fail('回读身份无效。');
    const existing = row?.turn === target.turn ? structuredClone(row.data) : null;
    if (existing && (existing.spec !== 'dsh-tavern-lwb/record' || existing.version !== 1)) fail('仅接收现有分区记录，旧格式须先明确迁移。');
    const prefix = wal ? { ...source, records: source.records.slice(0, index + 1) } : { ...source, floors: source.floors.slice(0, index + 1) };
    const engine = parseStateBackup(JSON.stringify(prefix));
    const state = { spec: 'dsh-tavern-lwb/state', version: 1, engine, sourceKind: 'migration',
      sourceDigest: hash([planId, target.floor, floors[index].selected, floors[index].records[floors[index].selected]]),
      parent, diagnostics: { status: 'success', operationCount: 0, errors: [], corrections: [], changes: [] }, savedAt: now() };
    state.stateHash = hash([engine, state.sourceKind, state.sourceDigest, parent]);
    const data = { spec: 'dsh-tavern-lwb/record', version: 1, state, memory: existing?.memory ?? null };
    if (Buffer.byteLength(JSON.stringify(data)) > 62 * 1024 || JSON.stringify(engine.variables).length > 6800) fail('单轮计划超出记录或提示词预算。');
    const step = { turn: target.turn, textVersion: target.textVersion, rawText: material.rawText,
      sourceDigest: hash(material.rawText), beforeDigest: existing ? hash(existing) : null, data, outputDigest: hash(data) };
    total += Buffer.byteLength(JSON.stringify(step));
    if (total > 220 * 1024) fail('逐轮计划超过220KiB预算。');
    steps.push(step);
    parent = { turn: target.turn, stateHash: state.stateHash };
  }
  return steps;
}
