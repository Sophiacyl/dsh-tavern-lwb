// LWB Bridge — Based on LittleWhiteBox by biex; see LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVarevent, previewStaticVarevent } from '../core/varevent.mjs';
test('static display preview selects the last eligible event and preserves surrounding text', () => {
  const text = '前<varevent>\n[event.first]\ndisplay: "旧"\n[event.last]\ndisplay: "新"\n[event.empty]\ndisplay: ""\n</varevent>后';
  const result = previewStaticVarevent(text);
  assert.equal(result.rendered, '前新后'); assert.equal(result.selections[0].eventId, 'last');
  assert.equal(result.executed, false); assert.equal(result.token, null);
});
test('static display preview trims edge LF like upstream independently per block', () => {
  const display = JSON.stringify('\n\n  第一行\n第二行  \n');
  const text = `前<varevent>\r\n[event.a]\r\ndisplay: ${display}\r\ncondition: ""\r\njs_execute: ""\r\n</varevent>中<varevent>\n[event.b]\n</varevent>后`;
  const result = previewStaticVarevent(text);
  assert.equal(result.rendered, '前  第一行\n第二行  中后');
  assert.deepEqual(result.selections.map(event => event.eventId), ['a', null]);
});
test('static display preview rejects conditions, scripts, duplicates and malformed fields', () => {
  for (const fields of [
    'condition: "false"\ndisplay: "x"', 'js_execute: "throw new Error()"', 'display: "a"\ndisplay: "b"',
    'display: "a"\n[event.a]\ndisplay: "b"', 'display: "unterminated', 'display: "a" trailing',
    'display: "a\nphysical newline"', 'display: plain text', 'js-execute: "unknown spelling"', '\fdisplay: "a"',
  ]) {
    assert.throws(() => previewStaticVarevent('<varevent>\n[event.a]\n' + fields + '\n</varevent>'), { code: 'LWB_VAREVENT_INSPECT' });
  }
});
test('event document inspection decodes fields but never evaluates or executes them', () => {
  globalThis.__LWB_INSPECT_TEST = 0;
  const source = '<varevent>\n[event.one]\ncondition: globalThis.__LWB_INSPECT_TEST++\ndisplay: "普通\\n文本"\njs_execute: "globalThis.__LWB_INSPECT_TEST=9"\n</varevent>';
  const result = inspectVarevent(source);
  assert.equal(result.groups[0].events[0].display, '普通\n文本');
  assert.equal(result.groups[0].events[0].warnings.length, 2);
  assert.equal(result.executed, false); assert.equal(result.evaluated, false);
  assert.equal(globalThis.__LWB_INSPECT_TEST, 0); delete globalThis.__LWB_INSPECT_TEST;
});
test('duplicate ids and fields are visible rather than silently treated as clean events', () => {
  const result = inspectVarevent('<varevent>\n[event.a]\ndisplay: "first"\ndisplay: "last"\n[event.a]\ndisplay: "second"\n</varevent>');
  assert.equal(result.eventCount, 2);
  assert.equal(result.groups[0].events[0].display, 'last');
  assert.ok(result.groups[0].events[0].warnings.some(text => text.includes('字段重复')));
  assert.ok(result.groups[0].events[1].warnings.some(text => text.includes('重复事件')));
});
test('multiline quote swallowing event headers is explicitly flagged for review', () => {
  const result = inspectVarevent('<varevent>\n[event.a]\ndisplay: "unterminated\n[event.b]\ndisplay: "ok"\n</varevent>');
  assert.equal(result.groups[0].sourceHeaderCount, 2);
  assert.ok(result.groups[0].parsedHeaderCount < 2);
  assert.ok(result.groups[0].warnings.some(text => text.includes('事件边界')));
  assert.equal(result.executed, false);
});
test('event inspection enforces byte, block and field limits', () => {
  for (const input of ['', '<varevent>unclosed', '<varevent></varevent><varevent>unclosed', '<varevent><varevent></varevent></varevent>', '</varevent>', '<varevent/>', 'x'.repeat(32769), '<varevent></varevent>'.repeat(17), '<varevent>\n[event.a]\ndisplay: "' + 'x'.repeat(8001) + '"\n</varevent>']) assert.throws(() => inspectVarevent(input), { code: 'LWB_VAREVENT_INSPECT' });
});
