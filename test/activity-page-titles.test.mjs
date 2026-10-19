import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {AINotifications} from '../src/server/modules/ai-notifications.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';

const selection={model:'test',reasoningEffort:'low'};
function fixture(filename=':memory:') {
  const db=openDatabase(filename),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  return {db,store,knowledge,pages,enrichments:new AIEnrichments(store,pages),log:new AIActivityLog(store),notifications:new AINotifications(store)};
}
test('completed and running activity and notifications resolve the same generated and manual titles as the note',()=>{
  const {db,store,pages,enrichments,log,notifications}=fixture();
  try {
    const page=pages.create('default',{title:'Untitled'});
    const done=log.start('page_summary',selection,'default',page.id);log.finish(done,'completed',200);
    const running=log.start('page_enrichment',selection,'default',page.id);
    notifications.record('default',page.id,'page_title');
    enrichments.save('default',page.id,'title',{title:'Generated algebra title'},page.revision,selection);
    // Generation does not overwrite the authored title column.
    assert.equal(store.get('SELECT title FROM pages WHERE id=?',page.id).title,'Untitled');
    const assertTitles=expected=>{
      assert.equal(pages.get('default',page.id).title,expected);
      for(const id of [done,running])assert.equal(log.list(null).items.find(item=>item.id===id).objectTitle,expected);
      assert.equal(notifications.list().items.find(item=>item.pageId===page.id).pageTitle,expected);
      assert.equal(notifications.list().running.find(item=>item.id===running).pageTitle,expected);
    };
    assertTitles('Generated algebra title');
    pages.update('default',page.id,{...pages.get('default',page.id),title:'My manual title'});
    assertTitles('My manual title');
  }finally{db.close();}
});
test('stale and malformed generated titles follow the note fallback and inferred titles survive presentation revisions',()=>{
  const {db,store,pages,enrichments,log,notifications}=fixture();
  try {
    const page=pages.create('default',{title:'Untitled'});
    const activity=log.start('page_enrichment',selection,'default',page.id);
    notifications.record('default',page.id,'page_summary');
    enrichments.save('default',page.id,'title',{title:'Generated title'},page.revision,selection);
    store.run('UPDATE pages SET revision=revision+1 WHERE id=?',page.id);
    assert.equal(pages.get('default',page.id).title,'Untitled');
    assert.equal(log.list(null).items[0].objectTitle,'Untitled');
    new PageEnrichmentState(store).setField(page.id,'title',{origin:'inferred'});
    assert.equal(pages.get('default',page.id).title,'Generated title');
    assert.equal(log.list(null).items[0].objectTitle,'Generated title');
    assert.equal(notifications.list().running.find(item=>item.id===activity).pageTitle,'Generated title');
    for(const value of ['{broken','null',JSON.stringify({title:'   '}),JSON.stringify({title:42})]) {
      store.run("UPDATE page_ai_enrichments SET data=? WHERE page_id=? AND kind='title'",value,page.id);
      assert.equal(pages.get('default',page.id).title,'Untitled');
      assert.equal(log.list(null).items[0].objectTitle,'Untitled');
      assert.equal(notifications.list().items[0].pageTitle,'Untitled');
    }
  }finally{db.close();}
});
test('source activity and notification titles continue to use the entity name',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'noema-activity-titles-'));
  const {db,store,knowledge,log,notifications}=fixture(path.join(directory,'test.sqlite'));
  try {
    const file=new SourceFiles(store).add('default','source.txt',Buffer.from('Source content.'));
    const source=knowledge.create('default',{type:'source',name:'Source title',attachmentIds:[file.id]});
    const activity=log.start('source_enrichment',selection,'default',source.id,'entity');
    notifications.recordSource('default',source.id,'completed','source_enrichment');
    assert.equal(log.list(null).items[0].objectTitle,'Source title');
    const queue=notifications.list();assert.equal(queue.items[0].pageTitle,'Source title');
    assert.equal(queue.running.find(item=>item.id===activity).pageTitle,'Source title');
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
