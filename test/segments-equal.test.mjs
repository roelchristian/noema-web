import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentsEqual } from '../src/shared/segments-equal.ts';

test('catalog refresh keeps selected DOM intact when DOM reads reorder formatting keys', () => {
  const stored = [{text: 'Zyrus', bold: true, italic: true}];
  const fromDOM = [{bold: true, italic: true, text: 'Zyrus'}];
  assert.notEqual(JSON.stringify(stored), JSON.stringify(fromDOM));
  assert.equal(segmentsEqual(fromDOM, stored), true);
});

test('adjacent equivalent text segments and empty segments do not force a DOM rebuild', () => {
  assert.equal(segmentsEqual([{text: 'Jake ', bold: true}, {text: 'Zyrus', bold: true}, {text: ''}], [{bold: true, text: 'Jake Zyrus'}]), true);
  assert.equal(segmentsEqual([{text: 'Zyrus', bold: false}], [{text: 'Zyrus'}]), true);
});

test('real edits, formatting, entities, alias labels, and exclusions still require updates', () => {
  for (const [left, right] of [
    [[{text: 'Zyrus'}], [{text: 'Jake Zyrus'}]],
    [[{text: 'Zyrus', bold: true}], [{text: 'Zyrus'}]],
    [[{text: 'Zyrus', skipAutoTag: true}], [{text: 'Zyrus'}]],
    [[{text: 'Zyrus', code: true}], [{text: 'Zyrus'}]],
    [[{text: 'Zyrus', math: true}], [{text: 'Zyrus'}]],
    [[{text: '', math: true}], []],
    [[{text: 'x', math: true}, {text: 'y', math: true}], [{text: 'xy', math: true}]],
    [[{text: 'Zyrus', href: 'https://example.com'}], [{text: 'Zyrus'}]],
    [[{entityId: 'jake', mentionText: 'Zyrus'}], [{text: 'Zyrus'}]],
    [[{entityId: 'jake', mentionText: 'Zyrus'}], [{entityId: 'other', mentionText: 'Zyrus'}]],
    [[{entityId: 'jake', mentionText: 'Zyrus'}], [{entityId: 'jake'}]],
    [[{text: 'Jake ', bold: true}, {text: 'Zyrus'}], [{text: 'Jake Zyrus', bold: true}]],
  ]) assert.equal(segmentsEqual(left, right), false);
});
