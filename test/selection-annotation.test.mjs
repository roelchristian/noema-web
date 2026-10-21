import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationSuggestions, selectionPopoverPlacement } from '../src/client/editor/selection-annotation.ts';

const entity = (id, name, type = 'person') => ({id, name, type});

test('annotation prioritizes matching highlighted names before other entities and result limits', () => {
  const entities = [...Array.from({length: 25}, (_, n) => entity(String(n), `A person ${n}`)), entity('exact', 'Ursula K. Le Guin'), entity('same-name', 'Ursula K. Le Guin', 'source')];
  const {exact, results} = annotationSuggestions(entities, '  URSULA   K. LE GUIN  ');
  assert.deepEqual(exact.map(item => item.id), ['exact', 'same-name']);
  assert.deepEqual(results.slice(0, 2).map(item => item.id), ['exact', 'same-name']);
  assert.deepEqual(results.map(item => item.id), ['exact', 'same-name']);
  assert.equal(entities[0].id, '0');
});

test('annotation distinguishes new selections and searches existing entities independently', () => {
  const entities = [entity('partial', 'New York City'), entity('exact', 'New York'), entity('other', 'Ursula K. Le Guin')];
  assert.deepEqual(annotationSuggestions(entities, 'An unrecognized name').exact, []);
  const {exact, results} = annotationSuggestions(entities, 'An unrecognized name', '  new york  ');
  assert.deepEqual(exact, []);
  assert.deepEqual(results.map(item => item.id), ['exact', 'partial']);
  assert.deepEqual(annotationSuggestions(entities, 'A name', 'missing').results, []);
});

function checkPlacement(selection, menu, viewport) {
  const position = selectionPopoverPlacement(selection, menu, viewport);
  const height = Math.min(menu.height, position.maxHeight);
  assert.ok(position.left >= 8);
  assert.ok(position.left + menu.width <= viewport.width - 8);
  assert.ok(position.top >= 8);
  assert.ok(position.top + height <= viewport.height - 8);
  assert.ok(position.left + menu.width <= selection.left || position.left >= selection.right || position.top + height <= selection.top || position.top >= selection.bottom, 'menu must not overlap selected text');
  return position;
}

test('annotation stays clear of selected text near either viewport edge', () => {
  const viewport = {width: 800, height: 600};
  const menu = {width: 300, height: 220};
  const top = checkPlacement({left: 200, right: 500, top: 20, bottom: 50}, menu, viewport);
  assert.equal(top.top, 58);
  const bottom = checkPlacement({left: 200, right: 500, top: 540, bottom: 570}, menu, viewport);
  assert.equal(bottom.top, 312);
});

test('growing annotation panels scroll in available space instead of clamping over selection', () => {
  const selection = {left: 20, right: 380, top: 190, bottom: 230};
  const viewport = {width: 400, height: 400};
  checkPlacement(selection, {width: 300, height: 40}, viewport);
  const expanded = checkPlacement(selection, {width: 300, height: 350}, viewport);
  assert.equal(expanded.maxHeight, 174);
  assert.equal(expanded.top, 8);
});

test('a tall selection places the annotation panel beside the text when space permits', () => {
  const menu = {width: 300, height: 350}, viewport = {width: 1200, height: 600};
  const left = checkPlacement({left: 400, right: 1000, top: 150, bottom: 500}, menu, viewport);
  assert.equal(left.left, 92);
  const right = checkPlacement({left: 100, right: 500, top: 150, bottom: 500}, menu, viewport);
  assert.equal(right.left, 508);
});

test('highlighted surname suggests an existing full-name entity before creating a duplicate', () => {
  const entities = [entity('unrelated', 'Michelle Obama'), entity('barack', 'Barack Obama'), entity('other', 'Abraham Lincoln')];
  assert.deepEqual(annotationSuggestions(entities, 'Obama').results.map(item => item.id), ['barack', 'unrelated']);
  assert.deepEqual(annotationSuggestions(entities, 'Barak').results.map(item => item.id), ['barack']);
});

test('existing aliases, recent page citations, and archived entities affect ranking', () => {
  const entities = [
    {...entity('older', 'Barack Obama'), aliases:['President Obama']},
    {...entity('recent', 'Barack Obama')},
    {...entity('archived', 'Barack Obama'), archived_at:'2026-01-01'},
  ];
  assert.deepEqual(annotationSuggestions(entities, 'Obama', '', {priorityIds:['recent']}).results.map(item=>item.id), ['recent', 'older']);
  assert.equal(annotationSuggestions(entities, 'President Obama').results[0]?.id, 'older');
});
