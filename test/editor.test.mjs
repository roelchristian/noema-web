import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownBlocks, markdownInline } from '../src/client/editor/paste.ts';
import { segmentHTML } from '../src/client/editor/segments.tsx';
import { blockSegments } from '../src/shared/domain.ts';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';

test('Markdown paste creates distinct paragraphs and structural blocks', () => {
  const blocks = markdownBlocks('# Title\n\nFirst **bold** paragraph.\n\nSecond paragraph.\n- Item\n- [x] Done\n> Quote');
  assert.deepEqual(blocks.map(b => b.type), ['heading1', 'paragraph', 'paragraph', 'bullet', 'todo', 'quote']);
  assert.equal(blocks[4].checked, true);
  assert.ok(blocks[1].content.some(s => s.bold && s.text === 'bold'));
  assert.equal(new Set(blocks.map(b => b.id)).size, blocks.length);
});
test('Markdown tables support escaped pipes, empty cells and rectangular rows', () => {
  const [table] = markdownBlocks('| Name | Value |\n| --- | :---: |\n| A\\|B | **two** |\n| Only |');
  assert.equal(table.type, 'table');
  assert.equal(table.rows.length, 3);
  assert.ok(table.rows.every(row => row.length === 2));
  assert.equal(table.rows[1][0][0].text, 'A|B');
  assert.deepEqual(table.rows[1][1], [{bold: true, text: 'two'}]);
  assert.deepEqual(table.rows[2][1], []);
});
test('inline markup is escaped and unsafe link protocols are excluded', () => {
  const content = markdownInline('**bold _italic_** `code` [site](https://example.com) [bad](javascript:alert) <script>bad</script>');
  assert.ok(content.some(s => s.bold && s.italic));
  const html = segmentHTML(content, []);
  assert.match(html, /<strong>/); assert.match(html, /<em>/); assert.match(html, /<code>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script>/);
});
test('fenced code keeps line breaks and does not interpret formatting', () => {
  const blocks = markdownBlocks('```js\n**literal**\nnext\n```\n\nAfter');
  assert.deepEqual(blocks[0].content, [{code: true, text: '**literal**\nnext'}]);
  assert.equal(blocks[1].content[0].text, 'After');
});
test('tables and formatting survive persistence; malformed tables and cell references are rejected', () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), knowledge = new Knowledge(store), pages = new Pages(store, knowledge);
    const page = pages.create('default', {title:'Tables'});
    const blocks = markdownBlocks('| Name | Value |\n| --- | --- |\n| **Bold** | [Link](https://example.com) |');
    blocks[0].rows[1][0].push({entityId: 'ursula'});
    pages.update('default', page.id, {...page, blocks});
    assert.deepEqual(pages.get('default', page.id).blocks, blocks);
    assert.ok(blockSegments(blocks[0]).some(s => s.entityId === 'ursula'));
    const save = rows => pages.update('default', page.id, {title:page.title, blocks:[{...blocks[0], rows}]});
    for (const rows of [[], [[[]], [[], []]], [[[{entityId:'missing'}]]], Array.from({length:101},()=>[[]]), [Array.from({length:21},()=>[])]]) {
      assert.throws(() => save(rows), error => error.status === 400);
    }
    const saved = save([[[{text:'link',href:'javascript:alert(1)',bold:true}]]]);
    assert.deepEqual(saved.blocks[0].rows[0][0], [{text:'link',bold:true}]);
  } finally { db.close(); }
});

test('wrapped Markdown lines remain in one paragraph, separated paragraphs become blocks', () => {
  const blocks = markdownBlocks('One paragraph\nwrapped onto another line.\n\nAnother paragraph\n# Heading');
  assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'paragraph', 'heading1']);
  assert.equal(blocks[0].content.map(s => s.text).join(''), 'One paragraph\nwrapped onto another line.');
});
