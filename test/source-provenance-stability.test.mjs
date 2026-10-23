import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {syncSourceProvenance} from '../src/server/modules/source-provenance.ts';
test('source metadata synchronization preserves stable property IDs and unrelated authored values',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-provenance-stable-')),db=openDatabase(path.join(dir,'test.sqlite')),store=new Store(db),files=new SourceFiles(store);
 try {
  const knowledge=new Knowledge(store),file=files.add('default','source.md',Buffer.from('Synthetic text'));
  const entity=knowledge.create('default',{name:'Synthetic source',type:'source',attachmentIds:[file.id]});
  const before=store.all('SELECT * FROM properties WHERE entity_id=? ORDER BY id',entity.id);
  store.run('INSERT INTO properties VALUES (?,?,?,?,?)','authored',entity.id,'url','https://authored.example',null);
  syncSourceProvenance(store,'default',entity.id);syncSourceProvenance(store,'default',entity.id);
  assert.deepEqual(store.all("SELECT * FROM properties WHERE entity_id=? AND id!='authored' ORDER BY id",entity.id),before);
  assert.equal(store.get('SELECT value FROM properties WHERE id=?','authored').value,'https://authored.example');
 }finally{files.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
