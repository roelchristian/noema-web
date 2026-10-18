import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {PageUtility} from '../src/server/modules/page-utility.ts';
import {Domains} from '../src/server/modules/domains.ts';
import {domainShortlist} from '../src/server/modules/domain-shortlist.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {TAXONOMY_VERSION} from '../src/shared/domains.ts';
const selection={model:'gpt-6-luna',reasoningEffort:'none'};
function fixture(title='Algebra') {
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  let page=pages.create('default',{title});
  page=pages.update('default',page.id,{...page,blocks:[{id:'p',type:'paragraph',checked:false,content:[{text:'An algebraic field has multiplicative inverses. Groups and rings are algebraic structures.'}]}]});
  return {db,store,pages,knowledge,page};
}
test('classification uses roots and locally relevant descendants in one compact request',()=>{
  const shortlist=domainShortlist('Algebraic groups, rings, fields and homomorphisms');
  assert.equal(shortlist.filter(domain=>!domain.id.includes('.')).length,20);
  assert.ok(shortlist.some(domain=>domain.id==='mathematics.algebra.abstract'));
  assert.ok(shortlist.length<70);
  assert.ok(shortlist.find(domain=>domain.id==='mathematics.algebra.abstract').name.includes('→'));
});
test('classification is versioned, cached independently and preserves legacy data',async()=>{
  const {db,store,pages,knowledge,page}=fixture();let calls=0;
  const intelligence={titleSelection:()=>selection,generatePageUtility:async(_input,domains)=>{calls++;assert.ok(domains.some(domain=>domain.id==='mathematics.algebra.abstract'));return {title:'Algebra',primaryDomainId:'mathematics.algebra.abstract',secondaryDomainIds:[]};}};
  const enrichments=new AIEnrichments(store,pages),utility=new PageUtility(store,pages,knowledge,enrichments,intelligence);
  try {
    enrichments.save('default',page.id,'concept_classification',{subtypeIds:['concept:mathematics'],contentHash:page.conceptContentHash},page.revision,selection);
    const result=await utility.run('default',page);
    assert.equal(result.pageDomains.primaryDomainId,'mathematics.algebra.abstract');
    assert.equal(result.pageDomains.taxonomyVersion,TAXONOMY_VERSION);
    await utility.run('default',pages.get('default',page.id));assert.equal(calls,1);
    assert.deepEqual(pages.get('default',page.id).conceptClassification.subtypeIds,['concept:mathematics']);
    new Domains(store).setManual('default',page.id,{primaryDomainId:'psychology',secondaryDomainIds:[]},page.revision);
    await utility.run('default',pages.get('default',page.id));assert.equal(calls,1,'Manual domain edits cause no title/classification request');
  }finally{db.close();}
});
test('a manual assignment made during inference wins and title generation still works',async()=>{
  const {db,store,pages,knowledge,page}=fixture('Untitled');let finish;
  const intelligence={titleSelection:()=>selection,generatePageUtility:()=>new Promise(resolve=>{finish=resolve;})};
  const utility=new PageUtility(store,pages,knowledge,new AIEnrichments(store,pages),intelligence);
  try {
    const pending=utility.run('default',page);
    new Domains(store).setManual('default',page.id,{primaryDomainId:'psychology',secondaryDomainIds:['philosophy']},page.revision);
    finish({title:'Algebraic Structures',primaryDomainId:'mathematics.algebra.abstract',secondaryDomainIds:[]});
    const result=await pending;
    assert.equal(result.title,'Algebraic Structures');assert.equal(result.pageDomains.primaryDomainId,'psychology');assert.equal(result.pageDomains.origin,'manual');
  }finally{db.close();}
});
test('AI classification validates canonical shortlisted IDs and secondary limits',async()=>{
  const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
  let output;
  const ai=new Intelligence(secrets,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}));
  ai.save({apiKey:'sk-domain-classification-test-secret'});
  for(const value of [{title:'Fields',primaryDomainId:'invented',secondaryDomainIds:[]},{title:'Fields',primaryDomainId:'mathematics',secondaryDomainIds:['mathematics','mathematics','mathematics']}]) {
    output=value;await assert.rejects(ai.generatePageUtility('Fields',[{id:'mathematics',name:'Mathematics'}],'Untitled'),{status:502});
  }
});
