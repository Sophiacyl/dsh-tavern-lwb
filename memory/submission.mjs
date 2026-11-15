// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { MEMORY_LIMITS, normalizeMemoryData, exportMemoryPackage } from './core.mjs';

export const MEMORY_SUBMISSION_TOOL_NAME = 'memory_submit';

const string = (required = false) => ({ type: 'string', maxLength: MEMORY_LIMITS.stringChars, ...(required ? { minLength: 1, pattern: '\\S' } : {}) });
const array = items => ({ type: 'array', items, maxItems: MEMORY_LIMITS.items });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const named = object({ name: string(true) }, ['name']);
const moment = object({ text: string(true) }, ['text']);
const alias = object({ from: string(true), to: string(true), evidence: string() }, ['from', 'to']);
const event = object({
  id: string(), title: string(), timeLabel: string(), summary: string(),
  participants: array(string(true)), memoryRole: string(), causedBy: array(string(true)),
});
event.anyOf = ['id', 'title', 'summary'].map(key => ({ required: [key], properties: { [key]: string(true) } }));
const memory = object({
  keywords: array(object({ text: string(true), weight: string() }, ['text'])),
  events: array(event),
  characters: { anyOf: [array({ anyOf: [string(true), named] }), object({ main: array({ anyOf: [string(true), named] }) })] },
  characterAliases: array(alias),
  arcs: array(object({
    name: string(true), trajectory: string(), progress: { type: 'number', minimum: 0, maximum: 1 },
    moments: array({ anyOf: [string(true), moment] }),
  }, ['name'])),
  facts: array(object({
    人物名字: string(true), 种类: string(true), 描述: string(true), 核心事实: { type: 'boolean' }, 趋势: string(),
  }, ['人物名字', '种类', '描述'])),
}, ['facts']);
const parameters = object({ memory }, ['memory']);
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
freeze(parameters);

const messages = Object.freeze({
  memory_arguments: '工具参数必须为仅含 memory 的普通 JSON 对象。',
  memory_shape: '记忆字段的类型、必填内容或取值范围不符合工具结构。',
  memory_unknown: '记忆包含工具结构以外的字段；请移除未知字段。',
  memory_facts: '必须提供 portable facts 数组，并使用人物名字、种类、描述等公开字段。',
  memory_size: '记忆及完整导出包不得超过 48 KiB；请精简后在本任务中重新提交。',
  memory_items: '记忆数组及嵌套条目总数不得超过 200 项。',
  memory_string: '每个记忆字符串不得超过 4000 字符。',
  memory_nodes: '记忆结构节点数超过限制；请精简后重新提交。',
  memory_depth: '记忆结构深度超过限制；请按工具结构重新提交。',
  memory_value: '记忆仅接受普通、安全且无循环或共享引用的 JSON 值。',
  memory_key: '记忆包含不允许的字段。',
  already_submitted: '本任务已接受一份合法记忆，不能替换为另一份内容。',
});
const aliasHint = 'characterAliases 的每项应使用 from、to、evidence；不要使用 name 或 alias。修正后在当前任务中再次调用 memory_submit。';
function invalid(code, repairHint) { throw Object.assign(new Error(messages[code]), { code, ...(repairHint ? { repairHint } : {}) }); }

// Validate descriptors, never getters/toJSON. Unknown keys never appear in errors.
// This is intentionally limited to the JSON Schema keywords used above.
function validate(value, schema) {
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('memory_shape');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) invalid('memory_value');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (schema === alias && (Object.hasOwn(descriptors, 'name') || Object.hasOwn(descriptors, 'alias'))) invalid('memory_unknown', aliasHint);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || !Object.hasOwn(schema.properties, key)) {
        invalid('memory_unknown', schema === alias && (key === 'name' || key === 'alias') ? aliasHint : undefined);
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('memory_value');
    }
    for (const key of schema.required) if (!Object.hasOwn(descriptors, key)) invalid(schema === memory && key === 'facts' ? 'memory_facts' : 'memory_shape');
    for (const key of Object.keys(descriptors)) validate(descriptors[key].value, schema.properties[key]);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) invalid('memory_shape');
    if (value.length > schema.maxItems) invalid('memory_items');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) invalid('memory_value');
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('memory_value');
    }
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index)) invalid('memory_value');
      validate(descriptors[index].value, schema.items);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') invalid('memory_shape');
    if (value.length > schema.maxLength) invalid('memory_string');
    if (schema.minLength && !value.trim()) invalid('memory_shape');
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum) invalid('memory_shape');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') invalid('memory_shape');
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try {
        if (!option.type && option.required) {
          for (const key of option.required) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid('memory_shape');
            validate(descriptor.value, option.properties[key]);
          }
        } else validate(value, option);
        return;
      } catch { /* Try another documented representation. */ }
    }
    invalid('memory_shape');
  }
}
function errorResult(error) {
  let code, repairHint;
  try {
    code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    if (!Object.hasOwn(messages, code)) code = 'memory_value';
    if (Object.getOwnPropertyDescriptor(error, 'repairHint')?.value === aliasHint) repairHint = aliasHint;
  } catch { code = 'memory_value'; }
  return { ok: false, error: { code, message: messages[code] }, ...(repairHint ? { repairHint } : {}) };
}
const clone = value => JSON.parse(JSON.stringify(value));

export function createMemorySubmission({ checkActive = () => {}, signal = null } = {}) {
  let closed = false, submission = null, fingerprint = null;
  const ensureOpen = () => {
    if (closed) throw Object.assign(new Error('记忆提交工具已关闭。'), { code: 'submission_closed' });
    signal?.throwIfAborted();
  };
  const active = async () => { ensureOpen(); await checkActive(); ensureOpen(); };
  const tool = {
    name: MEMORY_SUBMISSION_TOOL_NAME,
    description: '提交完整 portable 记忆数据；校验失败可在当前任务内修正后重交。别名使用 from/to/evidence。仅第一份合法内容会被接受。',
    parameters,
    async execute(args) {
      await active();
      let data, serialized;
      try {
        if (args === null || typeof args !== 'object' || Array.isArray(args)) invalid('memory_arguments');
        const proto = Object.getPrototypeOf(args), keys = Reflect.ownKeys(args);
        const descriptor = Object.getOwnPropertyDescriptor(args, 'memory');
        if ((proto !== Object.prototype && proto !== null) || keys.length !== 1 || keys[0] !== 'memory' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('memory_arguments');
        validate(descriptor.value, memory);
        data = normalizeMemoryData(descriptor.value);
        exportMemoryPackage(data); // Includes the wrapper/counts/timestamp byte overhead.
        serialized = JSON.stringify(data);
        data = clone(data);
      } catch (error) {
        ensureOpen();
        return errorResult(error);
      }
      await active(); // Cancellation/close during the defensive copy cannot admit data.
      ensureOpen(); // Final synchronous signal check: no await before receipt/admission.
      if (submission !== null) return serialized === fingerprint ? { ok: true, duplicate: true } : errorResult({ code: 'already_submitted' });
      submission = data;
      fingerprint = serialized;
      return { ok: true };
    },
  };
  return {
    tool,
    getSubmission() { return submission === null ? null : clone(submission); },
    close() { closed = true; },
  };
}
