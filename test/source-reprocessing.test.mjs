import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materializeSourceRevision,editorialPatchRisk,SourceReprocessing} from '../src/server/modules/source-reprocessing.ts';
import {pageBoundaryDiagnostics} from '../src/server/modules/source-reprocessing-diagnostics.ts';
import {sourceDocumentEntries} from '../src/shared/source-document.ts';
// Recorded live PDF regression; derived output is rebuilt, never trusted as the expected result.
const fixture=()=>{const r=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));r.reprocessed=structuredClone(r.original);return r;};
const headings=r=>sourceDocumentEntries(r.document).filter(({node})=>node.kind==='chapter');
test('saved Dante formatting patch preserves Introduction and all six structural sections',()=>{
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));assert.equal(r.patches.length,1);r.patches[0].decision='accepted';
 materializeSourceRevision(r);
 assert.equal(headings(r.original).length,6);assert.equal(headings(r.reprocessed).length,6);
 const intro=headings(r.reprocessed).find(({node})=>node.title.includes('Introduction'));assert.ok(intro);
 assert.ok(r.nodeLinks.find(link=>link.originalNodeId===headings(r.original)[0].node.id).reprocessedNodeIds.includes(intro.node.id));
});
test('saved accepted revision is blocked when page delimiters would become inline',()=>{
 assert.throws(()=>materializeSourceRevision(fixture()),/page marker.*own line/i);
 assert.equal(pageBoundaryDiagnostics('<!-- Page 1 -->\ntext','<!-- Page 1 -->text').length,1);
});
test('custom replacements get identical global page-boundary validation',()=>{
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));
 r.patches[0].decision='accepted';r.patches[0].userReplacement=r.patches[0].replacement+'<!-- Page 99 -->';
 assert.throws(()=>materializeSourceRevision(r),/page markers differ/i);
});
test('model confidence cannot auto-approve quotations, gaps, deletions, or headings',()=>{
 for(const [a,b,c,structure] of [['“an historically extended”','“a historically extended”','ocr',false],['New York:','New York: [publication details incomplete in source]','citation',false],['header','', 'apparatus',false],['1. Introduction','1.  Introduction','formatting',true]])assert.ok(editorialPatchRisk(a,b,c,structure).length);
 assert.deepEqual(editorialPatchRisk('Two  spaces','Two spaces','formatting',false),[]);
 assert.ok(editorialPatchRisk('one\ntwo','one two','line_breaks',false).length);
 assert.ok(editorialPatchRisk('    code',' code','formatting',false).length);
 assert.ok(editorialPatchRisk('**two  words**','**two words**','formatting',false).length);
});
test('resume skips completed excerpts and preserves their checkpoint coverage',async()=>{
 const r=fixture();r.patches=[];r.status='interrupted';r.report.promptVersion='source-editorial-beta-3';r.report.chunksCompleted=4;r.report.charactersReviewed=r.original.document.physical.pages[4].range.startOffset;
 let stored=structuredClone(r),calls=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model}),reeditSource:async()=>{calls++;return '{"patches":[]}';}},()=>{}, {start:()=>1,finish:()=>{}});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;
 service.resume('v',r.fileId,r.id);
 store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(calls,1);assert.equal(stored.status,'completed');assert.equal(stored.report.chunksCompleted,5);assert.equal(stored.report.charactersReviewed,r.original.text.length);
});
test('Review all keeps confidence-1 formatting pending during actual execution',async()=>{
 const r=fixture();r.patches=[];r.status='queued';r.acceptanceMode='review_all';r.acceptanceThreshold=1;r.report.chunksCompleted=0;r.report.charactersReviewed=0;
 let stored=structuredClone(r),calls=0;
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model}),reeditSource:async()=>{calls++;return JSON.stringify({patches:calls===1?[{original:'Religions 2019, 10, 372',replacement:'Religions  2019, 10, 372',category:'formatting',reason:'Spacing',confidence:1}]:[]});}},()=>{}, {start:()=>1,finish:()=>{}});
 service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 await service.tick();assert.equal(stored.status,'completed');assert.equal(stored.patches.length,1);assert.equal(stored.patches[0].decision,'pending');assert.equal(stored.reprocessed.text,r.original.text);
});
test('cancellation aborts in-flight output and resumes only after worker settles',async()=>{
 const r=fixture();r.patches=[];r.status='queued';r.report.promptVersion='source-editorial-beta-3';r.report.chunksCompleted=4;r.report.charactersReviewed=r.original.document.physical.pages[4].range.startOffset;
 let stored=structuredClone(r),entered,release;
 const inFlight=new Promise(resolve=>{entered=resolve;});
 const store={all:()=>[],run:(_sql,status,_at,payload)=>{stored=JSON.parse(payload);},get:()=>undefined};
 const service=new SourceReprocessing(store,{require:()=>({entity_id:'test'})},{selection:()=>({model:r.report.model}),reeditSource:async()=>{entered();return new Promise(resolve=>{release=()=>resolve('{"patches":[]}');});}},()=>{}, {start:()=>1,finish:()=>{}});
 service.detail=()=>structuredClone(stored);service.baseHash=()=>r.baseHash;store.all=()=>stored.status==='queued'?[{vault_id:'v',payload:JSON.stringify(stored)}]:[];
 const work=service.tick();await inFlight;service.cancel('v',r.fileId,r.id);
 assert.throws(()=>service.resume('v',r.fileId,r.id),/interruption/);
 release();await work;assert.equal(stored.status,'interrupted');assert.equal(stored.report.chunksCompleted,4);
 service.resume('v',r.fileId,r.id);assert.equal(stored.status,'queued');
});
test('backup roundtrip retains review mode, threshold, and patch risk evidence',async()=>{
 const {restoreSourceRevision}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const r=fixture();r.patches=r.patches.filter(p=>p.original.includes('1. Introduction'));r.patches[0].decision='pending';r.patches[0].riskReasons=['Touches a structural heading.'];r.acceptanceMode='review_all';r.acceptanceThreshold=1;
 const restored=restoreSourceRevision(r,r.id,r.fileId,'restored-revision','restored-file');
 assert.equal(restored.acceptanceMode,'review_all');assert.equal(restored.acceptanceThreshold,1);assert.deepEqual(restored.patches[0].riskReasons,r.patches[0].riskReasons);
});
