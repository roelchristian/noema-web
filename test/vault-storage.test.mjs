import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Vaults} from '../src/server/modules/vaults.ts';
import {vaultStorage} from '../src/server/modules/vault-storage.ts';

test('storage measures vault files and UTF-8 data, scopes child rows, skips symlinks, and protects locked vaults', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-storage-'));
  const db = openDatabase(path.join(directory, 'noema.sqlite'));
  const store = new Store(db), vaults = new Vaults(store);
  try {
    const vault = vaults.create({name: 'Storage test'}), other = vaults.create({name: 'Other'});
    const baseline = await vaultStorage(store, vault.id);
    const category = (data, id) => data.categories.find(item => item.id === id).bytes;
    store.run('INSERT INTO entities (id,vault_id,name,type,description,updated_at) VALUES (?,?,?,?,?,?)', 'entity-test', vault.id, '日本語', 'person', '', 'now');
    store.run('INSERT INTO properties (id,entity_id,name,value) VALUES (?,?,?,?)', 'property-test', 'entity-test', 'Biography', 'é'.repeat(1000));
    const beforeOther = await vaultStorage(store, vault.id);
    assert.ok(category(beforeOther, 'entities') - category(baseline, 'entities') > 2000);
    store.run('INSERT INTO entities (id,vault_id,name,type,description,updated_at) VALUES (?,?,?,?,?,?)', 'other-entity', other.id, 'Other', 'person', 'x'.repeat(20000), 'now');
    const root = path.join(directory, 'assets', vault.id);
    mkdirSync(path.join(root, 'images'), {recursive: true});
    mkdirSync(path.join(root, 'speech'), {recursive: true});
    mkdirSync(path.join(root, 'source-evidence', 'nested'), {recursive: true});
    writeFileSync(path.join(root, 'images', 'image.png'), Buffer.alloc(123));
    writeFileSync(path.join(root, 'source-evidence', 'nested', 'original'), Buffer.alloc(456));
    symlinkSync(path.join(directory, 'noema.sqlite'), path.join(root, 'images', 'outside-link'));
    writeFileSync(path.join(root,'speech','a'.repeat(64)+'.wav'),Buffer.alloc(800));
    writeFileSync(path.join(root,'speech','a'.repeat(64)+'.wav.sha256'),'b'.repeat(64));
    const result = await vaultStorage(store, vault.id);
    assert.equal(result.dataBytes, beforeOther.dataBytes);
    assert.equal(result.fileBytes, 1443);
    assert.equal(category(result, 'attachments'), 1443);
    assert.equal(result.totalBytes, result.dataBytes + result.fileBytes);
    assert.equal(result.totalBytes, result.categories.reduce((sum, item) => sum + item.bytes, 0));
    const attachments = await vaultStorage(store, vault.id, 'attachments');
    assert.deepEqual(attachments.items.map(item => item.bytes), [864, 456, 123]);
    assert.equal(attachments.items[0].name,'Saved speech · aaaaaaaa');
    assert.equal(attachments.items[0].detail,'speech/'+'a'.repeat(64)+'.wav');
    assert.equal(attachments.items[1].detail, 'source-evidence/nested/original');
    assert.ok(attachments.items.every(item => !item.id.includes('outside-link')));
    const entities = await vaultStorage(store, vault.id, 'entities');
    const entity = entities.items.find(item => item.id === 'entity:entity-test');
    assert.equal(entity.name, '日本語');
    assert.ok(entity.bytes > 2000, 'properties count toward their owning entity');
    assert.ok(entities.items.every(item => item.name !== 'Other'));
    store.run('INSERT INTO pages (id,vault_id,title,blocks,updated_at,deleted_at) VALUES (?,?,?,?,?,?)', 'large-note', vault.id, 'Large note', 'x'.repeat(10000), 'now', 'now');
    store.run('INSERT INTO pages (id,vault_id,title,blocks,updated_at) VALUES (?,?,?,?,?)', 'small-note', vault.id, 'Small note', '[]', 'now');
    store.run('INSERT INTO pages (id,vault_id,title,blocks,updated_at) VALUES (?,?,?,?,?)', 'other-note', other.id, 'Other note', 'x'.repeat(50000), 'now');
    const notes = await vaultStorage(store, vault.id, 'notes');
    assert.equal(notes.items[0].name, 'Large note');
    assert.equal(notes.items[0].detail, 'Note in Trash');
    assert.ok(notes.items.some(item => item.name === 'Small note'));
    assert.ok(notes.items.every(item => item.name !== 'Other note'));
    for (const {id} of result.categories) {
      const detail = await vaultStorage(store, vault.id, id);
      assert.equal(detail.items.reduce((sum, item) => sum + item.bytes, 0), category(detail, id), id + ' items reconcile');
      assert.ok(detail.items.every((item, index, all) => index === 0 || all[index - 1].bytes >= item.bytes));
    }
    await assert.rejects(vaultStorage(store, vault.id, 'invalid'), {status: 400});
    vaults.lock(vault.id, {passphrase: 'test passphrase'});
    await assert.rejects(vaultStorage(store, vault.id), {status: 423});
    await assert.rejects(vaultStorage(store, 'missing'), {status: 404});
  } finally {db.close(); rmSync(directory, {recursive: true, force: true});}
});
