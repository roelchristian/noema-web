import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceIngestionVisualEvidence,validateSourceIngestionVisualEvidence} from '../src/server/modules/source-ingestion-visual-evidence.ts';
const block=(id,page,location)=>({id,page,order:0,kind:'equation',text:'$H$ and $\\bar{H}$',headingLevel:null,continues:null,table:null,uncertainty:'Small overline unclear',location});
const rect={x:.2,y:.3,width:.4,height:.1,accuracy:'approximate'};
function fixture(){return {pdf:Buffer.from('admitted-pdf-window'),pageMap:[1,2],document:{schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[1,2].map(number=>({number,printedLabel:null,role:'owned',state:'content',unresolved:[]})),blocks:[block('context',1,rect),block('owned',2,rect)],relations:[],repairs:[]},plan:{index:1,ownedPages:[2],contextPages:[1],estimatedOutputTokens:4000},options:{route:'openai',model:'gpt-6.1-sol',depth:'balanced',budget:{maxOutputTokens:32000}},signal:new AbortController().signal};}
test('visual evidence keeps full page mapping and selects owned bounded crops with margins',async()=>{
 const input=fixture(),before=structuredClone(input.document);let request;
 const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:async(bytes,regions,signal)=>{request={bytes,regions,signal};return Buffer.from('context-plus-crop');}},input);
 assert.equal(request.bytes,input.pdf);assert.deepEqual(result.pageMap,[1,2]);assert.equal(request.regions[0].page,2);assert.equal(request.regions.length,1);
 assert.ok(Math.abs(request.regions[0].rect.x-.18)<1e-12);assert.ok(Math.abs(request.regions[0].rect.y-.28)<1e-12);
 assert.ok(request.regions[0].rect.width>.4);assert.ok(request.regions[0].rect.height>.1);
 assert.equal(result.evidence.crops[0].blockId,'owned');assert.equal(result.evidence.crops[0].physicalPage,2);assert.equal(result.evidence.crops[0].accuracy,'approximate');assert.equal(result.evidence.fallback,'none');
 assert.equal(result.bytes.toString(),'context-plus-crop');assert.deepEqual(input.document,before);assert.deepEqual(validateSourceIngestionVisualEvidence(result.evidence),result.evidence);
});
test('missing, invalid or layout-only geometry uses unchanged full PDF without rendering',async()=>{
 for(const location of [null,{...rect,x:100},{...rect,width:-1}]){
  const input=fixture();input.document.blocks[1].location=location;
  const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:()=>{throw Error('Should not render');}},input);
  assert.equal(result.bytes,input.pdf);assert.equal(result.evidence.fallback,'no-valid-geometry');assert.deepEqual(result.evidence.crops,[]);
 }
 const input=fixture();input.document.blocks[1].uncertainty=null;input.document.blocks[1].layoutWarnings=['Approximate placement'];
 const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:()=>{throw Error('Should not render');}},input);
 assert.equal(result.bytes,input.pdf);assert.equal(result.evidence.fallback,'no-valid-geometry');
});
test('visual preparation caps crops at four owned physical pages and keeps one per page',async()=>{
 const input=fixture();input.pageMap=[1,2,3,4,5,6];input.plan.ownedPages=input.pageMap;input.plan.contextPages=[];
 input.document.pages=input.pageMap.map(number=>({number,printedLabel:null,role:'owned',state:'content',unresolved:[]}));input.document.blocks=input.pageMap.flatMap(page=>[block('b'+page,page,rect),block('extra'+page,page,rect)]);
 const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:async(bytes,regions)=>{assert.equal(regions.length,4);return bytes;}},input);
 assert.deepEqual(result.evidence.crops.map(crop=>crop.physicalPage),[1,2,3,4]);assert.deepEqual(result.pageMap,input.pageMap);
});
test('renderer failure falls back to original full context, cancellation propagates',async()=>{
 const input=fixture();const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:async()=>{throw Error('Renderer unavailable');}},input);
 assert.equal(result.bytes,input.pdf);assert.equal(result.evidence.fallback,'render-unavailable');assert.deepEqual(result.evidence.crops,[]);
 const controller=new AbortController();input.signal=controller.signal;
 await assert.rejects(()=>prepareSourceIngestionVisualEvidence({renderRepairEvidence:async()=>{controller.abort();throw Error('Cancelled');}},input),error=>error.name==='AbortError');
});
test('persisted visual evidence strictly validates dimensions, ownership, version and bounded shape',async()=>{
 const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:async bytes=>bytes},fixture());
 for(const mutate of [v=>v.version=2,v=>v.algorithm='unrecorded',v=>v.crops[0].rect.width=2,v=>v.crops[0].physicalPage=1,v=>v.crops.push(v.crops[0]),v=>v.apiKey='no',v=>v.crops[0].rect.native=true,v=>v.fallback='render-unavailable']){
  const value=structuredClone(result.evidence);mutate(value);assert.throws(()=>validateSourceIngestionVisualEvidence(value),/Invalid visual/);
 }
});

test('portable visual PDF keeps page count, full context and unchanged unselected pages',async()=>{
 const {PDFDocument}=await import('pdf-lib');const {PdfPlatform}=await import('../src/server/modules/pdf-platform.ts');
 const pdf=await PDFDocument.create();pdf.addPage([200,300]).drawText('Source H and decorated H',{x:20,y:240,size:10});pdf.addPage([200,300]).drawText('Unselected context',{x:20,y:240,size:10});
 const bytes=Buffer.from(await pdf.save({useObjectStreams:false})),platform=new PdfPlatform();
 const output=await platform.renderRepairEvidence(bytes,[{page:1,rect:{x:.05,y:.1,width:.8,height:.2}}]);
 const result=await PDFDocument.load(output);assert.equal(result.getPageCount(),2);assert.equal(result.getPage(0).getWidth(),420);assert.equal(result.getPage(0).getHeight(),300);assert.equal(result.getPage(1).getWidth(),200);
 // Two embedded image XObjects retain the complete context and magnified crop.
 const {PDFName}=await import('pdf-lib');const resources=result.getPage(0).node.Resources();const images=resources.lookup(PDFName.of('XObject'));assert.equal(images.keys().length,2);
 assert.notDeepEqual(output,bytes);await assert.rejects(()=>platform.renderRepairEvidence(bytes,[{page:1,rect:{x:0,y:0,width:2,height:1}}]),/Invalid bounded/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>platform.renderRepairEvidence(bytes,[{page:1,rect:{x:0,y:0,width:.5,height:.5}}],controller.signal),/stopped/);
});
test('expanded visual PDFs preflight the selected provider context guard before falling back to original bytes',async()=>{
 for(const [provider,model,oversized] of [['openai','gpt-6.1-sol',600_000],['gemini','gemini-3.8-flash',2_200_000]]){
  const input=fixture();input.options.route=provider;input.options.model=model;
  const result=await prepareSourceIngestionVisualEvidence({renderRepairEvidence:async()=>Buffer.alloc(oversized)},input);
  assert.equal(result.bytes,input.pdf);assert.equal(result.evidence.fallback,'input-budget');assert.deepEqual(result.evidence.crops,[]);assert.deepEqual(result.pageMap,input.pageMap);
  assert.deepEqual(validateSourceIngestionVisualEvidence(result.evidence),result.evidence);
 }
});
test('crop preflight does not disguise invalid model selection as a renderer fallback',async()=>{
 const input=fixture();input.options.model='unavailable';
 await assert.rejects(()=>prepareSourceIngestionVisualEvidence({renderRepairEvidence:async()=>Buffer.from('raster')},input),error=>error.code==='model_unavailable');
});
