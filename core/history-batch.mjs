// LWB Bridge — testable batch history write coordinator.
// Deliberately host-agnostic: callers provide exact readers and writers.
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const exactMaterial = (actual, step) => actual?.turn === step.turn && actual.textVersion === step.textVersion && digest(actual.rawText) === step.sourceDigest;
const exactRow = (actual, step) => actual?.turn === step.turn && actual.textVersion === step.textVersion && digest(actual.data) === step.outputDigest;
export async function executeHistoryWritePlan(plan, { readMaterial, readRow, writeRow, signal } = {}) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 100) fail('LWB_BATCH_PLAN', '批量计划须包含1至100步。');
  if (![readMaterial, readRow, writeRow].every(fn => typeof fn === 'function')) fail('LWB_BATCH_PLAN', '批量计划缺少读写回调。');
  const ordered = [...plan].sort((a, b) => a.turn - b.turn);
  if (ordered.some((step, i) => !step || step.turn !== plan[i]?.turn || !Number.isSafeInteger(step.turn) || step.turn < 1 ||
      typeof step.textVersion !== 'string' || !step.textVersion || typeof step.rawText !== 'string' ||
      typeof step.data !== 'object' || !step.outputDigest || (i && step.turn <= ordered[i - 1].turn))) fail('LWB_BATCH_PLAN', '计划必须按目标轮严格递增并包含正文与输出指纹。');
  // Preflight every target before any write.
  for (const step of ordered) {
    const material = await readMaterial(step.turn);
    if (!exactMaterial(material, step)) fail('LWB_STALE', `第${step.turn}轮正文或版本已变化。`);
    const row = await readRow(step.turn);
    if (row && row.turn === step.turn && row.textVersion === step.textVersion && digest(row.data) !== step.outputDigest && step.beforeDigest !== digest(row.data)) fail('LWB_CONFLICT', `第${step.turn}轮已有不同状态。`);
  }
  let completed = 0;
  for (const step of ordered) {
    signal?.throwIfAborted();
    const existing = await readRow(step.turn);
    if (exactRow(existing, step)) { completed++; continue; }
    await writeRow(step.turn, step.textVersion, structuredClone(step.data));
    const after = await readRow(step.turn);
    if (!exactRow(after, step)) fail('LWB_WRITE_UNKNOWN', `第${step.turn}轮写入后无法精确确认。`);
    completed++;
  }
  return { completed, total: ordered.length, status: 'committed' };
}
export { digest as historyPlanDigest };
