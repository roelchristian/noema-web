import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createClassificationBaseline,assessSemanticDrift} from '../src/server/modules/page-semantic-drift.ts';
import {PageEnrichmentState} from '../src/server/modules/page-enrichment-state.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
const block=(text,type='paragraph')=>({id:'p',type,checked:false,content:[{text}]});
const page=(text,title='Algebra')=>({title,blocks:[block(text)]});
const corpus=JSON.parse(readFileSync(new URL('./fixtures/page-drift-corpus.json',import.meta.url),'utf8'));
for(const example of corpus)test('labelled drift corpus: '+example.id,()=>{
  const original=page(example.before),updated=page(example.after);
  if(example.heading)updated.blocks.push({...block(example.heading,'heading2'),id:'heading'});
  const decision=assessSemanticDrift({page:updated,baseline:createClassificationBaseline(original),currentDomainIds:[example.domain]});
  assert.equal(decision.needsClassification,example.label==='drift',JSON.stringify(decision));
});
test('normalisation ignores block IDs, styling, whitespace, generated explanations and displayed entity substitutions',()=>{
  const original=page('Algebra theorem proof');
  const updated={title:original.title,blocks:[{...block(''),id:'changed',content:[{text:'Algebra ',bold:true},{entityId:'theorem',mentionText:'theorem'},{text:'   proof'}]}, {...block('Psychology cognition anxiety'),'id':'ai',semantic:'ai-explanation'}]};
  const baseline=createClassificationBaseline(original);
  assert.equal(assessSemanticDrift({page:updated,baseline}).needsClassification,false);
  assert.equal(createClassificationBaseline(updated).contentHash,baseline.contentHash);
});
test('many saves are compared cumulatively with the successful classification baseline',()=>{
  const baseline=createClassificationBaseline(page('apple pear orange lemon grape peach cherry berry melon banana'));
  const near=assessSemanticDrift({page:page('apple pear orange lemon grape peach cherry berry melon kiwi'),baseline});
  assert.equal(near.needsClassification,false);
  const far=assessSemanticDrift({page:page('apple pear orange lemon volcano lava basalt crust mantle magma'),baseline});
  assert.equal(far.needsClassification,true);
  assert.equal(baseline.body,'apple pear orange lemon grape peach cherry berry melon banana');
});
test('novel disciplinary sections override high whole-page cosine; stale embeddings are ignored',()=>{
  const original=page('Algebra theorem proof polynomial equation '.repeat(80));
  const baseline=createClassificationBaseline(original);
  baseline.embedding={contentHash:baseline.contentHash,vector:[1,0],model:'cached'};
  const updated={...original,blocks:[...original.blocks,{...block('Cognitive psychology and memory','heading2'),id:'new'}]};
  const current=createClassificationBaseline(updated);
  const decision=assessSemanticDrift({page:updated,baseline,embedding:{contentHash:current.contentHash,vector:[1,0],model:'cached'}});
  assert.equal(decision.cosineSimilarity,1);assert.equal(decision.needsClassification,true);
  const stale=assessSemanticDrift({page:updated,baseline,embedding:{contentHash:'obsolete',vector:[1,0],model:'cached'}});
  assert.equal(stale.cosineSimilarity,undefined);
});
test('cached semantic evidence retains major rewording without acquiring an embedding',()=>{
  const original=page('First phrasing describing an idea with one particular wording.');
  const updated=page('Completely revised expression presenting the identical conceptual meaning.');
  const baseline=createClassificationBaseline(original);baseline.embedding={contentHash:baseline.contentHash,vector:[1,0],model:'cached'};
  const current=createClassificationBaseline(updated);
  assert.equal(assessSemanticDrift({page:updated,baseline,embedding:{contentHash:current.contentHash,vector:[1,0],model:'cached'}}).reason,'semantic_stable');
});
test('manual classifications remain protected even from explicit automatic refresh',()=>{
  assert.equal(assessSemanticDrift({page:page('Psychology cognition'),origin:'manual',explicit:true}).reason,'manual_override');
});
test('bounded snapshots retain mathematical and multilingual content',()=>{
  const baseline=createClassificationBaseline(page(('代数 α + β = γ. Algebra theorem proof. ').repeat(2000)));
  assert.equal(baseline.sampled,true);assert.ok(baseline.body.length<=24002);
  assert.ok(baseline.body.includes('代数'));assert.ok(baseline.body.includes('α'));
  assert.ok(Object.keys(baseline.tokenCounts).length<=4096);
});
test('assessment and manual field protection survive reopening the database',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'noema-drift-')),filename=path.join(directory,'db.sqlite');
  let db=openDatabase(filename);
  try {
    let store=new Store(db);const pages=new Pages(store,new Knowledge(store));let saved=pages.create('default',{title:'Algebra'});
    const original={...saved,...page('Algebra theorem proof polynomial equation')};
    store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(original.blocks),saved.id);
    const baseline=createClassificationBaseline(original),domains=new Domains(store);
    domains.setInferred('default',saved.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},baseline.contentHash,original);
    const revised={...original,...page('Algebra theorem proof polynomial equation. Another algebra example.')};
    const decision=domains.assess(revised);assert.equal(decision.needsClassification,false);
    assert.equal(domains.get(saved.id,decision.contentHash).status,'inferred');
    const state=new PageEnrichmentState(store);state.markManual(saved.id,'title');state.markManual(saved.id,'language');state.suppressSummary(saved.id);
    const classified=state.get(saved.id).classification;
    assert.equal(classified.classifiedContentHash,baseline.contentHash);assert.equal(classified.lastAssessedContentHash,decision.contentHash);
    db.close();db=openDatabase(filename);store=new Store(db);
    const restored=new PageEnrichmentState(store);
    assert.equal(restored.get(saved.id).classification.baseline.contentHash,baseline.contentHash);
    assert.equal(restored.eligible(saved.id,'title'),false);assert.equal(restored.eligible(saved.id,'language'),false);assert.equal(restored.eligible(saved.id,'summary'),false);
    assert.equal(new Domains(store).get(saved.id,decision.contentHash).status,'inferred');
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
test('ordinary prototype-named words cannot poison deterministic change scores',()=>{
  const baseline=createClassificationBaseline(page('apple pear orange lemon grape peach cherry berry melon banana'));
  const decision=assessSemanticDrift({page:page('constructor prototype toString valueOf magma lava basalt mantle crust volcano'),baseline});
  assert.ok(Number.isFinite(decision.score));assert.equal(decision.needsClassification,true);
});
test('a provider-backed refresh on the same body replaces inferred choices and renews the baseline',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'noema-drift-refresh-'));const db=openDatabase(path.join(directory,'db.sqlite'));
  try {
    const store=new Store(db),pages=new Pages(store,new Knowledge(store)),saved=pages.create('default',{title:'Algebra'}),domains=new Domains(store);
    const current={...saved,...page('Algebra theorem proof polynomial equation')};store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(current.blocks),saved.id);
    const hash=createClassificationBaseline(current).contentHash;
    domains.setInferred('default',saved.id,{primaryDomainId:'mathematics',secondaryDomainIds:[]},hash,current);
    domains.setInferred('default',saved.id,{primaryDomainId:'mathematics.algebra.abstract',secondaryDomainIds:[]},hash,current);
    assert.equal(domains.get(saved.id).primaryDomainId,'mathematics.algebra.abstract');
    assert.ok(new PageEnrichmentState(store).get(saved.id).classification.baseline);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

const roundtrip=value=>JSON.parse(JSON.stringify(value));
const distinctWords=Array.from({length:5000},(_,index)=>`word${index}`);
const legacyClassification=(original,version=1)=>{
 const baseline=createClassificationBaseline(original);
 const tokens=original.blocks.flatMap(block=>block.content.map(segment=>segment.text??'')).join(' ').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
 const tokenCounts=Object.create(null);let retainedWords=0;
 for(const token of tokens){
  if(Object.hasOwn(tokenCounts,token))tokenCounts[token]++;
  else if(retainedWords<4096){tokenCounts[token]=1;retainedWords++;}
 }
 return {...baseline,version,tokenCounts,tokenCount:tokens.length};
};

test('long varied note punctuation has zero drift after baseline serialization',()=>{
 const text=distinctWords.join(' ');
 const baseline=roundtrip(createClassificationBaseline(page(text)));
 const decision=assessSemanticDrift({page:page(text+'!'),baseline});
 assert.equal(decision.score,0);
 assert.equal(decision.needsClassification,false);
});

for(const version of [undefined,1])test(`complete legacy classification ${version??'unmarked'} matches version 2 evidence`,()=>{
 const original=page('apple '.repeat(60)+'pear '.repeat(40));
 const baseline=legacyClassification(original);if(version===undefined)delete baseline.version;
 const punctuation=assessSemanticDrift({page:page(original.blocks[0].content[0].text+'!'),baseline:roundtrip(baseline)});
 assert.equal(punctuation.score,0);assert.equal(punctuation.needsClassification,false);
 const updated=page('apple '.repeat(60)+'volcano '.repeat(40));
 const oldDecision=assessSemanticDrift({page:updated,baseline:roundtrip(baseline)});
 const newDecision=assessSemanticDrift({page:updated,baseline:roundtrip(createClassificationBaseline(original))});
 assert.equal(oldDecision.score,newDecision.score);assert.equal(oldDecision.needsClassification,true);
});

test('truncated legacy classification preserves exact content but refreshes changed omitted tokens',()=>{
 const retained=distinctWords.slice(0,4096).join(' ');
 const original=page(retained+' '+'oldtail '.repeat(6000));
 const baseline=roundtrip(legacyClassification(original));
 assert.equal(assessSemanticDrift({page:original,baseline}).reason,'unchanged');
 const decision=assessSemanticDrift({page:page(retained+' '+'newtail '.repeat(6000)),baseline});
 assert.equal(decision.needsClassification,true);assert.equal(decision.score,1);
});

test('uncertain legacy evidence cannot be suppressed by same-discipline or cached embedding safeguards',()=>{
 const retained='algebra theorem '+distinctWords.slice(0,4094).join(' ');
 const original=page(retained+' '+'oldtail '.repeat(6000));
 const baseline=roundtrip(legacyClassification(original));
 baseline.embedding={contentHash:baseline.contentHash,vector:[1,0],model:'cached'};
 const updated=page(retained+' '+'newtail '.repeat(6000));
 const current=createClassificationBaseline(updated);
 const decision=assessSemanticDrift({page:updated,baseline,currentDomainIds:['mathematics'],embedding:{contentHash:current.contentHash,vector:[1,0],model:'cached'}});
 assert.equal(decision.needsClassification,true);assert.equal(decision.score,1);
 assert.equal(assessSemanticDrift({page:updated,baseline,origin:'manual'}).reason,'manual_override');
});
