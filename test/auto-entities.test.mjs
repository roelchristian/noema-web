import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyEntityMentions } from '../src/shared/auto-entities.ts';
const entity = (id, name, vault_id = 'vault') => ({id, name, vault_id});
const block = content => ({id: 'paragraph', type: 'paragraph', checked: false, content});

test('removed tags stay excluded in paragraphs and tables without suppressing other occurrences', () => {
  const skipped = {text: 'Ada', skipAutoTag: true, bold: true};
  const table = {...block([]), id: 'table', type: 'table', rows: [[[skipped, {text: ' and Ada'}]]]};
  const result = identifyEntityMentions([block([skipped, {text: ' and Ada'}]), table], [entity('ada', 'Ada')], 'vault');
  assert.equal(result.count, 2);
  assert.deepEqual(result.blocks[0].content, [skipped, {text: ' and '}, {entityId: 'ada'}]);
  assert.deepEqual(result.blocks[1].rows[0][0], result.blocks[0].content);
  assert.equal(identifyEntityMentions(result.blocks, [entity('ada', 'Ada')], 'vault').count, 0);
  assert.equal(identifyEntityMentions([block([{text: 'Ad'}, {text: 'a', skipAutoTag: true}])], [entity('ada', 'Ada')], 'vault').count, 0);
});

test('automatic matching prefers longest whole names, including Unicode and punctuation', () => {
  const entities = [entity('new', 'New'), entity('city', 'New York'), entity('ann', 'Ann'), entity('jose', 'José'), entity('cpp', 'C++')];
  const {blocks, count} = identifyEntityMentions([block([{text: 'New York and Ann met José. Annual newness in C++.'}])], entities, 'vault');
  assert.equal(count, 4);
  assert.deepEqual(blocks[0].content, [{entityId: 'city'}, {text: ' and '}, {entityId: 'ann'}, {text: ' met '}, {entityId: 'jose'}, {text: '. Annual newness in '}, {entityId: 'cpp'}, {text: '.'}]);
});

test('matching spans styled text and preserves surrounding formatting', () => {
  const input = [block([{text: 'Read Ursula ', bold: true}, {text: 'Le Guin today.', italic: true}])];
  const result = identifyEntityMentions(input, [entity('ursula', 'Ursula Le Guin')], 'vault');
  assert.deepEqual(result.blocks[0].content, [{text: 'Read ', bold: true}, {entityId: 'ursula'}, {text: ' today.', italic: true}]);
  assert.equal(input[0].content[0].text, 'Read Ursula ');
});

test('ambiguous names and entities from other vaults stay plain text', () => {
  const input = [block([{text: 'Alex and Ada'}])];
  const entities = [entity('a', 'Alex'), entity('b', 'alex'), entity('ada', 'Ada', 'other')];
  const result = identifyEntityMentions(input, entities, 'vault');
  assert.equal(result.blocks, input);
  assert.equal(result.count, 0);
});

test('existing mentions, code, links, equations, and image blocks are preserved; table cells are scanned', () => {
  const entities = [entity('ada', 'Ada')];
  const protectedBlock = block([{entityId: 'ada'}, {text: 'Ada', code: true}, {text: 'Ada', math: true}, {text: 'Ada', href: 'https://example.com'}]);
  const math = {...block([{text: 'Ada'}]), id: 'math', type: 'math'};
  const image = {...block([{text: 'Ada'}]), id: 'image', type: 'image', imageId: 'picture'};
  const table = {...block([]), id: 'table', type: 'table', rows: [[[{text: 'Ada'}], [{text: 'Nothing matches'}]]]};
  const result = identifyEntityMentions([protectedBlock, math, image, table], entities, 'vault');
  assert.equal(result.count, 1);
  assert.equal(result.blocks[0], protectedBlock);
  assert.equal(result.blocks[1], math);
  assert.equal(result.blocks[2], image);
  assert.deepEqual(result.blocks[3].rows[0][0], [{entityId: 'ada'}]);
  assert.deepEqual(result.blocks[3].rows[0][1], table.rows[0][1]);
  const again = identifyEntityMentions(result.blocks, entities, 'vault');
  assert.equal(again.count, 0);
  assert.equal(again.blocks, result.blocks);
});

test('automatic matching cannot overflow the API segment limit', () => {
  const input = [block([{text: 'Ada '.repeat(600)}])];
  const result = identifyEntityMentions(input, [entity('ada', 'Ada')], 'vault');
  assert.equal(result.blocks, input);
  assert.equal(result.count, 0);
});

test('curly quotes still match canonical entity names containing straight quotes', () => {
  const entities=[entity('oconnor',"Flannery O'Connor"),entity('work','The "Book"')];
  const result=identifyEntityMentions([block([{text:'Flannery O’Connor wrote The “Book”.'}])],entities,'vault');
  assert.equal(result.count,2);
  assert.deepEqual(result.blocks[0].content,[{entityId:'oconnor'},{text:' wrote '},{entityId:'work'},{text:'.'}]);
});
