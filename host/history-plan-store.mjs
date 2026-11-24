// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Internal plan persistence; not registered as a public RPC.
import { randomUUID } from 'node:crypto';
import { historyPlanDigest as hash } from '../core/history-batch.mjs';
const SPEC = 'dsh-tavern-lwb/history-plan';
const KEY = 'historyWritePlan';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_BATCH_PLAN' }); };
const MAX_BYTES = 256 * 1024;
const TTL = 15 * 60 * 1000;
export function createHistoryPlanStore({ readGameData, saveGameData, withLock, now = Date.now }) {
  if (![readGameData, saveGameData, withLock, now].every(fn => typeof fn === 'function')) fail('计划存储缺少依赖。');
  const game = gameId => {
    if (typeof gameId !== 'string' || !gameId.trim() || gameId.length > 1024) fail('计划游戏标识无效。');
  };
  async function config(gameId) {
    const value = await readGameData({ gameId });
    if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) fail('游戏设置格式无效。');
    return value ?? {};
  }
  function validate(plan, gameId, token) {
    if (!plan || plan.spec !== SPEC || plan.version !== 1 || plan.gameId !== gameId || plan.token !== token ||
        !Number.isSafeInteger(plan.turn) || plan.turn < 1 || typeof plan.textVersion !== 'string' || !plan.textVersion ||
        !Number.isSafeInteger(plan.createdAt) || !Number.isSafeInteger(plan.expiresAt) || plan.expiresAt - plan.createdAt !== TTL ||
        plan.createdAt > now() || plan.expiresAt <= now() || !Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 100 ||
        hash(plan.steps) !== plan.stepsHash || Buffer.byteLength(JSON.stringify(plan)) > MAX_BYTES) fail('计划缺失、过期或内容校验失败。');
    return structuredClone(plan);
  }
  return {
    async save({ gameId, turn, textVersion, steps }) {
      game(gameId);
      // Detach before entering the async lock; callers cannot mutate the saved plan.
      const copy = structuredClone(steps);
      const createdAt = now(), token = randomUUID();
      const plan = { spec: SPEC, version: 1, gameId, token, turn, textVersion, createdAt, expiresAt: createdAt + TTL,
        steps: copy, stepsHash: hash(copy) };
      validate(plan, gameId, token);
      return withLock(gameId, async () => {
        const current = await config(gameId);
        if (current[KEY]) fail('已有批量计划，请先审阅或明确清除，避免覆盖未完成回填。');
        const next = { ...current, [KEY]: plan };
        if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES) fail('计划和游戏设置合计超过256 KiB。');
        await saveGameData({ gameId, data: next });
        return { token, turn, textVersion, expiresAt: plan.expiresAt, steps: copy.length };
      });
    },
    async load({ gameId, token, turn, textVersion }) {
      game(gameId);
      if (typeof token !== 'string' || !token) fail('计划令牌无效。');
      return withLock(gameId, async () => {
        const plan = validate((await config(gameId))[KEY], gameId, token);
        if (plan.turn !== turn || plan.textVersion !== textVersion) fail('当前轮次或正文版本与计划不符。');
        return plan;
      });
    },
    async clear({ gameId, token }) {
      game(gameId);
      if (typeof token !== 'string' || !token) fail('清除计划须明确令牌。');
      return withLock(gameId, async () => {
        const current = await config(gameId);
        if (!current[KEY]) return { cleared: false };
        if (current[KEY].token !== token || current[KEY].gameId !== gameId) fail('计划已被替换，拒绝清除。');
        const next = { ...current }; delete next[KEY];
        await saveGameData({ gameId, data: next });
        return { cleared: true };
      });
    },
  };
}
