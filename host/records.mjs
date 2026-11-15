// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Versioned record adapter. Reads alpha.1 state rows; writes separate state/memory fields.
const SPEC = 'dsh-tavern-lwb/record';
const STATE = 'dsh-tavern-lwb/state';
const MAX_BYTES = 62 * 1024;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export function createRecordStore(tavern) {
  const queues = new Map();
  let stopped = false;
  const live = () => { if (stopped) fail('LWB_UNLOADED', '插件已停止，请刷新页面。'); };
  function withLock(gameId, work) {
    live();
    if (typeof gameId !== 'string' || !gameId.trim() || gameId.length > 1024) fail('LWB_GAME', '请先打开一局游戏。');
    const previous = queues.get(gameId) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => { live(); return work(); });
    queues.set(gameId, next);
    void next.finally(() => { if (queues.get(gameId) === next) queues.delete(gameId); }).catch(() => {});
    return next;
  }
  function unwrap(data) {
    if (data?.spec === STATE && data.version === 1) return { state: data, memory: null };
    if (data?.spec === SPEC && data.version === 1 && ('state' in data || 'memory' in data)) return data;
    fail('LWB_RECORD', '插件记录版本不兼容，请保留数据并检查版本。');
  }
  async function at(gameId, turn, field) {
    for (let steps = 0; turn >= 1; steps++) {
      if (steps >= 2000) fail('LWB_RECORD_LIMIT', '插件历史记录超出读取上限。');
      const row = await tavern.readTurnData({ gameId, turn }); live();
      if (!row) return null;
      if (!Number.isSafeInteger(row.turn) || row.turn < 1 || row.turn > turn) fail('LWB_RECORD', '宿主返回的记录轮次无效。');
      const value = unwrap(row.data)[field];
      if (value) return { turn: row.turn, textVersion: row.textVersion, data: structuredClone(value) };
      turn = row.turn - 1;
    }
    return null;
  }
  async function write({ gameId, turn, textVersion, data }, field) {
    live();
    const row = await tavern.readTurnData({ gameId, turn }); live();
    const current = row?.turn === turn && row.textVersion === textVersion ? unwrap(row.data) : {};
    const envelope = { spec: SPEC, version: 1, state: current.state ?? null, memory: current.memory ?? null, [field]: structuredClone(data) };
    if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_BYTES) fail('LWB_COMBINED_SIZE', '本轮状态与记忆合计超过 62 KiB，请减少内容后重试。');
    live();
    return tavern.saveTurnData({ gameId, turn, textVersion, data: envelope });
  }
  // Preserve the tracked Cordis service as receiver for every actual Tavern call.
  const stateApi = new Proxy({}, { get(_target, name) {
    if (name === 'readTurnData') return ({ gameId, turn }) => at(gameId, turn, 'state');
    if (name === 'saveTurnData') return input => write(input, 'state');
    if (typeof tavern[name] === 'function') return (...args) => tavern[name](...args);
    return tavern[name];
  } });
  return { withLock, stateApi, stateAt: (id, turn) => at(id, turn, 'state'), memoryAt: (id, turn) => at(id, turn, 'memory'),
    saveMemory: input => write(input, 'memory'), live,
    dispose() { stopped = true; return Promise.allSettled([...queues.values()]).then(() => undefined); } };
}
