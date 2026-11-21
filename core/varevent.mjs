// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
import { findVareventBlocks, parseEventBlock } from '../vendor/varevent-document.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'LWB_VAREVENT_INSPECT' }); };
export function previewStaticVarevent(text) {
  const inspected = inspectVarevent(text);
  const blocks = findVareventBlocks(text);
  const selections = inspected.groups.map((group, index) => {
    const unsupported = () => fail('静态预览只接受明确事件标题、单行JSON字符串字段及空条件/脚本；其他格式请用只读检查。');
    // Do not let the permissive document parser hide malformed or unknown fields.
    for (const line of blocks[index].inner.split(/\r?\n/u)) {
      if (!line.trim() || /^\s*\[\s*event\.[^\]]+\]\s*$/iu.test(line)) continue;
      const field = /^[ \t]*(display|condition|js_execute)[ \t]*:[ \t]*(.*?)[ \t]*$/iu.exec(line);
      if (!field) unsupported();
      let value;
      try { value = JSON.parse(field[2]); } catch { unsupported(); }
      if (typeof value !== 'string') unsupported();
    }
    if (group.warnings.length || group.events.some(event => !event.id || event.condition.trim() || event.js_execute.trim() || event.warnings.length)) unsupported();
    const selected = [...group.events].reverse().find(event => event.display.trim());
    return { start: group.start, end: group.end, eventId: selected?.id || null, display: (selected?.display ?? '').replace(/^\n+|\n+$/gu, '') };
  });
  let rendered = '', cursor = 0;
  for (const selection of selections) { rendered += text.slice(cursor, selection.start) + selection.display; cursor = selection.end; }
  rendered += text.slice(cursor);
  return { mode: 'static-display-preview', rendered, selections, executed: false, token: null,
    message: '仅返回静态文本预览，不保存、不注入提示词、不执行条件或脚本。' };
}
export function inspectVarevent(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 32768) fail('事件检查文本须不超过32 KiB。');
  let opened = false, closed = 0;
  const tags = /<\s*(\/?)\s*varevent(?=[\s/>]|$)[^>]*>/giu;
  for (const match of text.matchAll(tags)) {
    if (match[1]) {
      if (!opened || !/^<\s*\/\s*varevent\s*>$/iu.test(match[0])) fail('事件标签未配对或格式不支持。');
      opened = false; closed++;
    } else {
      if (opened || /\/\s*>$/u.test(match[0])) fail('不接受嵌套或自闭合事件块。');
      opened = true;
    }
  }
  if (opened) fail('存在未闭合事件块，不返回部分检查结果。');
  const blocks = findVareventBlocks(text);
  if (blocks.length !== closed) fail('事件块未能完整解析。');
  if (!blocks.length || blocks.length > 16) fail('需要1至16个闭合varevent块。');
  let total = 0;
  const groups = blocks.map(block => {
    const parsed = parseEventBlock(block.inner), seen = new Set();
    const events = parsed.events.map(event => {
      if (++total > 128) fail('事件总数超过128。');
      const { id = '', condition = '', display = '', js = '' } = event.values;
      if ([id, condition, display, js].some(value => typeof value !== 'string' || value.length > 8000)) fail('事件字段过长或格式无效。');
      const warnings = [];
      if (!id) warnings.push('事件缺少id');
      if (seen.has(id)) warnings.push('同块重复事件id'); seen.add(id);
      if (Object.values(event.fields).some(fields => fields.length > 1)) warnings.push('字段重复，上游采用最后声明');
      if (condition.trim()) warnings.push('条件含可执行表达式，本插件未求值');
      if (js.trim()) warnings.push('js_execute含脚本，本插件未执行');
      return { id, condition, display, js_execute: js, warnings, executable: false };
    });
    const headers = [...block.inner.matchAll(/^\s*\[\s*event\.([^\]]+)\]\s*$/gimu)].length;
    const parsedHeaders = events.filter(event => event.id).length;
    const warnings = headers !== parsedHeaders
      ? ['原文事件标题数与解析结果不同，可能是字段引号或多行内容影响事件边界；请人工核对。'] : [];
    return { start: block.start, end: block.end, sourceHeaderCount: headers, parsedHeaderCount: parsedHeaders, warnings, events };
  });
  return { mode: 'inspect-only', eventCount: total, groups, evaluated: false, executed: false,
    message: '仅使用上游宽松文档解析语义展示结构，不是JS或字段引号完整性验证；不注册触发器、不替换提示词、不执行condition或js_execute。' };
}
