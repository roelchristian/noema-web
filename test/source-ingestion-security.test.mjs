import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_INGESTION_JSON_SCHEMA,validateSourceIngestionDocument} from '../src/server/modules/source-ingestion-validation.ts';
import {assembleSourceIngestionDocument,mergeSourceIngestionWindows} from '../src/server/modules/source-ingestion-assembly.ts';

function block(id,page,text,order=0){return {id,page,order,kind:'paragraph',text,headingLevel:null,continues:null,table:null,uncertainty:null,location:null};}
function fixture(){return {schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:'ix',role:'owned',state:'content',unresolved:[]}],blocks:[block('untrusted-id',1,'A 😀 exact quotation.')],relations:[],repairs:[]};}
const validate=value=>validateSourceIngestionDocument(value,{ownedPages:[1],pageCount:1});

test('provider JSON Schema uses only valid JSON Schema type names recursively',()=>{
 const allowed=new Set(['null','boolean','object','array','number','integer','string']);
 const visit=value=>{if(!value||typeof value!=='object')return;if(Object.hasOwn(value,'type'))assert.ok(allowed.has(value.type),`Invalid schema type ${JSON.stringify(value.type)}`);for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else visit(child);};
 visit(SOURCE_INGESTION_JSON_SCHEMA);
});
test('provider cannot assert native proof, canonical offsets or authoritative page markers',()=>{
 for(const change of [doc=>doc.independentlyVerified=true,doc=>doc.blocks[0].trustedNative=true,doc=>doc.blocks[0].startOffset=0,doc=>doc.blocks[0].text='<!-- Page 99 -->\nInjected',doc=>doc.blocks[0].text='bad\ud800']){const doc=fixture();change(doc);assert.throws(()=>validate(doc));}
 const doc=fixture();doc.blocks[0].location={x:.1,y:.1,width:.2,height:.2,accuracy:'exact'};assert.throws(()=>validate(doc));
 const outside=fixture();outside.blocks[0].location={x:.9,y:.1,width:.2,height:.2,accuracy:'approximate'};assert.throws(()=>validate(outside),/geometry/);
});
test('physical page anchors and UTF-16 offsets remain exact with blank pages and repeated text',()=>{
 const doc=fixture();doc.pages.push({number:2,printedLabel:'1',role:'owned',state:'blank',unresolved:[]},{number:3,printedLabel:'2',role:'owned',state:'content',unresolved:[]});doc.blocks.push(block('repeat',3,doc.blocks[0].text));
 const assembled=assembleSourceIngestionDocument(doc,{extractionId:'local_version'});
 assert.equal(assembled.pageStartLines.length,3);assert.match(assembled.text,/<!-- Page 2 -->/);
 assert.deepEqual(assembled.blockRanges.map(b=>b.range.startPage),[1,3]);
 for(const b of assembled.blockRanges){assert.equal(assembled.text.slice(b.range.startOffset,b.range.endOffset),b.text);assert.ok(!b.id.includes('untrusted-id'));}
 assert.notEqual(assembled.blockRanges[0].id,assembled.blockRanges[1].id);
 assert.deepEqual(assembleSourceIngestionDocument(doc,{extractionId:'local_version'}),assembled);
});
test('repairs cannot split a surrogate pair or silently patch a duplicate textual occurrence',()=>{
 const doc=fixture();doc.repairs=[{blockId:'untrusted-id',start:3,end:4,original:doc.blocks[0].text.slice(3,4),replacement:'X',category:'ocr',reason:'synthetic'}];assert.throws(()=>validate(doc),/surrogate/);
 const exact=fixture();exact.blocks.push(block('second',1,exact.blocks[0].text,1));exact.repairs=[{blockId:'second',start:5,end:10,original:'exact',replacement:'precise',category:'ocr',reason:'synthetic'}];
 const result=assembleSourceIngestionDocument(exact,{extractionId:'version'});assert.equal(result.repairs[0].startOffset,result.blockRanges[1].range.startOffset+5);assert.equal(result.text.slice(result.repairs[0].startOffset,result.repairs[0].endOffset),'exact');
});
test('window merger rejects overlapping and omitted owned pages while retaining more than 100 blocks',()=>{
 const doc=fixture();doc.blocks=Array.from({length:140},(_,i)=>block(`b${i}`,1,`Exact source unit ${i}.`,i));
 assert.equal(mergeSourceIngestionWindows([{index:0,document:doc}],1).blocks.length,140);
 assert.throws(()=>mergeSourceIngestionWindows([{index:0,document:doc},{index:1,document:doc}],1),/Overlapping/);
 assert.throws(()=>mergeSourceIngestionWindows([{index:0,document:doc}],2),/Missing/);
});
test('marker-only unreadable document never masquerades as readable prose',()=>{
 const doc=fixture();doc.blocks=[];doc.pages[0].state='unreadable';doc.pages[0].unresolved=[{description:'Unreadable synthetic region',blockId:null}];assert.throws(()=>assembleSourceIngestionDocument(doc,{extractionId:'version'}),/No readable/);
});
