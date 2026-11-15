// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { createStateService } from './host/service.mjs';
import { createRecordStore } from './host/records.mjs';
import { createMemoryService, SUMMARY_TASK } from './host/memory-service.mjs';
export const name = 'dsh-tavern-lwb';
export const inject = ['tavern'];

export function apply(ctx) {
  const tavern = ctx.tavern;
  const required = ['getTurn', 'getTurnState', 'readTurnData', 'saveTurnData', 'readGameData', 'saveGameData', 'turnSection', 'settlementTask', 'handle', 'manualTask', 'startTask', 'getHistory'];
  if (!(tavern?.apiVersion >= 7) || required.some(method => typeof tavern[method] !== 'function')) {
    throw new Error('小白兼容首版需要 DSH Tavern 插件 API 7 或更新版本。');
  }
  const records = createRecordStore(tavern);
  const service = createStateService(records.stateApi, { withLock: records.withLock });
  const memory = createMemoryService(tavern, records, { readStateEngine: service.readEngine });
  ctx.effect(() => async () => { const memoryDone = memory.dispose(); await service.dispose(); await records.dispose(); await memoryDone; });
  const handlers = { read: service.read, enable: service.enable, preview: service.preview,
    initialize: service.initialize, process: service.process, export: service.exportState };
  for (const [id, handler] of Object.entries(handlers)) tavern.handle(name + '/' + id, handler);
  tavern.turnSection({ name: 'state', position: 'after', text: service.prompt });
  tavern.settlementTask({ name: 'state', title: '小白状态', phase: 'after', run: service.automatic });
  const memoryHandlers = { read: memory.read, preview: memory.preview, import: memory.importMemory, export: memory.exportMemory,
    settings: memory.saveSettings, 'summary-start': memory.summaryStart, 'summary-commit': memory.commitSummary, 'summary-discard': memory.discardSummary };
  for (const [id, handler] of Object.entries(memoryHandlers)) tavern.handle(name + '/memory/' + id, handler);
  tavern.turnSection({ name: 'memory', position: 'after', text: memory.prompt });
  tavern.manualTask({ name: SUMMARY_TASK, title: '小白记忆总结', description: '请从小白记忆面板选择范围并确认模型额度；先生成候选，不覆盖记忆。', run: memory.runSummary });
}
