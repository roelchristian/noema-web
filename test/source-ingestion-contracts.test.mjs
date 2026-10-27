import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceIngestionDocument,normalizeSourceIngestionCandidate,SOURCE_INGESTION_JSON_SCHEMA} from '../src/server/modules/source-ingestion-validation.ts';
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


test('provider complete one-based table grids normalize without mutating raw response',()=>{
 const d=doc([block('t',1,'A B','table')]);d.blocks[0].table={rows:1,columns:2,cells:[{row:1,column:1,rowSpan:1,columnSpan:1,text:'A'},{row:1,column:2,rowSpan:1,columnSpan:1,text:'B'}]};
 assert.throws(()=>validate(d),/outside dimensions/);const normalized=normalizeSourceIngestionCandidate(d);assert.doesNotThrow(()=>validate(normalized));assert.deepEqual(normalized.blocks[0].table.cells.map(c=>[c.row,c.column]),[[0,0],[0,1]]);assert.equal(normalized.blocks[0].text,'A B');assert.match(normalized.blocks[0].uncertainty,/one-based/);assert.equal(d.blocks[0].table.cells[0].row,1);
});
test('malformed optional table geometry preserves plain transcription and all cell-only text',()=>{
 for(const table of [
  {rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:2,text:'Unique notification recipient'}]},
  {rows:2,columns:2,cells:[{row:0,column:0,rowSpan:2,columnSpan:2,text:'A'},{row:0,column:0,rowSpan:1,columnSpan:1,text:'B'}]},
  {rows:0,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'Additional text'}]},
 ]){
  const d=doc([block('t',1,'Original transcription','table')]);d.blocks[0].table=table;
  const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.blocks[0].table,null);assert.ok(normalized.blocks[0].text.startsWith('Original transcription'));for(const cell of table.cells)assert.ok(normalized.blocks[0].text.includes(cell.text));assert.match(normalized.blocks[0].uncertainty,/layout was inconsistent/);assert.doesNotThrow(()=>validate(normalized));assert.equal(assembleSourceIngestionDocument(normalized,{extractionId:'fallback'}).document.blocks[0].table,null);
 }
});
test('valid sparse zero-based grids are retained; ambiguous sparse one-based grids fall back honestly',()=>{
 const d=doc([block('t',1,'Cell','table')]);d.blocks[0].table={rows:2,columns:2,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'Cell'}]};assert.deepEqual(normalizeSourceIngestionCandidate(d),d);
 d.blocks[0].table.cells[0]={row:2,column:2,rowSpan:1,columnSpan:1,text:'Cell'};const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.blocks[0].table,null);assert.match(normalized.blocks[0].uncertainty,/inconsistent/);
});
test('inconsistent continuation hints cannot discard readable blocks or fail table layout fallback',()=>{
 const d=doc([block('a',1,'First','table'),{...block('b',1,'Second','table',1),continues:'a'},block('c',1,'Third','paragraph',2)]);
 d.blocks[0].table={rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:2,text:'First'}]};d.blocks[1].table={rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'Second'}]};d.relations=[{kind:'table-continuation',from:'a',to:'b',uncertain:false},{kind:'continuation',from:'b',to:'c',uncertain:false}];
 const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.blocks[1].continues,null);assert.deepEqual(normalized.relations,[]);assert.deepEqual(normalized.blocks.map(b=>b.text),['First','Second','Third']);assert.match(normalized.blocks[1].uncertainty,/continuation/);assert.doesNotThrow(()=>validate(normalized));
});
test('provider normalization leaves ownership, unknown references, controls and schema errors strict',()=>{
 const unknown=doc([{...block('a',1,'First'),continues:'unknown'}]);assert.throws(()=>validate(normalizeSourceIngestionCandidate(unknown)),/Unknown block/);
 const wrongPage=doc([block('a',2,'Wrong page')]);assert.throws(()=>validate(normalizeSourceIngestionCandidate(wrongPage)),/Context page/);
 const marker=doc([block('a',1,'<!-- Page 2 -->')]);assert.throws(()=>validate(normalizeSourceIngestionCandidate(marker)),/markers/);
 const unexpected=doc();unexpected.extra=true;assert.throws(()=>normalizeSourceIngestionCandidate(unexpected),/unexpected field/);
});


test('table fallback retains repeated and substring cell-only values in supplied order',()=>{
 const d=doc([block('t',1,'','table')]);d.blocks[0].table={rows:0,columns:1,cells:['Yes','Yes','Long value','value'].map(text=>({row:0,column:0,rowSpan:1,columnSpan:1,text}))};
 const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.blocks[0].text,'Yes\nYes\nLong value\nvalue');assert.doesNotThrow(()=>validate(normalized));assert.equal(d.blocks[0].text,'');
 d.blocks[0].text='Yes';d.blocks[0].table.cells=d.blocks[0].table.cells.slice(0,2);assert.equal(normalizeSourceIngestionCandidate(d).blocks[0].text,'Yes\nYes');
 d.blocks[0].text='Long value';d.blocks[0].table.cells=['Long value','value'].map(text=>({row:0,column:0,rowSpan:1,columnSpan:1,text}));assert.equal(normalizeSourceIngestionCandidate(d).blocks[0].text,'Long value\nvalue');
});

test('all optional relationship kinds recover from incompatible known endpoints without changing text',()=>{
 for(const kind of ['heading-parent','statement-proof','caption','footnote-callout','bibliography','table-continuation','continuation']){
  const d=doc([block('a',1,'First','heading'),block('b',1,'Second','paragraph',1)]);d.relations=[{kind,from:'a',to:'b',uncertain:false}];
  const normalized=normalizeSourceIngestionCandidate(d);assert.deepEqual(normalized.relations,[],kind);assert.deepEqual(normalized.blocks.map(b=>b.text),['First','Second']);assert.match(normalized.blocks[0].uncertainty,/relation was omitted/);assert.doesNotThrow(()=>validate(normalized));
 }
});
test('duplicate, self and cyclic optional relations cannot fail readable provider text',()=>{
 const d=doc([block('a',1,'First','paragraph'),block('b',1,'Second','paragraph',1)]);d.relations=[{kind:'continuation',from:'a',to:'b',uncertain:false},{kind:'continuation',from:'a',to:'b',uncertain:false},{kind:'continuation',from:'b',to:'a',uncertain:false},{kind:'continuation',from:'a',to:'a',uncertain:false}];
 const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.relations.length,1);assert.doesNotThrow(()=>validate(normalized));assert.match(normalized.blocks[0].uncertainty,/requires review/);
 const h=doc([block('a',1,'Parent','heading'),{...block('b',1,'Child','heading',1),headingLevel:2}]);h.relations=[{kind:'heading-parent',from:'a',to:'b',uncertain:false},{kind:'heading-parent',from:'b',to:'a',uncertain:false}];assert.doesNotThrow(()=>validate(normalizeSourceIngestionCandidate(h)));
});
test('contradictory optional hierarchy and definite footnote links do not select arbitrary winners',()=>{
 const h=doc([block('a',1,'Parent one','heading'),block('b',1,'Parent two','heading',1),{...block('c',1,'Child','heading',2),headingLevel:2}]);h.relations=[{kind:'heading-parent',from:'c',to:'a',uncertain:false},{kind:'heading-parent',from:'c',to:'b',uncertain:false}];const normalized=normalizeSourceIngestionCandidate(h);assert.deepEqual(normalized.relations,[]);assert.match(normalized.blocks[2].uncertainty,/Conflicting/);assert.doesNotThrow(()=>validate(normalized));
 const f=doc([block('a',1,'Callout'),block('b',1,'Footnote one','footnote',1),block('c',1,'Footnote two','footnote',2)]);f.relations=[{kind:'footnote-callout',from:'a',to:'b',uncertain:false},{kind:'footnote-callout',from:'a',to:'c',uncertain:false}];const footnotes=normalizeSourceIngestionCandidate(f);assert.ok(footnotes.relations.every(r=>r.uncertain));assert.doesNotThrow(()=>validate(footnotes));
});
test('contradictory table continuation successors and predecessors are explicitly uncertain',()=>{
 const d=doc(['a','b','c'].map((id,i)=>({...block(id,1,id,'table',i),table:{rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:id}]}})));d.relations=[{kind:'table-continuation',from:'a',to:'b',uncertain:false},{kind:'table-continuation',from:'a',to:'c',uncertain:false},{kind:'table-continuation',from:'b',to:'c',uncertain:false}];const normalized=normalizeSourceIngestionCandidate(d);assert.ok(normalized.relations.every(r=>r.uncertain));assert.doesNotThrow(()=>validate(normalized));
});
test('optional invalid heading and location hints preserve readable text with uncertainty',()=>{
 const d=doc([{...block('a',1,'Heading without level','heading'),headingLevel:null,location:{x:0.9,y:0,width:0.5,height:1,accuracy:'approximate'}},{...block('b',1,'Paragraph with heading level','paragraph',1),headingLevel:8}]);const normalized=normalizeSourceIngestionCandidate(d);assert.deepEqual(normalized.blocks.map(b=>[b.kind,b.headingLevel,b.location]),[['paragraph',null,null],['paragraph',null,null]]);assert.deepEqual(normalized.blocks.map(b=>b.text),d.blocks.map(b=>b.text));assert.ok(normalized.blocks.every(b=>b.uncertainty));assert.doesNotThrow(()=>validate(normalized));
});
test('invalid optional repair spans are omitted; original Unicode text and valid repairs survive',()=>{
 const d=doc();d.repairs=[{blockId:'a',start:0,end:1,original:'wrong',replacement:'x',category:'ocr',reason:'x'},{blockId:'a',start:11,end:12,original:'\ud83d',replacement:'x',category:'ocr',reason:'x'},{blockId:'a',start:0,end:1,original:'A',replacement:'The',category:'ocr',reason:'x'}];const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.repairs.length,1);assert.equal(normalized.blocks[0].text,d.blocks[0].text);assert.match(normalized.blocks[0].uncertainty,/repair suggestion/);assert.doesNotThrow(()=>validate(normalized));
 d.repairs=[{...d.repairs[0],blockId:'unknown'}];assert.throws(()=>validate(normalizeSourceIngestionCandidate(d)),/Unknown block/);
});
test('mismatched optional metadata evidence is omitted with review uncertainty; unknown IDs stay strict',()=>{
 const d=doc();d.metadata.contributors=[{name:'Claimed Author',role:'author',page:2,blockId:'a'}];d.metadata.bibliographic=[{field:'title',value:'Claimed title',page:2,blockId:null}];const normalized=normalizeSourceIngestionCandidate(d);assert.deepEqual(normalized.metadata.contributors,[]);assert.deepEqual(normalized.metadata.bibliographic,[]);assert.match(normalized.blocks[0].uncertainty,/metadata evidence/);assert.match(normalized.pages[0].unresolved[0].description,/metadata evidence/);assert.doesNotThrow(()=>validate(normalized));
 d.metadata.contributors[0].blockId='unknown';d.metadata.contributors[0].page=1;assert.throws(()=>validate(normalizeSourceIngestionCandidate(d)),/Unknown block/);
});


test('table fallback cannot make an originally invalid repair valid by appending cell-only text',()=>{
 const d=doc([block('t',1,'A','table')]);d.blocks[0].table={rows:0,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,text:'B'}]};d.repairs=[{blockId:'t',start:2,end:3,original:'B',replacement:'changed',category:'ocr',reason:'x'},{blockId:'t',start:0,end:1,original:'A',replacement:'valid',category:'ocr',reason:'x'}];const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.blocks[0].text,'A\nB');assert.equal(normalized.repairs.length,1);assert.equal(normalized.repairs[0].original,'A');assert.doesNotThrow(()=>validate(normalized));
});

test('optional repair categories and replacement constraints match editorial publication',()=>{
 const d=doc([block('a',1,'A')]);const base={blockId:'a',start:0,end:1,original:'A',replacement:'B',category:'ocr',reason:'Evidence'};
 for(const change of [{category:'possible source typo'},{replacement:'A'},{replacement:'\ud800'},{replacement:'<!-- Page 5 -->'},{replacement:'B'.repeat(16001)}]){
  d.repairs=[{...base,...change}];const normalized=normalizeSourceIngestionCandidate(d);assert.deepEqual(normalized.repairs,[]);assert.equal(normalized.blocks[0].text,'A');assert.match(normalized.blocks[0].uncertainty,/editorial review constraints/);assert.doesNotThrow(()=>validate(normalized));
 }
 for(const category of ['ocr','line_breaks','footnote','apparatus','metadata','citation','math','formatting']){d.repairs=[{...base,category}];assert.equal(normalizeSourceIngestionCandidate(d).repairs.length,1);}
 d.blocks[0].text='A'.repeat(16001);d.repairs=[{...base,end:16001,original:d.blocks[0].text}];assert.deepEqual(normalizeSourceIngestionCandidate(d).repairs,[]);
});
test('optional overlapping repair groups are omitted together while adjacent edits survive',()=>{
 const d=doc([block('a',1,'abcdefghij')]);const repair=(start,end)=>({blockId:'a',start,end,original:d.blocks[0].text.slice(start,end),replacement:'X',category:'ocr',reason:'Evidence'});d.repairs=[repair(0,3),repair(2,4),repair(3,6),repair(6,7),repair(7,8)];const normalized=normalizeSourceIngestionCandidate(d);assert.deepEqual(normalized.repairs.map(r=>[r.start,r.end]),[[6,7],[7,8]]);assert.match(normalized.blocks[0].uncertainty,/Overlapping/);assert.equal(normalized.blocks[0].text,'abcdefghij');assert.doesNotThrow(()=>validate(normalized));
});
test('optional repair review budget is bounded without hiding unknown references',()=>{
 const d=doc([block('a',1,'a '.repeat(6401))]);d.repairs=Array.from({length:6401},(_,i)=>({blockId:'a',start:i*2,end:i*2+1,original:'a',replacement:'b',category:'ocr',reason:'Evidence'}));d.repairs.push({blockId:'unknown',start:0,end:1,original:'a',replacement:'b',category:'ocr',reason:'Evidence'});const normalized=normalizeSourceIngestionCandidate(d);assert.equal(normalized.repairs.length,6401);assert.equal(normalized.repairs.at(-1).blockId,'unknown');assert.match(normalized.blocks[0].uncertainty,/6400-item/);assert.throws(()=>validate(normalized),/Unknown block/);
});


test('optional repair reasons beyond the backup-compatible limit are omitted without changing source text',()=>{
 const d=doc([block('a',1,'A')]);d.repairs=[{blockId:'a',start:0,end:1,original:'A',replacement:'B',category:'ocr',reason:'R'.repeat(2001)}];const normalized=normalizeSourceIngestionCandidate(d);assert.deepEqual(normalized.repairs,[]);assert.equal(normalized.blocks[0].text,'A');assert.match(normalized.blocks[0].uncertainty,/editorial review constraints/);d.repairs[0].reason='R'.repeat(2000);assert.equal(normalizeSourceIngestionCandidate(d).repairs.length,1);
});

test('reader hierarchy adds section context while retaining every immutable text leaf',async()=>{
 const {sourceIngestionSemanticTree}=await import('../src/server/modules/source-ingestion-assembly.ts');
 const d=doc([block('h1',1,'First','heading',0),block('a',1,'Body','paragraph',1),{...block('h2',1,'Child','heading',2),headingLevel:2},block('b',1,'Nested body','paragraph',3),block('h3',1,'Next','heading',4)]);
 const a=assembleSourceIngestionDocument(d,{extractionId:'tree'}),tree=sourceIngestionSemanticTree(a.semanticNodes,a.relations);
 assert.equal(tree.length,2);assert.equal(tree[0].title,'First');assert.equal(tree[0].children[2].title,'Child');
 const leaves=[];const walk=nodes=>{for(const node of nodes){if(node.text!==undefined)leaves.push(node);if(node.children)walk(node.children);}};walk(tree);
 assert.deepEqual(leaves,a.semanticNodes);assert.equal(tree[0].range.endOffset,a.semanticNodes[3].range.endOffset);assert.equal(tree[0].children[2].range.startOffset,a.semanticNodes[2].range.startOffset);
 assert.deepEqual(a.semanticNodes.map(node=>node.children),[undefined,undefined,undefined,undefined,undefined]);
});

test('complete enrichment overlay projects annotations while rejecting partial or text-changing candidates',async()=>{
 const {resolveSourceIngestionAssembly}=await import('../src/server/modules/source-ingestion-document.ts');
 const d=doc([block('a',1,'Unchanged first page')],[page(1),page(2)]);d.blocks.push(block('b',2,'Unchanged second page'));
 const baseline=assembleSourceIngestionDocument({...d,blocks:d.blocks.map(b=>({...b,id:'w'+(b.page-1)+':'+b.id})),relations:[{kind:'continuation',from:'w0:a',to:'w1:b',uncertain:false}]},{extractionId:'overlay'});
 const scope=number=>JSON.stringify({ownedPages:[number]});
 const extraction=[1,2].map(number=>({kind:'extraction',ordinal:number-1,plan_json:scope(number),result_json:null}));
 const annotated=number=>doc([block(number===1?'a':'b',number,number===1?'Unchanged first page':'Unchanged second page')],[page(number)]);
 const first=annotated(1),second=annotated(2);first.metadata.title='Annotated title';first.blocks[0].uncertainty='Supported annotation';
 const enrichment=[{kind:'enrichment',ordinal:3,plan_json:scope(1),result_json:JSON.stringify(first)},{kind:'enrichment',ordinal:4,plan_json:scope(2),result_json:JSON.stringify(second)}];
 let rows=[...extraction,enrichment[0]];const store={get:()=>({id:'overlay',assembly_json:JSON.stringify(baseline)}),all:()=>rows};const file={id:'f',vault_id:'v'};
 assert.deepEqual(resolveSourceIngestionAssembly(store,file),baseline,'Partial enrichment cannot change the reading');
 rows=[...extraction.map((window,index)=>({...window,ordinal:index===0?1:3})),...enrichment];const projected=resolveSourceIngestionAssembly(store,file);assert.equal(projected.document.metadata.title,'Annotated title');assert.equal(projected.text,baseline.text);assert.deepEqual(projected.document.relations,baseline.document.relations);assert.deepEqual(projected.blockRanges.map(b=>[b.id,b.range]),baseline.blockRanges.map(b=>[b.id,b.range]));
 second.blocks[0].text='Changed text';rows=[...extraction,enrichment[0],{...enrichment[1],result_json:JSON.stringify(second)}];assert.deepEqual(resolveSourceIngestionAssembly(store,file),baseline,'Text-changing enrichment is rejected');
});
