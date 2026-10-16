import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { AIActivityLog } from '../src/server/modules/ai-activity.ts';
const selection={model:'test-model',reasoningEffort:'low'};

test('activity persists, bounds storage, paginates and recovers interrupted requests',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-activity-')),filename=path.join(dir,'test.sqlite');
  let db=openDatabase(filename);
  try {
    let log=new AIActivityLog(new Store(db));
    for(let i=0;i<1005;i++){const id=log.start('connection_test',selection);log.finish(id,'completed',200);}
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_activity').get().count,1000);
    const seen=new Set();let cursor=null;
    do {
      const page=log.list(cursor);assert.equal(page.items.length,50);
      for(const item of page.items){assert.ok(!seen.has(item.id));seen.add(item.id);}
      cursor=page.nextCursor===null?null:String(page.nextCursor);
    }while(cursor!==null);
    assert.equal(seen.size,1000);
    const pending=log.start('connection_test',selection);log.request(pending,42,null);
    db.close();db=openDatabase(filename);log=new AIActivityLog(new Store(db));
    const recovered=log.list(null).items[0];
    assert.equal(recovered.id,pending);assert.equal(recovered.status,'interrupted');assert.ok(recovered.finishedAt);
    assert.equal(recovered.promptBytes,42);assert.equal(recovered.model,'test-model');
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_activity').get().count,1000);
    for(const value of ['-1','1.5','NaN','9007199254740992','0'])assert.throws(()=>log.list(value),e=>e.status===400);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('activity references survive deletion without retaining page contents or titles',()=>{
  const db=openDatabase(':memory:');
  try {
    const log=new AIActivityLog(new Store(db)),id=log.start('page_summary',selection,'default','welcome');
    log.finish(id,'completed',200);
    assert.equal(log.list(null).items[0].available,true);
    db.prepare('DELETE FROM pages WHERE id=?').run('welcome');
    const item=log.list(null).items[0];
    assert.equal(item.objectId,'welcome');assert.equal(item.objectTitle,null);assert.equal(item.available,false);
  }finally{db.close();}
});

test('clearing activity removes all visible rows and keeps locked vault records',()=>{
  const db=openDatabase(':memory:');
  try {
    const log=new AIActivityLog(new Store(db));
    const visible=log.start('page_summary',selection,'default','welcome');
    const global=log.start('connection_test',selection);
    db.prepare('UPDATE vaults SET locked=1 WHERE id=?').run('default');
    assert.deepEqual(log.list(null).items.map(item=>item.id),[global]);
    log.clear();
    assert.equal(log.list(null).items.length,0);
    assert.equal(db.prepare('SELECT id FROM ai_activity').get().id,visible);
    db.prepare('UPDATE vaults SET locked=0 WHERE id=?').run('default');
    log.clear();
    log.finish(visible,'completed',200);
    assert.equal(log.list(null).items.length,0);
  }finally{db.close();}
});
