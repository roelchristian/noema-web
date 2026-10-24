import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateReprocessingEvidenceSnapshot} from '../src/server/modules/source-reprocessing-evidence-validation.ts';
const digest=value=>createHash('sha256').update(value).digest('hex');
const rehash=value=>{const {hash,...content}=value;return {...content,hash:digest(JSON.stringify(content))};};
const text='Synthetic scholarly prose.';
const configuration={depth:'balanced',reviewPolicy:'verified',evidence:{originalPages:true,ocr:true,allowExternalTransmission:true}};
const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:text.length}}]}};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const snapshot=()=>rehash({version:1,canonicalText:text,pageNumbers:[1],originalPages:{available:true,reason:'Consented source page'},ocr:{available:true,reason:'Local independent OCR'},independentlyVerified:false,externalTransmissionAllowed:true,diagnostics:[],images:[{page:1,mimeType:'image/png',base64:png.toString('base64'),sha256:digest(png)}],pages:[{page:1,originalHash:'a'.repeat(64),admittedHash:'b'.repeat(64),imageHash:digest(png),canonicalRanges:[{startOffset:0,endOffset:text.length}],canonicalRegions:[{startOffset:0,endOffset:text.length,bounds:[0,0,1,1]}],ocr:{engine:'synthetic',version:'1',configuration:'test',independent:true,lines:[{text,confidence:.9,bounds:[0,0,1,1],alternatives:[]}],mapping:[{startOffset:0,endOffset:text.length,lineIndex:0}]}}]});
const validate=(e,overrides={})=>validateReprocessingEvidenceSnapshot(e,{text,document,start:0,end:text.length,configuration,evidenceHash:e.hash,...overrides});
test('durable evidence validates PNG, independent OCR provenance and exact canonical mapping without native services',()=>{
 const e=snapshot(),restored=validate(e);assert.deepEqual(restored,e);assert.notEqual(restored,e);assert.equal(restored.independentlyVerified,false);assert.equal(restored.pages[0].ocr.engine,'synthetic');
});
test('evidence archive fails closed on byte tampering, missing consent, invalid boxes or ambiguous canonical mapping',()=>{
 const original=snapshot();assert.throws(()=>validate({...original,canonicalText:'tampered'}),/invalid source reconstruction evidence/);
 assert.throws(()=>validate(original,{configuration:{...configuration,evidence:{...configuration.evidence,allowExternalTransmission:false}}}),/invalid source reconstruction evidence/);
 for(const mutate of [e=>{e.images[0].base64=Buffer.from('not png').toString('base64');},e=>{e.pages[0].ocr.lines[0].bounds=[.9,0,.5,1];},e=>{e.pages[0].ocr.mapping[0].startOffset=1;},e=>{e.pages[0].ocr.mapping.push({...e.pages[0].ocr.mapping[0]});},e=>{e.pages[0].canonicalRanges.push({...e.pages[0].canonicalRanges[0]});},e=>{e.pages[0].canonicalRegions[0].endOffset=text.length+1;},e=>{e.pages[0].canonicalRegions[0].bounds=[0,0,0,1];}]){const e=structuredClone(original);mutate(e);assert.throws(()=>validate(rehash(e)),/invalid source reconstruction evidence/);}
 const e=snapshot();e.canonicalText=text+' '+text;const repeated=rehash(e);assert.throws(()=>validate(repeated,{text:e.canonicalText,end:e.canonicalText.length,document:{physical:{pages:[{number:1,range:{startOffset:0,endOffset:e.canonicalText.length}}]}}}),/invalid source reconstruction evidence/);
});

test('oversized source page evidence is rejected before decoding or provider work',()=>{
 const e=snapshot(),oversized=Buffer.alloc(2*1024*1024+1);png.copy(oversized,0,0,8);e.images[0].base64=oversized.toString('base64');e.images[0].sha256=digest(oversized);e.pages[0].imageHash=e.images[0].sha256;assert.throws(()=>validate(rehash(e)),/invalid source reconstruction evidence/);
});

test('backup rejects aggregate revision evidence exceeding 24 MiB even when each page is individually bounded',async()=>{
 const {restoreReprocessingCheckpoints}=await import('../src/server/modules/source-reprocessing-backup.ts');
 const sourceText='abcdefghij',sourceDocument={physical:{pages:[{number:1,range:{startOffset:0,endOffset:sourceText.length}}]}},config={...configuration,evidence:{...configuration.evidence,ocr:false}},bytes=Buffer.alloc(2*1024*1024);png.copy(bytes,0,0,8);
 const pageHash=digest(bytes),base64=bytes.toString('base64'),revision={id:'revision',pipelineVersion:2,status:'failed',configuration:config,baseHash:'a'.repeat(64),original:{text:sourceText,document:sourceDocument},patches:[],report:{chunksTotal:10,chunksCompleted:0,completedChunkIndexes:[]}};
 const chunks=[...sourceText].map((canonicalText,index)=>{const evidence=rehash({version:1,canonicalText,pageNumbers:[1],originalPages:{available:true,reason:'Synthetic'},ocr:{available:false,reason:'Not requested'},independentlyVerified:false,externalTransmissionAllowed:true,diagnostics:[],images:[{page:1,mimeType:'image/png',base64,sha256:pageHash}],pages:[{page:1,originalHash:'a'.repeat(64),admittedHash:'b'.repeat(64),imageHash:pageHash}]});return {revisionId:revision.id,index,startOffset:index,endOffset:index+1,baseHash:revision.baseHash,evidenceHash:evidence.hash,evidence,difficulty:'ordinary',difficultyReason:null,requiredPassCount:2,status:'pending'};});
 assert.throws(()=>restoreReprocessingCheckpoints(revision,revision.id,revision.baseHash,chunks,[]),/invalid source editorial revision/);
});
