import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPageDrag, isPageDrag, readPageDrop } from '../src/client/organization/page-drag.ts';

test('page drag carries vault scope and rejects foreign, malformed, or external payloads', () => {
  const values = new Map();
  const event = {dataTransfer: {types: [], setData(type, value) { values.set(type, value); this.types.push(type); }, getData(type) { return values.get(type) || ''; }}};
  assert.equal(isPageDrag(event), false);
  assert.equal(readPageDrop(event, 'vault-a'), null);
  startPageDrag(event, 'vault-a', 'page-1');
  assert.equal(isPageDrag(event), true);
  assert.equal(readPageDrop(event, 'vault-a'), 'page-1');
  assert.equal(readPageDrop(event, 'vault-b'), null);
  values.set(event.dataTransfer.types[0], '{broken');
  assert.equal(readPageDrop(event, 'vault-a'), null);
  values.set(event.dataTransfer.types[0], JSON.stringify({vaultId: 'vault-a', pageId: 42}));
  assert.equal(readPageDrop(event, 'vault-a'), null);
});
