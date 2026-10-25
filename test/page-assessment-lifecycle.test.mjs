import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';
import {createClassificationBaseline} from '../src/server/modules/page-semantic-drift.ts';
import {PageSegments} from '../src/server/modules/page-segments.ts';
import {PageSegmentIndex} from '../src/server/modules/page-segment-index.ts';
import {embeddingDimensions} from '../src/shared/embeddings.ts';

function fixture(work) {
  const db=openDatabase(':memory:'),store=new Store(db),pages=new Pages(store,new Knowledge(store)),domains=new Domains(store);
  let page=pages.create('default',{title:'Algebra'});
  page=pages.update('default',page.id,{...page,blocks:[{id:'body',type:'paragraph',checked:false,content:[{text:'Algebra theorem proof polynomial equation '.repeat(100)}]}]});
  const baseline=createClassificationBaseline(page);
  domains.setInferred('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},baseline.contentHash,page);
  try {work({db,store,pages,domains,page});}finally{db.close();}
}
const key=(store,id)=>new PageEnrichmentState(store).get(id).classification.assessment.dependencyKey;

test('unchanged page and metadata reads perform zero writes, assessment work, or vector loads, including legacy hashes',()=>fixture(({db,store,pages,domains,page})=>{
  domains.assess(page);
  store.run('UPDATE pages SET summary_content_hash=NULL,summary_hash_version=1 WHERE id=?',page.id);
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  let writes=0,vectorReads=0;
  const run=store.run.bind(store),all=store.all.bind(store),assess=Domains.prototype.assess;
  store.run=(...args)=>{writes++;return run(...args);};
  store.all=(sql,...args)=>{if(/SELECT.*vector|SELECT b\.vector/is.test(sql))vectorReads++;return all(sql,...args);};
  Domains.prototype.assess=()=>{throw new Error('ordinary read attempted classification');};
  try {
    for(let i=0;i<10;i++){assert.equal(pages.get('default',page.id).id,page.id);assert.equal(pages.metadata('default',page.id).id,page.id);}
  }finally{Domains.prototype.assess=assess;}
  assert.equal(writes,0);assert.equal(vectorReads,0);assert.equal(db.prepare('SELECT total_changes() AS n').get().n-before,0);
}));

test('assessment dependency cache skips vector work and writes until relevant text/title/headings/policy/manual changes',()=>fixture(({store,domains,page})=>{
  domains.assess(page);const first=key(store,page.id);
  const cached=domains.cachedEmbedding;
  domains.cachedEmbedding=()=>{throw new Error('unchanged assessment loaded vectors');};
  let writes=0;const run=store.run.bind(store);store.run=(...args)=>{writes++;return run(...args);};
  domains.assess(page);assert.equal(writes,0);
  domains.assess({...page,blocks:page.blocks.map(b=>({...b,id:'formatting',content:b.content.map(s=>({...s,bold:true}))}))});assert.equal(writes,0);
  domains.cachedEmbedding=cached;
  domains.assess({...page,title:'Cognitive psychology and memory'});assert.notEqual(key(store,page.id),first);
  const titleKey=key(store,page.id);
  domains.assess({...page,title:'Cognitive psychology and memory',blocks:page.blocks.map(b=>({...b,type:'heading2'}))});assert.notEqual(key(store,page.id),titleKey);
  const state=new PageEnrichmentState(store),record=state.get(page.id);
  const headingKey=key(store,page.id);
  record.classification.baseline.body+=' changed baseline evidence';
  state.save(page.id,record);
  domains.assess({...page,title:'Cognitive psychology and memory',blocks:page.blocks.map(b=>({...b,type:'heading2'}))});
  assert.notEqual(key(store,page.id),headingKey,'baseline evidence changes invalidate even with identical generating provenance');
  const unchangedKey=key(store,page.id);writes=0;
  domains.assess({...page,title:'Cognitive psychology and memory',blocks:page.blocks.map(b=>({...b,type:'heading2'}))});
  assert.equal(key(store,page.id),unchangedKey);assert.equal(writes,0);
  const policyRecord=state.get(page.id);policyRecord.classification.classificationVersion='old-policy';state.save(page.id,policyRecord);
  assert.equal(domains.assess(page).needsClassification,true);
  domains.setManual('default',page.id,{primaryDomainId:'computing',secondaryDomainIds:[]},page.revision);
  assert.equal(domains.assess(page,undefined,{explicit:true}).reason,'manual_override');
}));

test('vector replacement/removal and dirty-index completion invalidate assessment and enqueue preparation',()=>fixture(({store,domains,page})=>{
  new PageSegments(store).synchronize('default',page.id);
  const segment=store.get('SELECT * FROM page_segments WHERE page_id=?',page.id),index=new PageSegmentIndex(store),vector=Array(embeddingDimensions).fill(0);vector[0]=1;
  index.save(segment,vector,10);domains.assess(page);const first=key(store,page.id);
  vector[1]=1;index.save(segment,vector,10);domains.assess(page);assert.notEqual(key(store,page.id),first);
  const replaced=key(store,page.id);store.run('DELETE FROM page_segment_embeddings WHERE segment_id=?',segment.id);domains.assess(page);assert.notEqual(key(store,page.id),replaced);
  assert.ok(store.get('SELECT 1 FROM page_enrichment_jobs WHERE page_id=?',page.id));
}));

test('unchanged manual assignment and unchanged enrichment state do not change rows',()=>fixture(({db,store,domains,page,pages})=>{
  domains.setManual('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},page.revision);
  const current=pages.get('default',page.id),state=new PageEnrichmentState(store),record=state.get(page.id),before=db.prepare('SELECT total_changes() AS n').get().n;
  domains.setManual('default',page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},current.revision);state.save(page.id,record);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n-before,0);
}));

test('narrow metadata conservatively reports raw imported changes before queued preparation',()=>fixture(({store,pages,page})=>{
  store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify([{id:'new',type:'paragraph',checked:false,content:[{text:'Psychology memory attention cognition anxiety.'}]}]),page.id);
  assert.equal(pages.metadata('default',page.id).pageDomains.status,'needs_refresh');
  assert.equal(pages.metadata('default',page.id).enrichmentPending,true);
  assert.equal(pages.get('default',page.id).pageDomains.status,'needs_refresh');
}));
