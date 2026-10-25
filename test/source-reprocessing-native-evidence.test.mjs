import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceReprocessingEvidence} from '../src/server/modules/source-reprocessing-evidence.ts';
import {evaluateV2Acceptance} from '../src/server/modules/source-reprocessing-risk.ts';
import {NativeReprocessingOCR,validateOCRResult} from '../src/server/modules/source-reprocessing-native-evidence.ts';
import {SourcePageImages} from '../src/server/modules/source-page-images.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('sandboxed native OCR initializes its private model cache and recognizes a rendered PDF',{
 skip:process.platform!=='darwin'||process.env.NOEMA_NATIVE_TESTS!=='1',timeout:450000,
},async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'noema-native-evidence-test-'));
 const filename=fileURLToPath(new URL('./fixtures/source-sanitizer/active-with-visible-annotation.pdf',import.meta.url));
 const images=new SourcePageImages({root:directory,require:()=>({admitted:1,status:'ready',format:'pdf',pages:1}),filename:()=>filename});
 const ocr=new NativeReprocessingOCR();
 try{
  const image=await images.get('v','f',1);
  const result=await ocr.recognize(image,new AbortController().signal);
  assert.equal(result.engine,'AppleVision');
  assert.ok(result.lines.some(line=>line.text.trim()),'the rendered page must produce real OCR text');
 }finally{ocr.close();images.close();rmSync(directory,{recursive:true,force:true});}
});
const text='alpha\nbeta';
function setup(method='native'){
 let count=0,rendered=0,hash='a'.repeat(64);const file={id:'f',format:'pdf',admitted:1,status:'ready',pages:1,text};
 const binding=()=>({originalHash:'b'.repeat(64),admittedHash:hash,canonicalHash:'c'.repeat(64),extractorVerified:true,manifest:{extractorHash:'d'.repeat(64),normalization:{text,offsetMap:[{normalizedStart:0,normalizedEnd:text.length,pageNumber:1}]},rawExtraction:{pageEvidence:[{page:1,method,coordinateSystem:'pdf-points-bottom-left'}]}}});
 const files={require:()=>file,reprocessingEvidenceBinding:binding},images={get:async()=>{rendered++;return Buffer.from([137,80,78,71,13,10,26,10]);}},backend={available:true,fingerprint:'mock-v1',recognize:async()=>{count++;return {engine:'AppleVision',version:'mock',configuration:'accurate;correction=false',lines:[{text:'alpha',confidence:1,bounds:[0.1,0.8,0.2,0.1],alternatives:[]},{text:'beta',confidence:1,bounds:[0.1,0.5,0.2,0.1],alternatives:[]}]};}};
 const document={source:{fileId:'f'},physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}};
 const input={text,document,start:0,end:text.length,options:{originalPages:false,ocr:true,allowExternalTransmission:false}};
 return {service:new SourceReprocessingEvidence(files,images,backend,true),files,images,backend,input,count:()=>count,rendered:()=>rendered,mutate:()=>{hash='e'.repeat(64);}};
}
test('local raster OCR binds page hashes and unique global mappings, caches per page, and respects image consent',async()=>{
 const env=setup(),signal=new AbortController().signal;
 const local=await env.service.collect('v','f',env.input,signal);assert.equal(local.images,undefined);assert.equal(local.externalTransmissionAllowed,false);assert.equal(local.pages[0].ocr.independent,true);assert.deepEqual(local.pages[0].ocr.mapping,[{startOffset:0,endOffset:5,lineIndex:0},{startOffset:6,endOffset:10,lineIndex:1}]);
 const external=await env.service.collect('v','f',{...env.input,options:{originalPages:true,ocr:true,allowExternalTransmission:true}},signal);assert.equal(external.images.length,1);assert.equal(external.pages[0].imageHash,external.images[0].sha256);assert.equal(env.count(),1);
 await assert.rejects(env.service.collect('v','f',{...env.input,options:{originalPages:true,ocr:false,allowExternalTransmission:false}},signal),/consent/);
 env.mutate();assert.throws(()=>env.service.assertCurrent('v','f',external),/changed/);
});
test('fresh same-engine OCR is supplementary and cannot claim independence',async()=>{
 const env=setup('ocr'),result=await env.service.collect('v','f',env.input,new AbortController().signal);assert.equal(result.pages[0].ocr.independent,false);assert.equal(result.independentlyVerified,false);
});
test('capability and cancellation failures happen before image or OCR work',async()=>{
 const env=setup(),controller=new AbortController();controller.abort();await assert.rejects(env.service.collect('v','f',env.input,controller.signal),/cancelled/);assert.equal(env.count(),0);assert.equal(env.rendered(),0);
 env.files.reprocessingEvidenceBinding=()=>{throw new Error('provenance missing');};assert.equal(env.service.capabilities('v','f').ocr,false);
 await assert.rejects(env.service.collect('v','f',env.input,new AbortController().signal),/provenance missing/);assert.equal(env.rendered(),0);
 env.service.close();await assert.rejects(env.service.collect('v','f',env.input,new AbortController().signal),/closed/);
});
test('local OCR rejects out-of-image geometry and aggregate oversized injected evidence',()=>{
 const line={text:'text',confidence:1,bounds:[0.9,0.1,0.5,0.1],alternatives:[]},result={engine:'mock',version:'1',configuration:'mock',lines:[line]};assert.throws(()=>validateOCRResult(result),/Invalid local OCR line/);
 assert.throws(()=>validateOCRResult({...result,lines:Array.from({length:1000},()=>({...line,text:'x'.repeat(4000),bounds:[0,0,1,1]}))}),/budget/);
});

test('cancellation settles while a shared page render remains held',async()=>{
 const env=setup(),controller=new AbortController();env.images.get=()=>new Promise(()=>{});
 const pending=env.service.collect('v','f',env.input,controller.signal);await Promise.resolve();controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(env.count(),0);
});

function acceptanceFixture(text,original,replacement,category){
 const start=text.indexOf(original),document={source:{language:'en'},physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]},semantic:{kind:'document',children:[{id:'p',kind:'paragraph',text,range:{startOffset:0,endOffset:text.length},children:[]}]}};
 const target=text.slice(0,start)+replacement+text.slice(start+original.length),evidence={canonicalText:text,ocr:{available:true},pages:[{page:1,canonicalRanges:[{startOffset:0,endOffset:text.length}],canonicalRegions:[{startOffset:0,endOffset:text.length,bounds:[0.1,0.1,0.8,0.1]}],ocr:{engine:'AppleVision',version:'mock',configuration:'languageCorrection=false',independent:true,lines:[{text:target,confidence:1,bounds:[0.1,0.1,0.8,0.1],alternatives:[]}]}}]};
 return {text,document,start,end:start+original.length,original,replacement,category,policy:'verified',evidence};
}
test('Verified accepts only uniquely aligned native-vs-raster mechanical OCR or soft-wrap repairs',()=>{
 const ligature=acceptanceFixture('The rnodern passage has enough ordinary prose for alignment.','rn','m','ocr');assert.equal(evaluateV2Acceptance(ligature).automatic,true);
 const wrap=acceptanceFixture('This ordinary prose has a soft\nwrap on the same printed line.','\n',' ','line_breaks');assert.equal(evaluateV2Acceptance(wrap).automatic,true);
 for(const mutation of [proof=>proof.independent=false,proof=>proof.lines[0].confidence=0.5,proof=>proof.lines.push({...proof.lines[0]})]){const input=structuredClone(ligature);mutation(input.evidence.pages[0].ocr);assert.equal(evaluateV2Acceptance(input).automatic,false);}
 const missing=structuredClone(ligature);delete missing.evidence.pages[0].canonicalRanges;assert.equal(evaluateV2Acceptance(missing).automatic,false);
 const hard=acceptanceFixture('This ordinary prose has a hard  \nwrap on the same printed line.','\n',' ','line_breaks');assert.equal(evaluateV2Acceptance(hard).automatic,false);
 const quote=acceptanceFixture('The “rnodern passage” has enough ordinary prose for alignment.','rn','m','ocr');assert.equal(evaluateV2Acceptance(quote).automatic,false);
 const wrongRegion=structuredClone(ligature);wrongRegion.evidence.pages[0].ocr.lines[0].bounds=[0.1,0.8,0.8,0.1];assert.equal(evaluateV2Acceptance(wrongRegion).automatic,false);
 const bibliography=structuredClone(ligature);bibliography.document.semantic.children.unshift({id:'refs',kind:'section',title:'Bibliography',range:{startOffset:0,endOffset:bibliography.text.length}});assert.equal(evaluateV2Acceptance(bibliography).automatic,false);
 const noGeometry=structuredClone(ligature);delete noGeometry.evidence.pages[0].canonicalRegions;assert.equal(evaluateV2Acceptance(noGeometry).automatic,false);
 const substantive=acceptanceFixture('The final passage has enough ordinary prose for alignment.','final','first','ocr');assert.equal(evaluateV2Acceptance(substantive).automatic,false);
});
test('native region proof is confined to the exact canonical page and absent for raster or rotated layout',async()=>{
 const env=setup();env.input.document.semantic={kind:'document',children:[{id:'p',kind:'paragraph',text,range:{startOffset:0,endOffset:text.length},children:[]}]};
 env.images.layout=async()=>[{text:'alpha beta',bounds:[0.1,0.1,0.8,0.1]}];
 const result=await env.service.collect('v','f',env.input,new AbortController().signal);assert.deepEqual(result.pages[0].canonicalRegions,[{startOffset:0,endOffset:text.length,bounds:[0.1,0.1,0.8,0.1]}]);
 const absent=setup();absent.input.document=env.input.document;absent.images.layout=async()=>[];const noProof=await absent.service.collect('v','f',absent.input,new AbortController().signal);assert.deepEqual(noProof.pages[0].canonicalRegions,[]);
});
