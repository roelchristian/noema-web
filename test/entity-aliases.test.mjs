import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { identifyEntityMentions } from '../src/shared/auto-entities.ts';
import { annotationSuggestions } from '../src/client/editor/selection-annotation.ts';
import { segmentHTML } from '../src/client/editor/segments.tsx';
import { PageEditor } from '../src/client/editor/PageEditor.tsx';
const entity = (id, name, aliases = []) => ({id, name, aliases, vault_id: 'default', type: 'person', subtypes: [], description: ''});
const donald = entity('donald', 'Donald Trump', ['Trump']);
const ivanka = entity('ivanka', 'Ivanka Trump', ['Trump']);
const block = (id, content) => ({id, type: 'paragraph', checked: false, content});

test('selection aliases append without overwriting entity details and deduplicate normalized names', () => {
  const db = openDatabase(':memory:');
  try {
    const knowledge = new Knowledge(new Store(db));
    const entity = knowledge.create('default', {name: 'Jake Zyrus', type: 'person', description: 'Saved description', aliases: ['Charice']});
    const updated = knowledge.addAlias('default', entity.id, {alias: ' Zyrus '});
    assert.deepEqual(updated.aliases, ['Charice', 'Zyrus']);
    assert.equal(updated.description, 'Saved description');
    assert.deepEqual(knowledge.addAlias('default', entity.id, {alias: 'ZYRUS'}), updated);
    assert.deepEqual(knowledge.addAlias('default', entity.id, {alias: ' Jake  Zyrus '}), updated);
    const other = knowledge.create('default', {name: 'Another Zyrus', type: 'person'});
    assert.deepEqual(knowledge.addAlias('default', other.id, {alias: 'Zyrus'}).aliases, ['Zyrus']);
    assert.throws(() => knowledge.addAlias('foreign', entity.id, {alias: 'Zyrus'}), error => error.status === 404);
    for (const alias of ['', ' ', null, 123, 'a'.repeat(201)]) assert.throws(() => knowledge.addAlias('default', entity.id, {alias}), error => error.status === 400);
  } finally { db.close(); }
});

test('aliases persist across restart, may be shared, and are retained when older clients omit them', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noema-aliases-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    let knowledge = new Knowledge(new Store(db));
    assert.deepEqual(knowledge.find('default', 'ursula').aliases, []);
    const donald = knowledge.create('default', {name: 'Donald Trump', type: 'person', aliases: [' Trump ', 'TRUMP', 'The  Donald']});
    const ivanka = knowledge.create('default', {name: 'Ivanka Trump', type: 'person', aliases: ['Trump']});
    assert.deepEqual(donald.aliases, ['TRUMP', 'The Donald']);
    assert.deepEqual(ivanka.aliases, ['Trump']);
    assert.deepEqual(knowledge.update('default', donald.id, {name: donald.name, type: 'person'}).aliases, donald.aliases);
    db.close(); db = openDatabase(filename); knowledge = new Knowledge(new Store(db));
    assert.deepEqual(knowledge.find('default', donald.id).aliases, donald.aliases);
    assert.deepEqual(knowledge.list('default').find(item => item.id === ivanka.id).aliases, ['Trump']);
    for (const aliases of [null, 'Trump', [''], ['a'.repeat(201)], [123], Array(101).fill('Trump')]) {
      assert.throws(() => knowledge.update('default', donald.id, {name: donald.name, type: 'person', aliases}), error => error.status === 400);
    }
    assert.deepEqual(knowledge.update('default', donald.id, {name: donald.name, type: 'person', aliases: []}).aliases, []);
    assert.equal(knowledge.find('other-vault', donald.id), undefined);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('unique aliases auto-link with original wording; duplicate aliases on one entity are not ambiguous', () => {
  const result = identifyEntityMentions([block('p', [{text: 'Trump met Donald Trump. Trumpeter.'}])], [{...donald, aliases: ['Trump', 'trump', 'Donald Trump']}], 'default');
  assert.equal(result.count, 2);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.blocks[0].content, [{entityId: 'donald', mentionText: 'Trump'}, {text: ' met '}, {entityId: 'donald'}, {text: '. Trumpeter.'}]);
  assert.equal(identifyEntityMentions(result.blocks, [donald], 'default').count, 0);
  assert.equal(identifyEntityMentions([block('p', [{text: 'Trump'}])], [{...donald, vault_id: 'other'}], 'default').count, 0);
});

test('shared aliases are flagged and can resolve one instance or all matching instances across paragraphs and tables', () => {
  const blocks = [block('p', [{text: 'Trump spoke. Trump listened.'}]), {...block('table', []), type: 'table', rows: [[[{text: 'Trump'}]]]}];
  const first = identifyEntityMentions(blocks, [donald, ivanka], 'default');
  assert.equal(first.count, 0); assert.equal(first.blocks, blocks); assert.equal(first.ambiguous.length, 3);
  assert.deepEqual(first.ambiguous[0].entityIds, ['donald', 'ivanka']);
  const one = identifyEntityMentions(blocks, [donald, ivanka], 'default', {match: first.ambiguous[1], entityId: 'ivanka'});
  assert.equal(one.count, 1);
  assert.deepEqual(one.blocks[0].content, [{text: 'Trump spoke. '}, {entityId: 'ivanka', mentionText: 'Trump'}, {text: ' listened.'}]);
  assert.equal(identifyEntityMentions(one.blocks, [donald, ivanka], 'default').ambiguous.length, 2);
  const all = identifyEntityMentions(one.blocks, [donald, ivanka], 'default', {match: identifyEntityMentions(one.blocks, [donald, ivanka], 'default').ambiguous[0], entityId: 'donald', all: true});
  assert.equal(all.count, 2); assert.equal(all.ambiguous.length, 0);
  assert.equal(all.blocks[0].content[2].entityId, 'ivanka');
  assert.deepEqual(all.blocks[1].rows[0][0], [{entityId: 'donald', mentionText: 'Trump'}]);
  assert.equal(identifyEntityMentions(blocks, [donald, ivanka], 'default', {match: first.ambiguous[0], entityId: 'not-a-candidate', all: true}).count, 0);
});

test('ambiguous longest aliases never fall back to a shorter unique name, and protected text stays excluded', () => {
  const entities = [entity('new', 'New'), entity('a', 'City A', ['New York']), entity('b', 'City B', ['New York'])];
  const result = identifyEntityMentions([block('p', [{text: 'New York'}])], entities, 'default');
  assert.equal(result.count, 0); assert.equal(result.ambiguous.length, 1); assert.equal(result.ambiguous[0].text, 'New York');
  const protectedText = [block('p', [{text: 'Trump', skipAutoTag: true}, {entityId: 'donald', mentionText: 'Trump'}, {text: 'Trump', math: true}])];
  assert.deepEqual(identifyEntityMentions(protectedText, [donald, ivanka], 'default').ambiguous, []);
});

test('aliases work across styled segments and alias collisions with canonical names require review', () => {
  const entities = [entity('a', 'Donald Trump', ['The Donald']), entity('b', 'The Donald')];
  const input = [block('p', [{text: 'The ', bold: true}, {text: 'Donald today.', italic: true}])];
  const first = identifyEntityMentions(input, entities, 'default');
  assert.equal(first.ambiguous.length, 1);
  const result = identifyEntityMentions(input, entities, 'default', {match: first.ambiguous[0], entityId: 'a'});
  assert.deepEqual(result.blocks[0].content, [{entityId: 'a', mentionText: 'The Donald'}, {text: ' today.', italic: true}]);
  const {exact, results} = annotationSuggestions([donald, ivanka], 'Trump', 'trump');
  assert.deepEqual(exact.map(item => item.id), ['donald', 'ivanka']); assert.equal(results.length, 2);
  assert.equal(annotationSuggestions([donald], 'arbitrary highlighted text', 'donald').results[0].id, 'donald');
});

test('alias labels survive saving and render as their original text with the canonical entity in the hover title', () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), knowledge = new Knowledge(store), pages = new Pages(store, knowledge);
    const entity = knowledge.create('default', {name: 'Donald Trump', type: 'person', aliases: ['Trump']});
    const page = pages.create('default', {title: 'Article'});
    const blocks = [block('p', [{entityId: entity.id, mentionText: 'Trump'}])];
    const saved = pages.update('default', page.id, {...page, blocks});
    assert.deepEqual(saved.blocks, blocks);
    const html = segmentHTML(saved.blocks[0].content, [entity]);
    assert.match(html, /data-mention-text="Trump"/); assert.match(html, /title="Donald Trump"/); assert.match(html, />Trump<\/span>/);
    const ambiguousPage = {...saved, blocks: [block('p', [{text: 'Trump'}])]};
    const reviewHTML = renderToStaticMarkup(createElement(PageEditor, {page: ambiguousPage, entities: [donald, ivanka], saveStatus: 'saved', onChange() {}, onOpenEntity() {}, onCreateEntity() {}, onSave() {}, onIdentify: async () => {}}));
    assert.match(reviewHTML, /1 entity match needs review/); assert.match(reviewHTML, /Donald Trump/); assert.match(reviewHTML, /Ivanka Trump/);
    assert.match(reviewHTML, /Link this instance/); assert.match(reviewHTML, /Link all/);
  } finally { db.close(); }
});

test('case variants resolve together and over-limit resolutions remain flagged for review', () => {
  const input = [block('p', [{text: 'Trump and TRUMP and trump.'}])];
  const first = identifyEntityMentions(input, [donald, ivanka], 'default');
  const all = identifyEntityMentions(input, [donald, ivanka], 'default', {match: first.ambiguous[0], entityId: 'donald', all: true});
  assert.equal(all.count, 3); assert.deepEqual(all.ambiguous, []);
  assert.deepEqual(all.blocks[0].content.filter(segment => segment.entityId).map(segment => segment.mentionText), ['Trump', 'TRUMP', 'trump']);
  const large = [block('large', [{text: 'Trump '.repeat(600)}])];
  const flagged = identifyEntityMentions(large, [donald, ivanka], 'default');
  const capped = identifyEntityMentions(large, [donald, ivanka], 'default', {match: flagged.ambiguous[0], entityId: 'donald', all: true});
  assert.equal(capped.blocks, large); assert.equal(capped.count, 0); assert.equal(capped.ambiguous.length, 600);
});
