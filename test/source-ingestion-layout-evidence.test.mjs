import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransportHandler} from '../src/server/transport.ts';

function fixture(){
 const document={pages:[{number:1,role:'owned',state:'content',unresolved:[]},{number:2,role:'owned',state:'content',unresolved:[]}],blocks:[{id:'a',page:1,order:0,text:'Literal $H$.',uncertainty:'The printed exponent is unclear.',layoutWarnings:['Page-one placement needs review.']},{id:'b',page:1,order:1,text:'Second passage.',uncertainty:null,layoutWarnings:['Page-one placement needs review.']},{id:'c',page:2,order:0,text:'Other page.',uncertainty:null,layoutWarnings:['Page-two diagram needs review.']}]};
 const source={id:'f.pdf',vault_id:'default',pages:2,admitted:1};let generation=0;
 const runtime={store:{get(query){if(query.includes('SELECT document_json,provenance_json'))return {document_json:JSON.stringify(document),provenance_json:JSON.stringify({provider:'gemini',requestedModel:'gemini-3.8-flash',returnedModel:'gemini-3.8-flash',coverage:'checked',independentEvidence:'not-checked'})};return undefined;}},sourceFiles:{require:()=>source,evidence:()=>({originalAvailable:true})},vaults:{requireOpen:()=> 'default'},networkAccess:{config:()=>({lan:false,bindHost:'127.0.0.1',allowedHosts:['localhost']})},intelligence:new Proxy({},{get(){generation++;throw Error('Evidence inspection cannot generate');}})};
 const handler=createTransportHandler(runtime,'/unused',new Set());
 return {document,generation:()=>generation,async read(page){let status,body;await handler({url:'/api/source-files/f.pdf/evidence?page='+page,method:'GET',headers:{host:'localhost','x-vault-id':'default'},socket:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1'}},{writeHead(value){status=value;},end(value){body=JSON.parse(value);}});return {status,body};}};
}
test('actual evidence route separates, deduplicates and page-scopes layout notes without generation',async()=>{const f=fixture(),before=JSON.stringify(f.document),first=await f.read(1),second=await f.read(2);assert.equal(first.status,200);assert.deepEqual(first.body.ingestion.layoutWarnings,['Page-one placement needs review.']);assert.deepEqual(first.body.ingestion.uncertainty,['The printed exponent is unclear.']);assert.equal(first.body.ingestion.text,'Literal $H$.\n\nSecond passage.');assert.deepEqual(second.body.ingestion.layoutWarnings,['Page-two diagram needs review.']);assert.deepEqual(second.body.ingestion.uncertainty,[]);assert.equal(JSON.stringify(f.document),before);assert.equal(f.generation(),0);});
test('legacy evidence remains readable without layout notes and invalid pages fail closed',async()=>{const f=fixture();for(const block of f.document.blocks)delete block.layoutWarnings;const result=await f.read(1);assert.equal(result.status,200);assert.deepEqual(result.body.ingestion.layoutWarnings,[]);assert.match(result.body.ingestion.text,/Literal/);assert.equal((await f.read(3)).status,400);assert.equal(f.generation(),0);});
test('old machine geometry notes project as layout while real glyph uncertainty survives without IR migration',async()=>{
 const f=fixture(),warning='An out-of-bounds provider location hint was omitted. Inspect the original PDF for visual placement.';
 for(const b of f.document.blocks)delete b.layoutWarnings;
 f.document.blocks[0].uncertainty=warning+' The minus sign is unclear.';f.document.blocks[1].uncertainty=warning;
 const original=JSON.stringify(f.document),result=await f.read(1);
 assert.deepEqual(result.body.ingestion.layoutWarnings,[warning]);assert.deepEqual(result.body.ingestion.uncertainty,['The minus sign is unclear.']);assert.equal(JSON.stringify(f.document),original);assert.equal(f.generation(),0);
});
