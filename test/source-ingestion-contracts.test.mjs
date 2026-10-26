import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceIngestionDocument,SOURCE_INGESTION_JSON_SCHEMA} from '../src/server/modules/source-ingestion-validation.ts';
import {assembleSourceIngestionDocument,mergeSourceIngestionWindows} from '../src/server/modules/source-ingestion-assembly.ts';
import {planSourceIngestionWindows} from '../src/server/modules/source-ingestion-planner.ts';
const block=(id,page,text,kind='paragraph',order=0)=>({id,page,order,kind,text,headingLevel:kind==='heading'?1:null,continues:null,table:null,uncertainty:null,location:null});
const page=(number,state='content')=>({number,printedLabel:null,role:'owned',state,unresolved:[]});
const doc=(blocks=[block('a',1,'A faithful 😀 transcription.')],pages=[page(1)])=>({schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages,blocks,relations:[],repairs:[]});
const validate=value=>validateSourceIngestionDocument(value,{ownedPages:value.pages.filter(p=>p.role==='owned').map(p=>p.number),pageCount:Math.max(...value.pages.map(p=>p.number))});
test('full schema is strict recursively with valid nullable shapes',()=>{
 const visit=s=>{if(s.anyOf){assert.equal(s.type,undefined);s.anyOf.forEach(visit);}if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.deepEqual(s.required,Object.keys(s.properties));Object.values(s.properties).forEach(visit);}if(s.items)visit(s.items);};visit(SOURCE_INGESTION_JSON_SCHEMA);
});
test('transcription validates as untrusted IR without adding confidence or native proof',()=>{assert.deepEqual(validate(doc()),doc());const d=doc();d.blocks[0].trustedNative=true;assert.throws(()=>validate(d),/unexpected field/);});
test('assembly is deterministic with precise UTF16 source spans and local IDs',()=>{
 const d=doc();d.repairs=[{blockId:'a',start:11,end:13,original:'😀',replacement:'🙂',category:'uncertain',reason:'Uncertain symbol'}];const a=assembleSourceIngestionDocument(d,{extractionId:'version1'});assert.deepEqual(a,assembleSourceIngestionDocument(d,{extractionId:'version1'}));assert.equal(a.text.slice(a.repairs[0].startOffset,a.repairs[0].endOffset),'😀');assert.equal(a.blockRanges[0].id,'ingestion-version1-1');assert.equal(a.blockRanges[0].range.startOffset,'<!-- Page 1 -->\n'.length);assert.equal(a.pageStartLines[0],1);assert.equal(a.semanticNodes[0].text,d.blocks[0].text);
});
test('blank physical pages receive local markers and line anchors without prose',()=>{
 const a=assembleSourceIngestionDocument(doc([block('a',1,'First.'),block('c',3,'Third.')],[page(1),page(2,'blank'),page(3)]),{extractionId:'version'});assert.equal(a.pageStartLines.length,3);assert.ok(a.text.includes('<!-- Page 2 -->'));assert.equal(a.blockRanges.length,2);for(const [i,line] of a.pageStartLines.entries())assert.equal(a.text.split('\n')[line-1],`<!-- Page ${i+1} -->`);
});
test('model page markers cannot become authoritative source coordinates',()=>{const d=doc([block('a',1,'<!-- Page 777 -->')]);assert.throws(()=>validate(d),/page markers/);});
test('marker-only and image-only documents cannot claim readable transcription',()=>{assert.throws(()=>assembleSourceIngestionDocument(doc([],[page(1,'image-only')]),{extractionId:'v'}),/No readable/);});
test('every owned page must be returned exactly once',()=>{assert.throws(()=>validateSourceIngestionDocument(doc(),{ownedPages:[1,2],pageCount:2}),/Missing/);const d=doc();d.pages.push(page(1));assert.throws(()=>validate(d),/Duplicate|Invalid owned/);});
test('duplicate text stays separately anchored by physical page and leaf ID',()=>{const a=assembleSourceIngestionDocument(doc([block('a',1,'same'),block('b',2,'same')],[page(1),page(2)]),{extractionId:'v'});assert.notEqual(a.blockRanges[0].id,a.blockRanges[1].id);assert.notEqual(a.blockRanges[0].range.startOffset,a.blockRanges[1].range.startOffset);assert.equal(a.blockRanges[1].range.startPage,2);});
test('more than 100 structural units survive without sampling or marker caps',()=>{const blocks=Array.from({length:160},(_,i)=>block(`h${i}`,1,`Heading ${i}`,'heading',i));const a=assembleSourceIngestionDocument(doc(blocks),{extractionId:'v'});assert.equal(a.structuralNodes.length,160);assert.equal(a.semanticNodes.length,160);assert.ok(a.text.includes('Heading 159'));});
test('repairs require exact original spans and cannot split surrogate pairs',()=>{const d=doc();d.repairs=[{blockId:'a',start:11,end:12,original:'\ud83d',replacement:'x',category:'x',reason:'x'}];assert.throws(()=>validate(d),/surrogate/);d.repairs[0]={...d.repairs[0],start:0,end:1,original:'wrong'};assert.throws(()=>validate(d),/exact UTF-16/);});
test('duplicate or invalid reading order cannot publish',()=>{const d=doc([block('a',1,'a'),block('b',1,'b')]);assert.throws(()=>validate(d),/reading order/);d.blocks[1].order=1;assert.doesNotThrow(()=>validate(d));});
test('unresolved unreadable page can coexist with completed readable pages',()=>{const d=doc([block('a',1,'Readable')],[page(1),{...page(2,'unreadable'),unresolved:[{description:'Illegible scan',blockId:null}]}]);const a=assembleSourceIngestionDocument(d,{extractionId:'v'});assert.equal(a.document.pages[1].state,'unreadable');assert.equal(a.text.includes('Illegible scan'),false);});
test('table dimensions, cells and ambiguous footnotes survive authoritative assembly',()=>{const d=doc([block('t',1,'a | b','table'),block('c',1,'Callout 1','paragraph',1),block('f',1,'Note','footnote',2)]);d.blocks[0].table={rows:1,columns:2,cells:[{row:0,column:0,rowSpan:1,columnSpan:2,text:'a | b'}]};d.relations=[{kind:'footnote-callout',from:'c',to:'f',uncertain:true}];const a=assembleSourceIngestionDocument(d,{extractionId:'v'});assert.deepEqual(a.document.blocks[0].table,d.blocks[0].table);assert.equal(a.relations[0].uncertain,true);assert.match(a.relations[0].to,/ingestion-v-/);});
test('overlapping or out-of-bounds table spans are rejected',()=>{const d=doc([block('t',1,'table','table')]);d.blocks[0].table={rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:2,text:'bad'}]};assert.throws(()=>validate(d),/outside dimensions/);});
test('approximate geometry cannot assert exact native provenance',()=>{const d=doc();d.blocks[0].location={x:0,y:0,width:1,height:1,accuracy:'native'};assert.throws(()=>validate(d),/unsupported value|invalid nullable/);});
test('heading hierarchy and continuation are bounded acyclic references',()=>{const d=doc([block('a',1,'A','heading',0),block('b',1,'B','heading',1)]);d.relations=[{kind:'heading-parent',from:'a',to:'b',uncertain:false}];assert.throws(()=>validate(d),/hierarchy/);d.relations=[];d.blocks[0].continues='b';assert.throws(()=>validate(d),/backwards/);});
test('window planning fits reserved output and uses fewer pages for Deep',()=>{const b=planSourceIngestionWindows({pageCount:42,depth:'balanced',maxOutputTokens:64000});const d=planSourceIngestionWindows({pageCount:42,depth:'deep',maxOutputTokens:64000});assert.equal(b.flatMap(w=>w.ownedPages).length,42);assert.ok(d.length>b.length);assert.deepEqual(b[1].contextPages,[8]);assert.ok(b.every(w=>w.estimatedOutputTokens<=64000));});
test('clean short Balanced document uses one complete owned-page window',()=>{assert.equal(planSourceIngestionWindows({pageCount:2,depth:'balanced',maxOutputTokens:32000}).length,1);});
test('windows merge deterministic namespaced blocks and reject missing or duplicate work',()=>{const first={index:0,document:doc([block('same',1,'one')],[page(1)])},second={index:1,document:doc([block('same',2,'two')],[page(2)])};const merged=mergeSourceIngestionWindows([second,first],2);assert.deepEqual(merged.blocks.map(b=>b.id),['w0:same','w1:same']);assert.throws(()=>mergeSourceIngestionWindows([first],2),/Missing/);assert.throws(()=>mergeSourceIngestionWindows([first,first],2),/Duplicate/);});
test('context pages do not permit duplicate owned output',()=>{const d=doc();d.pages.push({...page(2),role:'context'});d.blocks.push(block('bad',2,'Context'));assert.throws(()=>validate(d),/Context page/);});

test('targeted findings retain cross-window footnote ambiguity and native text anomalies honestly',async()=>{
 const {sourceIngestionRepairFindings}=await import('../src/server/modules/source-ingestion-validation.ts');
 const d=doc([block('a',1,'A continuing footnote','footnote'),block('b',2,'more footnote text','footnote')],[page(1),page(2)]);
 const findings=sourceIngestionRepairFindings(d,{windowBoundaries:[2],nativePages:[{page:1,text:Array.from({length:30},(_,i)=>`word${i}`).join(' '),extractor:'synthetic-native-fixture'}]});
 assert.ok(findings.some(f=>f.kind==='window-boundary'&&f.blockIds.join(',')==='a,b'));assert.ok(findings.some(f=>f.kind==='native-text-anomaly'));assert.ok(findings.every(f=>f.independentVerification===false));assert.deepEqual(d.relations,[]);
});
test('context manifest is bounded frozen provisional evidence, excluding provider tools',async()=>{
 const {sourceIngestionContextManifest}=await import('../src/server/modules/source-ingestion-planner.ts');const manifest=sourceIngestionContextManifest({title:'X'.repeat(1000),sections:Array.from({length:100},(_,i)=>({page:i+1,title:'A'}))});assert.equal(manifest.title.length,512);assert.equal(manifest.sections.length,64);assert.equal(manifest.provisional,true);assert.ok(Object.isFrozen(manifest));
});
test('small rich table is one passage; local page markers are not semantic embedding prose',async()=>{
 const {chunkSource}=await import('../src/server/modules/source-passages.ts');
 const d=doc([block('a',1,'Introduction.'),{...block('t',1,Array.from({length:80},(_,i)=>`cell ${i} | value`).join('\n'),'table',1),table:{rows:80,columns:1,cells:[]}},block('b',2,'After the table.')],[page(1),page(2)]);
 const a=assembleSourceIngestionDocument(d,{extractionId:'passages'});
 const file={id:'f',entity_id:'e',vault_id:'v',text:a.text,format:'pdf',pages:2,page_start_lines:JSON.stringify(a.pageStartLines),structural_nodes:JSON.stringify(a.structuralNodes)};
 const lines=a.text.split('\n'),starts=[];let at=0;for(const line of lines){starts.push(at);at+=line.length+1;}
 const rich={semantic:{children:a.semanticNodes},physical:{pages:a.pageStartLines.map((line,i)=>({number:i+1,range:{startOffset:starts[line-1]}}))},ingestion:{documentId:'d'}};
 const passages=chunkSource(file,'g',undefined,rich);assert.ok(passages.every(p=>!p.text.includes('<!-- Page')));const tablePassages=passages.filter(p=>p.text.includes('cell'));assert.equal(tablePassages.length,1);assert.equal(tablePassages[0].text,d.blocks[1].text);for(const p of passages)assert.equal(a.text.slice(p.start_offset,p.end_offset),p.text);
});
