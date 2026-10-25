import {numberedWords,omittedVocabularyTail,legacyTokenEvidence} from './helpers/legacy-content.mjs';
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
import {PageEnrichment} from '../src/server/modules/page-enrichment.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {createClassificationBaseline} from '../src/server/modules/page-semantic-drift.ts';
import {summaryBaseline} from '../src/server/modules/page-summary-freshness.ts';

const selection={model:'legacy-provider',reasoningEffort:'none'};
const longBody=omittedVocabularyTail(numberedWords(4096).join(' '),'oldtail',{trailingSpace:false});
const blocks=text=>[{id:'source',type:'paragraph',checked:false,content:[{text}]}];
function services(db,provider) {
  const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages);
  const coordinator=new PageEnrichment(store,pages,knowledge,enrichments,{enrichmentSelection:()=>selection,generatePageEnrichment:provider});
  return {store,pages,enrichments,coordinator};
}
function fixture(text=longBody,provider=async()=>{throw new Error('Unexpected provider request');}) {
  const directory=mkdtempSync(path.join(tmpdir(),'noema-legacy-migration-')),filename=path.join(directory,'db.sqlite'),db=openDatabase(filename);
  const s=services(db,provider),page=s.pages.create('default',{title:'Research note'});
  s.store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(blocks(text)),page.id);
  return {...s,page:s.pages.get('default',page.id),db,filename,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function legacyBaseline(page) {
  const baseline=createClassificationBaseline(page);
  const words=page.blocks.flatMap(block=>block.content.map(part=>part.text??'')).join(' ').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}\p{P}]/gu)??[];
  return {...baseline,version:1,...legacyTokenEvidence(words)};
}
function installClassification(s) {
  new Domains(s.store).setInferred('default',s.page.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},s.page.conceptContentHash,s.page);
  const state=new PageEnrichmentState(s.store),record=state.get(s.page.id);
  record.classification.baseline=legacyBaseline(s.page);
  record.classification.lastClassifiedAt='2025-01-02T03:04:05.000Z';
  state.save(s.page.id,record);
  return structuredClone(record.classification);
}
function installSummary(s,{generatedContentHash=s.page.summaryContentHash}={}) {
  const {version,title,headings,tokenCounts,tokenCount}=legacyBaseline(s.page);
  s.enrichments.save('default',s.page.id,'summary',{summary:'Original generated summary',origin:'inferred',baseline:{version,title,headings,tokenCounts,tokenCount},...(generatedContentHash?{generatedContentHash}:{})},s.page.revision,selection);
  return summaryRow(s);
}
const summaryRow=s=>s.store.get("SELECT * FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",s.page.id);
function edit(s,text) {
  s.store.run('UPDATE pages SET blocks=?,revision=revision+1,summary_content_hash=NULL WHERE id=?',JSON.stringify(blocks(text)),s.page.id);
  return s.pages.get('default',s.page.id);
}
function assertMigratedClassification(s,original) {
  const classification=new PageEnrichmentState(s.store).get(s.page.id).classification;
  assert.equal(classification.baseline.version,2);
  assert.equal(Object.values(classification.baseline.tokenCounts).reduce((sum,count)=>sum+count,0),classification.baseline.tokenCount);
  assert.equal(classification.classifiedContentHash,original.classifiedContentHash);
  assert.equal(classification.lastClassifiedAt,original.lastClassifiedAt);
  assert.equal(classification.needsRefresh,false);
}

test('complete persisted legacy classification converts locally without rebasing edited content or provenance',()=>{
  const s=fixture('Original vocabulary describes a quiet collection of neutral research observations.');try {
    const original=installClassification(s);
    const current=edit(s,'Original vocabulary describes a quiet collection of neutral research observations!');
    assert.equal(new Domains(s.store).assess(current).needsClassification,false);
    assertMigratedClassification(s,original);
    assert.equal(new PageEnrichmentState(s.store).get(s.page.id).classification.baseline.contentHash,original.baseline.contentHash);
  }finally{s.close();}
});

test('truncated legacy classification upgrades only for verified unchanged source and survives reopening',()=>{
  const s=fixture();try {
    const original=installClassification(s);
    assert.equal(new Domains(s.store).assess(s.page).needsClassification,false);
    assertMigratedClassification(s,original);
    const db=openDatabase(s.filename);try {
      const reopened=services(db,()=>{throw new Error('Unexpected provider request after restart');});
      assertMigratedClassification({...reopened,page:s.page},original);
      assert.equal(reopened.coordinator.prepare('default',s.page.id,{fields:['domains']}),null);
    }finally{db.close();}
  }finally{s.close();}
});

test('equal length replacement in omitted legacy vocabulary requests classification without replacing its generating baseline',()=>{
  const s=fixture();try {
    const original=installClassification(s),current=edit(s,longBody.replaceAll('oldtail','newtail'));
    const decision=new Domains(s.store).assess(current);
    assert.equal(decision.needsClassification,true);
    const saved=new PageEnrichmentState(s.store).get(s.page.id).classification;
    assert.deepEqual(saved.baseline,original.baseline);
    assert.equal(saved.classifiedContentHash,original.classifiedContentHash);
    assert.equal(saved.lastClassifiedAt,original.lastClassifiedAt);
    assert.deepEqual(s.coordinator.prepare('default',s.page.id,{fields:['domains']}).requestedFields,['domains']);
  }finally{s.close();}
});

test('summary with verified generating hash upgrades locally while preserving provider metadata across reopening',()=>{
  const s=fixture();try {
    const original=installSummary(s);
    assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
    const migrated=summaryRow(s),data=JSON.parse(migrated.data);
    assert.equal(data.baseline.version,2);
    assert.equal(Object.values(data.baseline.tokenCounts).reduce((sum,count)=>sum+count,0),10096);
    assert.deepEqual({...migrated,data:undefined},{...original,data:undefined});
    assert.equal(data.generatedContentHash,s.page.summaryContentHash);
    assert.equal(data.summary,'Original generated summary');
    const db=openDatabase(s.filename);try {
      const reopened=services(db,()=>{throw new Error('Unexpected provider request after restart');});
      assert.equal(reopened.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
      assert.equal(JSON.parse(reopened.store.get("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",s.page.id).data).baseline.version,2);
    }finally{db.close();}
  }finally{s.close();}
});

test('changed truncated summary stays stale on provider failure and gets a new baseline only after success',async()=>{
  let fails=true;
  const s=fixture(longBody,async()=>{if(fails)throw new Error('Provider unavailable');return {summary:'Updated summary'};});try {
    const original=installSummary(s),current=edit(s,longBody.replaceAll('oldtail','newtail'));
    assert.deepEqual(s.coordinator.prepare('default',s.page.id,{fields:['summary']}).requestedFields,['summary']);
    assert.equal(JSON.parse(summaryRow(s).data).freshness.status,'refresh_needed');
    assert.equal(JSON.parse(summaryRow(s).data).summary,JSON.parse(original.data).summary);
    assert.deepEqual(JSON.parse(summaryRow(s).data).baseline,JSON.parse(original.data).baseline);
    await assert.rejects(s.coordinator.run('default',current,undefined,{fields:['summary']}),/Provider unavailable/);
    assert.equal(JSON.parse(summaryRow(s).data).freshness.status,'refresh_needed');
    assert.equal(JSON.parse(summaryRow(s).data).summary,JSON.parse(original.data).summary);
    assert.deepEqual(JSON.parse(summaryRow(s).data).baseline,JSON.parse(original.data).baseline);
    fails=false;
    await s.coordinator.run('default',current,undefined,{fields:['summary']});
    const saved=summaryRow(s),data=JSON.parse(saved.data);
    assert.equal(data.baseline.version,2);
    assert.equal(data.generatedContentHash,current.summaryContentHash);
    assert.equal(saved.content_hash,current.summaryContentHash);
    assert.equal(data.summary,'Updated summary');
  }finally{s.close();}
});

test('previously advanced summary freshness hash cannot certify a truncated generating baseline',()=>{
  const s=fixture();try {
    const original=installSummary(s),current=edit(s,longBody.replaceAll('oldtail','newtail'));
    s.store.run("UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=? AND kind='summary'",current.summaryContentHash,s.page.id);
    assert.deepEqual(s.coordinator.prepare('default',s.page.id,{fields:['summary']}).requestedFields,['summary']);
    const saved=summaryRow(s);
    assert.equal(JSON.parse(saved.data).generatedContentHash,JSON.parse(original.data).generatedContentHash);
    assert.equal(JSON.parse(saved.data).baseline.version,1);
  }finally{s.close();}
});

test('missing generating hashes require matching saved revision before truncated summaries can upgrade',()=>{
  const s=fixture();try {
    installSummary(s,{generatedContentHash:null});
    assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
    assert.equal(JSON.parse(summaryRow(s).data).baseline.version,2);
  }finally{s.close();}
  const stale=fixture();try {
    installSummary(stale,{generatedContentHash:null});
    const current=edit(stale,longBody.replaceAll('oldtail','newtail'));
    stale.store.run("UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=? AND kind='summary'",current.summaryContentHash,stale.page.id);
    assert.deepEqual(stale.coordinator.prepare('default',stale.page.id,{fields:['summary']}).requestedFields,['summary']);
    assert.equal(JSON.parse(summaryRow(stale).data).baseline.version,1);
  }finally{stale.close();}
});

test('legacy baseline assessment preserves manual domains and suppressed summaries',()=>{
  const s=fixture();try {
    installClassification(s);installSummary(s);
    new Domains(s.store).setManual('default',s.page.id,{primaryDomainId:'psychology',secondaryDomainIds:[]},s.page.revision);
    s.enrichments.removeSummary('default',s.page.id);
    edit(s,longBody.replaceAll('oldtail','newtail'));
    assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['domains','summary']}),null);
    const domains=new Domains(s.store).get(s.page.id);
    assert.equal(domains.origin,'manual');assert.equal(domains.primaryDomainId,'psychology');
    assert.equal(summaryRow(s),undefined);
    assert.equal(new PageEnrichmentState(s.store).get(s.page.id).fields.summary.suppressed,true);
  }finally{s.close();}
});


test('complete legacy summary retains generating evidence and refreshes uncertain small edits',()=>{
  const text=Array.from({length:100},(_,i)=>`word${i}`).join(' '),s=fixture(text);try {
    const expected=summaryBaseline(s.page,()=>undefined),original=installSummary(s);
    const current=edit(s,text+' additional');
    assert.deepEqual(s.coordinator.prepare('default',s.page.id,{fields:['summary']}).requestedFields,['summary']);
    const saved=summaryRow(s),data=JSON.parse(saved.data);
    assert.equal(data.freshness.status,'refresh_needed');
    assert.equal(data.baseline.version,2);
    assert.deepEqual(data.baseline.tokenCounts,expected.tokenCounts);
    assert.equal(data.generatedContentHash,JSON.parse(original.data).generatedContentHash);
    assert.equal(saved.content_hash,original.content_hash);
    assert.equal(saved.updated_at,original.updated_at);
    assert.equal(saved.revision,original.revision);
    assert.equal(saved.model,original.model);
    assert.notDeepEqual(data.baseline.tokenCounts,summaryBaseline(current,()=>undefined).tokenCounts);
  }finally{s.close();}
});

test('version 2 long-note punctuation edits advance freshness without a provider request',()=>{
  const text=numberedWords(5000).join(' '),s=fixture(text);try {
    const baseline=summaryBaseline(s.page,()=>undefined);
    s.enrichments.save('default',s.page.id,'summary',{summary:'A long note summary',origin:'inferred',baseline,generatedContentHash:s.page.summaryContentHash},s.page.revision,selection);
    const original=summaryRow(s),current=edit(s,text+'!');
    assert.notEqual(current.summaryContentHash,original.content_hash);
    assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
    const saved=summaryRow(s);
    assert.equal(saved.content_hash,current.summaryContentHash);
    assert.deepEqual(JSON.parse(saved.data).baseline,baseline);
    assert.equal(saved.updated_at,original.updated_at);
    assert.equal(s.store.get('SELECT count(*) AS count FROM page_enrichment_decisions WHERE page_id=? AND provider_requested=1',s.page.id).count,0);
  }finally{s.close();}
});

test('present malformed summary baselines require refresh even when their cached source hash matches',()=>{
  const cases=[
    ['incomplete version 2 token mass',baseline=>({...baseline,tokenCounts:{b0:1},tokenCount:100})],
    ['malformed heading metadata',baseline=>({...baseline,headings:'not an array'})],
    ['malformed title metadata',baseline=>({...baseline,title:null})],
  ];
  for(const [name,corrupt] of cases) {
    const s=fixture('A sufficiently long source paragraph for summary enrichment.');try {
      s.enrichments.save('default',s.page.id,'summary',{summary:'Existing summary',origin:'inferred',baseline:corrupt(summaryBaseline(s.page,()=>undefined)),generatedContentHash:s.page.summaryContentHash},s.page.revision,selection);
      const original=summaryRow(s);
      assert.equal(original.content_hash,s.page.summaryContentHash,name);
      assert.deepEqual(s.coordinator.prepare('default',s.page.id,{fields:['summary']}).requestedFields,['summary'],name);
      assert.equal(JSON.parse(summaryRow(s).data).freshness.status,'refresh_needed',name);
      assert.equal(JSON.parse(summaryRow(s).data).summary,JSON.parse(original.data).summary,name);
      assert.deepEqual(JSON.parse(summaryRow(s).data).baseline,JSON.parse(original.data).baseline,name);
      assert.equal(summaryRow(s).content_hash,null,name);
    }finally{s.close();}
  }
  const s=fixture('A sufficiently long source paragraph for summary enrichment.');try {
    s.enrichments.save('default',s.page.id,'summary',{summary:'Legacy summary without baseline'},s.page.revision,selection);
    const original=summaryRow(s);
    assert.equal(s.coordinator.prepare('default',s.page.id,{fields:['summary']}),null);
    assert.equal(JSON.parse(summaryRow(s).data).summary,JSON.parse(original.data).summary);
    assert.equal(JSON.parse(summaryRow(s).data).freshness.status,'generated');
    assert.equal(summaryRow(s).content_hash,original.content_hash);
  }finally{s.close();}
});
