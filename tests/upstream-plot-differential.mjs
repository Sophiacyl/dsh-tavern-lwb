// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
// Offline test: run pinned v1 parser/executor without loading a real host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { replayNumericPlotLog } from '../core/plot-log.mjs';
import { parseStateBackup } from '../core/migration.mjs';

assert.ok(process.env.LWB_UPSTREAM_ROOT, 'Set LWB_UPSTREAM_ROOT to the public checkout');
const root = realpathSync(process.env.LWB_UPSTREAM_ROOT);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), '707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a');
assert.equal(git('status', '--porcelain'), '');
const file = name => pathToFileURL(join(root, 'modules/variables', name)).href;
const core = file('variables-core.js'), editor = file('varevent-editor.js'), commands = file('var-commands.js');
const stub = source => 'data:text/javascript,' + encodeURIComponent(source);
const host = stub(`
  let context;
  export const reset = (text, variables) => context = { chat: [{mes: text}], chatMetadata: {variables} };
  export const getContext = () => context;
  export const extension_settings = {};
  export const getLocalVariable = key => context.chatMetadata.variables[key];
  export const setLocalVariable = (key, value) => { context.chatMetadata.variables[key] = value; };
`);
const forbidden = names => stub(names.map(name => `export function ${name}() { throw new Error('unexpected host call: ${name}'); }`).join('\n'));
const redirects = new Map([
  ['../../../../../extensions.js', host], ['../../../../../variables.js', host],
  ['../../../../../../script.js', forbidden(['updateMessageBlock'])],
  ['../../core/event-manager.js', stub(`export const event_types = {}; export function createModuleEvents() { throw new Error('unexpected event registration'); }`)],
  ['../../core/debug-core.js', stub(`export const xbLog = {}; export const CacheRegistry = { register() {} };`)],
  ['../../core/after-ai-gate.js', forbidden(['initAfterAiGate', 'notifyAfterAiHint', 'registerAfterAiHandler', 'waitForAfterAiReady'])],
  ['./varevent/condition.js', forbidden(['conditionGroups', 'executeCondition', 'joinConditions', 'macroExpression', 'parseCondition'])],
  ['./state2/index.js', forbidden(['applyStateForMessage', 'createStateApi', 'rebuildStateV2', 'handleStateSwipe', 'handleStateSwipeDeleted', 'openStateChat', 'cleanupStateService'])],
  ['../../core/slash-command.js', forbidden(['executeSlashCommand'])],
]);
const modules = new Set([core, editor, commands]);
const hook = registerHooks({ resolve(specifier, context, next) {
  if (modules.has(context.parentURL) && redirects.has(specifier)) return { url: redirects.get(specifier), shortCircuit: true };
  return next(specifier, context);
} });
let upstream, synthetic;
try {
  upstream = await import(core);
  synthetic = await import(host);
} finally { hook.deregister(); }

const set = value => ({ set: { 数据: { 金币: value } } });
const bump = value => ({ bump: { 数据: { 金币: value } } });
const cases = [
  [10, [set(20), bump(3)]], [10, [bump(3), set(20)]], [10, [bump(2), bump(3)]],
  [10, [{ ...bump(1), ...set(1e20) }]], [10, [{ ...set(1e20), ...bump(1) }]],
  [10, [set(10)]], [10, [bump(0)]],
  [10, [{ set: { 数据: { 深层: { 生命: 55 } } }, bump: { 数据: { 金币: 2 } } }]],
];
const setAliases = ['记下', '記下', '记录', '記錄', '录入', '錄入', ' ReCoRd ', ' SET '];
const bumpAliases = ['推移', '变更', '變更', '调整', '調整', ' AdJuSt ', ' BUMP '];
for (const key of setAliases) cases.push([10, [{ [key]: set(20).set }]]);
for (const key of bumpAliases) cases.push([10, [{ [key]: bump(3).bump, 记下: set(20).set }]]);
cases.push(
  [10, [{ ...set(20), record: set(40).set }]],
  [10, [{ ...set(20), record: set(40).set }, { ...bump(3), adjust: bump(7).bump }]],
  [10, [{ adjust: bump(7).bump, ...bump(-2), 变更: bump(3).bump, 記下: set(20).set }]],
  [10, [{ ...bump(1e20), adjust: bump(-1e20).bump, 调整: bump(1).bump }]],
  [10, [{ ...bump(1e20), adjust: bump(1).bump, 调整: bump(-1e20).bump }]],
  [10, [{ ...bump(2), adjust: bump(3).bump }, bump(7)]],
);
for (const value of ['+2', ' -2.75 ', '.5', '2.', '-.5e1', '1E+2', '1e-300', '-0']) {
  cases.push([10, [{ ...set(20), ...bump(value), adjust: bump('0.25').bump }]]);
}
for (const value of ['0', '-0', '42', ' -2.50 ', '0.00007', '9007199254740993']) {
  cases.push([10, [{ record: set(value).set }]]);
  cases.push([10, [{ ...set(20), 記下: set(value).set }, bump('0.25')]]);
}
let seed = 0x1302c03;
const random = limit => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % limit; };
const values = [0, 1, -1, 0.1, 1e20, -1e20, 1e-200, -1e-200, 2 ** 53, 3.5];
const sample = () => values[random(values.length)];
for (let i = 0; i < 128; i++) {
  const blocks = Array.from({ length: 1 + random(16) }, () => {
    const mode = random(3);
    return mode === 0 ? set(sample()) : mode === 1 ? bump(sample()) : { ...bump(sample()), ...set(sample()) };
  });
  cases.push([sample(), blocks]);
}
for (const [index, [initial, blocks]] of cases.entries()) {
  const base = { variables: { 数据: { 金币: initial, 深层: { 生命: 50 } } }, roots: ['数据'], LWB_RULES_V2: {} };
  const text = '前' + blocks.map((block, i) => i % 2 ? `< PLOT-LOG >\r\n${JSON.stringify(block)}\r\n</ PLOT-LOG >` : `<plot-log>\n${JSON.stringify(block)}\n</plot-log>`).join('\n中\n') + '后';
  synthetic.reset(text, { 数据: JSON.stringify(base.variables.数据) });
  upstream.rulesSetTable({});
  await upstream.applyVariablesForMessage(0);
  const result = replayNumericPlotLog(base, blocks);
  const imported = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/plot-log-numeric', version: 1, baseEngine: base, source: text }));
  assert.deepEqual(imported, result, `case ${index}: raw-message import vs structured blocks`);
  const meta = synthetic.getContext().chatMetadata;
  assert.ok(meta.LWB_PLOT_APPLIED_KEY?.[0], `case ${index} did not reach upstream settlement`);
  assert.deepEqual(result.variables.数据, JSON.parse(meta.variables.数据), `case ${index}: values`);
  const locks = Object.fromEntries(Object.entries(upstream.rulesGetTable()).map(([path, rule]) => [path, { typeLock: rule.typeLock }]));
  assert.deepEqual(result.LWB_RULES_V2, locks, `case ${index}: numeric locks`);
}
const continuation = [
  [{ ...set(30), ...bump(2) }],
  [bump(7), bump(3)],
  [{ set: { 数据: { 深层: { 生命: 55 } } } }, bump(-2)],
  [bump(' .5 '), { bump: { 数据: { 深层: { 生命: -10 } } } }],
];
const sourceFor = blocks => blocks.map(block => `<plot-log>${JSON.stringify(block)}</plot-log>`).join('\n');
let chain = { variables: { 数据: { 金币: 10, 深层: { 生命: 50 } } }, roots: ['数据'], LWB_RULES_V2: {} };
synthetic.reset(sourceFor(continuation[0]), { 数据: JSON.stringify(chain.variables.数据) });
upstream.rulesSetTable({});
for (const [index, blocks] of continuation.entries()) {
  const source = sourceFor(blocks);
  const context = synthetic.getContext();
  if (index) context.chat.push({ mes: source });
  await upstream.applyVariablesForMessage(index);
  assert.ok(context.chatMetadata.LWB_PLOT_APPLIED_KEY?.[index], `message ${index} did not settle`);
  chain = parseStateBackup(JSON.stringify({ spec: 'dsh-tavern-lwb/plot-log-numeric', version: 1, baseEngine: chain, source }));
  assert.deepEqual(chain.variables.数据, JSON.parse(context.chatMetadata.variables.数据));
  assert.deepEqual(chain.LWB_RULES_V2, Object.fromEntries(Object.entries(upstream.rulesGetTable()).map(([path, rule]) => [path, { typeLock: rule.typeLock }])));
}
console.log(`plot-log numeric: ${cases.length} standalone and ${continuation.length} chained upstream executor comparisons passed`);
