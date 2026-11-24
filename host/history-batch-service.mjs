// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Internal host service; not yet registered with the plugin RPC router.
import { randomUUID } from 'node:crypto';
import { buildHistoryWritePlan } from './history-plan-builder.mjs';
import { createHistoryPlanStore } from './history-plan-store.mjs';
import { executeHistoryWritePlan } from '../core/history-batch.mjs';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export function createHistoryBatchService(tavern, records, { now = Date.now } = {}) {
  let disposed = false;
  const live = () => { if (disposed) fail('LWB_UNLOADED', '批量服务已停止。'); };
  // Every public operation owns records.withLock. Store calls run inside that
  // lock, so do not recursively acquire the non-reentrant queue.
  async function readLive(method, args) {
    live();
    const result = await tavern[method](args);
    live(); return result;
  }
  const plans = createHistoryPlanStore({ readGameData: args => readLive('readGameData', args),
    saveGameData: async args => { live(); await tavern.saveGameData(args); live(); },
    withLock: (_id, work) => work(), now });
  async function current(gameId, expectedTextVersion, turn) {
    live();
    const state = await tavern.getTurnState({ gameId }); live();
    if (!state || state.busy || !state.settled) fail('LWB_BUSY', '请等待正文和结算完成。');
    if (!Number.isSafeInteger(state.turn) || state.turn < 1 || typeof expectedTextVersion !== 'string' ||
        state.textVersion !== expectedTextVersion || (turn !== undefined && state.turn !== turn)) fail('LWB_STALE', '当前轮次或版本已变化。');
    if ((await tavern.readGameData({ gameId }))?.enabled !== true) fail('LWB_DISABLED', '请先启用本局状态。');
    live(); return state;
  }
  return {
    prepare({ gameId, expectedTextVersion, text, targets } = {}) {
      return records.withLock(gameId, async () => {
        const state = await current(gameId, expectedTextVersion);
        const steps = await buildHistoryWritePlan({ gameId, text, targets, planId: randomUUID(), now,
          readMaterial: turn => readLive('getTurn', { gameId, turn }), readRow: turn => readLive('readTurnData', { gameId, turn }) });
        if (steps.some(step => step.turn > state.turn)) fail('LWB_BATCH_PLAN', '目标不能晚于当前轮。');
        await current(gameId, expectedTextVersion, state.turn);
        const saved = await plans.save({ gameId, turn: state.turn, textVersion: state.textVersion, steps });
        return { ...saved, targets: steps.map(step => ({ turn: step.turn, textVersion: step.textVersion,
          replacesExisting: step.beforeDigest !== null, outputDigest: step.outputDigest })), writable: true };
      });
    },
    commit({ gameId, expectedTextVersion, token, confirmReplace, signal } = {}) {
      return records.withLock(gameId, async () => {
        if (confirmReplace !== true) fail('LWB_BATCH_PLAN', '需要明确确认逐轮回填，失败时已写前缀会保留。');
        const state = await current(gameId, expectedTextVersion);
        const plan = await plans.load({ gameId, token, turn: state.turn, textVersion: state.textVersion });
        const guard = () => current(gameId, expectedTextVersion, state.turn);
        const result = await executeHistoryWritePlan(plan.steps, { signal,
          readMaterial: async turn => { await guard(); return readLive('getTurn', { gameId, turn }); },
          readRow: async turn => { await guard(); return readLive('readTurnData', { gameId, turn }); },
          writeRow: async (turn, textVersion, data) => {
            await guard();
            await records.stateApi.saveTurnData({ gameId, turn, textVersion, data: data.state });
          },
        });
        // Keep the plan on execution or cleanup failure: retries revalidate the
        // exact confirmed prefix, rather than blindly replaying writes.
        await plans.clear({ gameId, token });
        return result;
      });
    },
    inspect({ gameId } = {}) {
      return records.withLock(gameId, () => { live(); return plans.inspect({ gameId }); });
    },
    discard({ gameId, token } = {}) {
      return records.withLock(gameId, () => { live(); return plans.clear({ gameId, token }); });
    },
    dispose() { disposed = true; },
  };
}
