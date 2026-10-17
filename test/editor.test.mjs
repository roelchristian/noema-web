import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownBlocks, markdownInline } from '../src/client/editor/paste.ts';
import { segmentHTML } from '../src/client/editor/segments.tsx';
import { blockSegments } from '../src/shared/domain.ts';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';

test('removed entity tag exclusions survive saving and reopening, including table cells', () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), pages = new Pages(store, new Knowledge(store));
    const page = pages.create('default', {title: 'Removed tags'});
    const content = [{text: 'Ursula Le Guin', skipAutoTag: true, italic: true}];
    const blocks = [
      {id: 'paragraph', type: 'paragraph', checked: false, content},
      {id: 'table', type: 'table', checked: false, content: [], rows: [[content]]},
    ];
    pages.update('default', page.id, {...page, blocks});
    assert.deepEqual(pages.get('default', page.id).blocks, blocks);
    const html = segmentHTML(content, []);
    assert.match(html, /data-skip-auto-tag="true"/);
    assert.match(html, /<em>Ursula Le Guin<\/em>/);
    assert.doesNotMatch(html, /data-entity=/);
  } finally { db.close(); }
});

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

test('inline math preserves LaTeX commands and code and currency stay literal', () => {
  const content = markdownInline(String.raw`Area $\pi r^2$ and $x_1 + x_2$; \$5 and \$10; code \`$literal$\`.`.replaceAll('\\`', '`'));
  assert.deepEqual(content.filter(segment => segment.math).map(segment => segment.text), [String.raw`\pi r^2`, 'x_1 + x_2']);
  assert.ok(content.some(segment => segment.code && segment.text === '$literal$'));
  assert.ok(markdownInline('$5 and $10').every(segment => !segment.math));
  assert.ok(markdownInline('$unfinished').every(segment => !segment.math));
});

test('display equations paste as independent blocks, with multiline LaTeX intact', () => {
  const blocks = markdownBlocks(String.raw`Before
$$\frac{a_1}{b_2}$$
After
$$
\begin{aligned}
x &= 1 \\
y &= 2
\end{aligned}
$$
End`);
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'math', 'paragraph', 'math', 'paragraph']);
  assert.equal(blocks[1].content[0].text, String.raw`\frac{a_1}{b_2}`);
  assert.match(blocks[3].content[0].text, /\\begin\{aligned\}/);
  assert.ok(markdownBlocks('```tex\n$$x$$\n```')[0].content[0].code);
  assert.equal(markdownBlocks('$$unfinished')[0].type, 'paragraph');
});

test('math rendering is accessible, editable, and does not activate unsafe LaTeX commands', () => {
  const html = segmentHTML([{text: String.raw`\frac{x}{2}`, math: true}], []);
  assert.match(html, /class="inline-math"/);
  assert.match(html, /data-math="\\frac\{x\}\{2\}"/);
  assert.match(html, /<math /);
  assert.match(html, /contentEditable="false"/);
  const unsafe = segmentHTML([{text: String.raw`\href{javascript:alert(1)}{click}`, math: true}], []);
  assert.doesNotMatch(unsafe, /href="javascript:/);
  assert.doesNotMatch(segmentHTML([{text: '<script>alert(1)</script>', math: true}], []), /<script>/);
  assert.doesNotThrow(() => segmentHTML([{text: String.raw`\frac{`, math: true}], []));
});

test('inline and display equations survive page persistence and entity scans skip formulas', async () => {
  const { mentionEvidence } = await import('../src/shared/entity-scan.ts');
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), knowledge = new Knowledge(store), pages = new Pages(store, knowledge);
    const page = pages.create('default', {title: 'Math'});
    const blocks = markdownBlocks('Inline $x_1^2$.\n\n$$x_1^2$$');
    const saved = pages.update('default', page.id, {...page, blocks});
    assert.deepEqual(saved.blocks, blocks);
    assert.equal(mentionEvidence(saved, 'x_1', 'ursula'), null);
    assert.ok(mentionEvidence(saved, 'Inline', 'ursula'));
    const invalid = [{...blocks[1], content: [{entityId: 'ursula'}]}];
    assert.throws(() => pages.update('default', page.id, {title: 'Math', blocks: invalid}), error => error.status === 400);
  } finally { db.close(); }
});
