// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Host-agnostic prototype; not registered as a Tavern write RPC.
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, ...details }); };
const hashPattern = /^[a-f0-9]{64}$/u;
const exactMaterial = (actual, step) => actual?.turn === step.turn && actual.textVersion === step.textVersion &&
  typeof actual.rawText === 'string' && digest(actual.rawText) === step.sourceDigest;

export async function executeHistoryWritePlan(plan, { readMaterial, readRow, writeRow, signal } = {}) {
  if (![readMaterial, readRow, writeRow].every(fn => typeof fn === 'function')) fail('LWB_BATCH_PLAN', '批量计划缺少读写回调。');
  if (!Array.isArray(plan) || !plan.length || plan.length > 100) fail('LWB_BATCH_PLAN', '批量计划须包含1至100步。');
  // Detach the trusted preview from later caller mutations across awaits.
  let steps;
  try { steps = structuredClone(plan); } catch { fail('LWB_BATCH_PLAN', '计划不能复制。'); }
  for (const [index, step] of steps.entries()) {
    if (!step || !Number.isSafeInteger(step.turn) || step.turn < 1 || (index && step.turn <= steps[index - 1].turn) ||
        typeof step.textVersion !== 'string' || !step.textVersion || typeof step.rawText !== 'string' ||
        !step.data || typeof step.data !== 'object' || Array.isArray(step.data) ||
        typeof step.sourceDigest !== 'string' || !hashPattern.test(step.sourceDigest) ||
        typeof step.outputDigest !== 'string' || !hashPattern.test(step.outputDigest) ||
        !(step.beforeDigest === null || (typeof step.beforeDigest === 'string' && hashPattern.test(step.beforeDigest)))) fail('LWB_BATCH_PLAN', '计划顺序、目标或摘要无效。');
    let source, output;
    try { source = digest(step.rawText); output = digest(step.data); } catch { fail('LWB_BATCH_PLAN', '计划数据不能序列化。'); }
    if (source !== step.sourceDigest || output !== step.outputDigest) fail('LWB_BATCH_PLAN', '计划内容与摘要不一致。');
  }
  let completed = 0;
  const abort = () => signal?.throwIfAborted();
  async function inspect(step) {
    abort();
    const material = await readMaterial(step.turn);
    abort();
    if (!exactMaterial(material, step)) fail('LWB_STALE', `第${step.turn}轮正文或版本已变化。`, { completed });
    const row = await readRow(step.turn);
    abort();
    if (row && (!Number.isSafeInteger(row.turn) || row.turn < 1 || row.turn > step.turn ||
        (row.turn === step.turn && row.textVersion !== step.textVersion))) fail('LWB_CONFLICT', `第${step.turn}轮回读身份不一致。`, { completed });
    const hash = row?.turn === step.turn ? digest(row.data) : null;
    if (hash === step.outputDigest) return 'done';
    if (hash === step.beforeDigest) return 'pending';
    fail('LWB_CONFLICT', `第${step.turn}轮已有不同数据。`, { completed });
  }
  // A later receipt cannot bypass an earlier missing step. No writes in preflight.
  let pending = false;
  for (const step of steps) {
    const status = await inspect(step);
    if (status === 'pending') pending = true;
    else if (pending) fail('LWB_CONFLICT', '计划回执不是连续前缀。', { completed });
    else completed++;
  }
  while (completed < steps.length) {
    // Detect edits to the confirmed prefix before extending it.
    for (const step of steps.slice(0, completed)) {
      if (await inspect(step) !== 'done') fail('LWB_CONFLICT', '已确认前缀发生变化。', { completed });
    }
    const step = steps[completed];
    if (await inspect(step) !== 'pending') fail('LWB_CONFLICT', '预检后目标数据发生变化。', { completed });
    abort();
    try {
      await writeRow(step.turn, step.textVersion, structuredClone(step.data));
    } catch {
      // Never replay an uncertain write. Confirm if possible, then stop; the
      // caller may explicitly resume the same immutable plan later.
      let confirmed = false;
      try { confirmed = await inspect(step) === 'done'; } catch { /* unknown or stale */ }
      if (confirmed) completed++;
      fail('LWB_BATCH_INTERRUPTED', '写入回执异常，已停止；须核验后显式续跑。', { completed, turn: step.turn, confirmed });
    }
    if (await inspect(step) !== 'done') fail('LWB_WRITE_UNKNOWN', `第${step.turn}轮写入后无法精确确认。`, { completed });
    completed++;
  }
  // Recheck the whole prefix, including a fully completed resumed plan.
  for (const step of steps) {
    if (await inspect(step) !== 'done') fail('LWB_CONFLICT', '最终回读前缀发生变化。', { completed });
  }
  return { completed, total: steps.length, status: 'committed' };
}
export { digest as historyPlanDigest };
