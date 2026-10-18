import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyEntityMentions } from '../src/shared/auto-entities.ts';
import { mentionEvidence } from '../src/shared/entity-scan.ts';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { Pages } from '../src/server/modules/pages.ts';
import { Knowledge } from '../src/server/modules/knowledge.ts';
import { EntityScans } from '../src/server/modules/entity-scan.ts';
import { AIEnrichments } from '../src/server/modules/ai-enrichments.ts';
const entity = {id: 'donald', name: 'Donald Trump', aliases: ['The Donald'], vault_id: 'default'};
const block = content => ({id: 'p', type: 'paragraph', checked: false, content});

test('utility and AI evidence matching ignore all formatting and match across code and link boundaries', () => {
  for (const style of [{bold: true}, {italic: true}, {underline: true}, {strike: true}, {code: true}, {href: 'https://example.com'}]) {
    const content = [{text: 'Before ', bold: true}, {text: 'Donald', ...style}, {text: ' '}, {text: 'Trump', href: 'https://example.com'}, {text: ' after', italic: true}];
    for (const input of [[block(content)], [{...block([]), type: 'table', rows: [[content]]}]]) {
      const local = identifyEntityMentions(input, [entity], 'default');
      const ai = mentionEvidence({blocks: input}, 'Donald Trump', entity.id);
      const expected = [{text: 'Before ', bold: true}, {entityId: 'donald'}, {text: ' after', italic: true}];
      assert.equal(local.count, 1);
      assert.deepEqual(input[0].type === 'table' ? local.blocks[0].rows[0][0] : local.blocks[0].content, expected);
      assert.deepEqual(ai.blocks, local.blocks);
    }
  }
});

test('utility scans aliases across formatting and flags shared aliases for review', () => {
  const input = [block([{text: 'The ', code: true}, {text: 'Donald', href: 'https://example.com'}])];
  const local = identifyEntityMentions(input, [entity], 'default');
  assert.equal(local.count, 1);
  assert.deepEqual(local.blocks[0].content, [{entityId: 'donald', mentionText: 'The Donald'}]);
  const collision = {...entity, id: 'other', name: 'Another person'};
  const shared = identifyEntityMentions(input, [entity, collision], 'default');
  assert.equal(shared.count, 0); assert.equal(shared.ambiguous.length, 1);
  assert.deepEqual(shared.ambiguous[0].entityIds, ['donald', 'other']);
});

test('both taggers respect explicit exclusions and semantic boundaries regardless of formatting', () => {
  for (const content of [
    [{text: 'Donald ', code: true}, {text: 'Trump', skipAutoTag: true}],
    [{text: 'Donald ', bold: true}, {text: 'Trump', math: true}],
    [{text: 'Donald '}, {entityId: 'existing'}, {text: 'Trump'}],
  ]) {
    const blocks = [block(content)];
    assert.equal(identifyEntityMentions(blocks, [entity], 'default').count, 0);
    assert.equal(mentionEvidence({blocks}, 'Donald Trump', 'donald'), null);
  }
  const blocks = [block([{text: 'Donald '}]), {...block([{text: 'Trump'}]), id: 'other'}];
  assert.equal(identifyEntityMentions(blocks, [entity], 'default').count, 0);
  assert.equal(mentionEvidence({blocks}, 'Donald Trump', 'donald'), null);
});

test('AI scans use formatting-free runs and acceptance links styled evidence without touching excluded text', () => {
  const db = openDatabase(':memory:');
  try {
    const store = new Store(db), knowledge = new Knowledge(store), pages = new Pages(store, knowledge);
    const scans = new EntityScans(store, pages, knowledge, new AIEnrichments(store, pages));
    const existing = knowledge.create('default', {name: 'Donald Trump', type: 'person', aliases: ['Trump']});
    let page = pages.create('default', {title: 'Formatting'});
    const excluded = {id: 'excluded', type: 'paragraph', checked: false, content: [{text: 'Ivanka Trump', bold: true, skipAutoTag: true}]};
    const content = [{text: 'Before ', italic: true}, {text: 'Donald', code: true}, {text: ' ', underline: true}, {text: 'Trump', href: 'https://example.com'}, {text: ' after', strike: true}];
    page = pages.update('default', page.id, {...page, blocks: [block(content), excluded]});
    assert.deepEqual(JSON.parse(scans.input('default', page)).untrusted_note.bodyTextRuns.map(run=>run.text), ['Before Donald Trump after']);
    const candidate = (name, existingId = null) => ({name, type: 'person', subtypes: [], description: 'Mentioned', evidence: name, reason: 'Named person', existingId});
    const scan = scans.save('default', page, JSON.stringify({suggestions: [candidate('Donald Trump', existing.id), candidate('Ivanka Trump')]}), {model: 'gpt-5-mini', reasoningEffort: 'low'});
    assert.equal(scan.suggestions.length, 1);
    const review = scans.review('default', page.id, {revision: page.revision, scanId: scan.id, suggestionId: scan.suggestions[0].id, decision: 'accepted'});
    assert.deepEqual(review.page.blocks[0].content, [{text: 'Before ', italic: true}, {entityId: existing.id}, {text: ' after', strike: true}]);
    assert.deepEqual(review.page.blocks[1], excluded);
  } finally { db.close(); }
});
