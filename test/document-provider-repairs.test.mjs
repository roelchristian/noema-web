import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {documentProviderRepairSchema,normalizeDocumentProviderRepairs} from '../src/server/modules/document-provider-repairs.ts';
import {SOURCE_INGESTION_JSON_SCHEMA,validateSourceIngestionDocument} from '../src/server/modules/source-ingestion-validation.ts';
import {OpenAIDocumentProvider} from '../src/server/modules/document-provider-openai.ts';
import {GeminiDocumentProvider} from '../src/server/modules/document-provider-gemini.ts';
const doc=()=>({schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[],candidates:[]},pages:[{number:1,printedLabel:'1',role:'owned',state:'content',unresolved:[]}],blocks:[{id:'b',page:1,order:0,kind:'paragraph',text:'😀 $H$; $G_{a.b}$.',headingLevel:null,continues:null,table:null,diagram:null,uncertainty:null,location:null}],relations:[],repairs:[]});
const quote=overrides=>({blockId:'b',original:'$H$',prefix:'😀 ',suffix:'; ',replacement:'$\\bar{H}$',category:'math',reason:'A small source overline needs review.',...overrides});
const schema=()=>SOURCE_INGESTION_JSON_SCHEMA;
test('fresh full-transcription wire transforms only repairs while core and other task schemas keep offsets',()=>{
 const before=structuredClone(schema()),wire=documentProviderRepairSchema(schema());
 assert.deepEqual(schema(),before);assert.deepEqual(wire.properties.blocks,before.properties.blocks);
 assert.ok(before.properties.repairs.items.required.includes('start'));assert.ok(before.properties.repairs.items.required.includes('end'));
 assert.deepEqual(wire.properties.repairs.items.required,['blockId','original','prefix','suffix','replacement','category','reason']);assert.equal(wire.properties.repairs.items.properties.start,undefined);
 const repairOnly={type:'object',properties:{repairs:{type:'array'}}};assert.equal(documentProviderRepairSchema(repairOnly),repairOnly);
});
test('fresh initial quotes resolve locally to UTF-16 offsets without rewriting emitted source text',()=>{
 const input=doc();input.repairs=[quote()];const before=structuredClone(input);
 const candidate=normalizeDocumentProviderRepairs(input,schema());
 assert.deepEqual(input,before);assert.equal(candidate.blocks[0].text,before.blocks[0].text);
 assert.deepEqual(candidate.repairs,[{blockId:'b',start:3,end:6,original:'$H$',replacement:'$\\bar{H}$',category:'math',reason:quote().reason}]);
 assert.doesNotThrow(()=>validateSourceIngestionDocument(candidate,{ownedPages:[1],pageCount:1}));
});
test('invalid optional Ga.b quote or source-error proposal is omitted with review note and readable baseline',()=>{
 for(const proposal of [quote({original:'$G_{a,b}$',prefix:'',suffix:'',replacement:'$G_{a;b}$'}),quote({category:'source-error'}),quote({original:'\ude00',prefix:'',suffix:'',replacement:'x'}),{...quote(),proof:'unproved'},null]){
  const input=doc();input.repairs=[proposal];const candidate=normalizeDocumentProviderRepairs(input,schema());
  assert.deepEqual(candidate.repairs,[]);assert.equal(candidate.blocks[0].text,input.blocks[0].text);assert.match(candidate.blocks[0].uncertainty,/Optional transcription repair omitted/);
  assert.doesNotThrow(()=>validateSourceIngestionDocument(candidate,{ownedPages:[1],pageCount:1}));
 }
});
test('ambiguous quotes, duplicate block identities, overlapping proposals and malformed optional lists fail closed',()=>{
 const repeated=doc();repeated.blocks[0].text='$H$ and $H$';repeated.repairs=[quote({prefix:'',suffix:''})];assert.deepEqual(normalizeDocumentProviderRepairs(repeated,schema()).repairs,[]);
 const duplicate=doc();duplicate.blocks.push({...duplicate.blocks[0]});duplicate.repairs=[quote()];const ambiguous=normalizeDocumentProviderRepairs(duplicate,schema());assert.deepEqual(ambiguous.repairs,[]);assert.throws(()=>validateSourceIngestionDocument(ambiguous,{ownedPages:[1],pageCount:1}),/Duplicate|duplicate/);
 const overlap=doc();overlap.repairs=[quote(),quote()];assert.deepEqual(normalizeDocumentProviderRepairs(overlap,schema()).repairs,[]);
 for(const repairs of [null,{},Array.from({length:65},()=>quote())]){const input=doc();input.repairs=repairs;const candidate=normalizeDocumentProviderRepairs(input,schema());assert.deepEqual(candidate.repairs,[]);assert.equal(candidate.blocks[0].text,input.blocks[0].text);}
});
test('fresh model offsets are not trusted while authoritative legacy offset IR remains unchanged',()=>{
 const input=doc(),legacy={blockId:'b',start:3,end:6,original:'$H$',replacement:'$\\bar{H}$',category:'math',reason:'Retained exact span'};input.repairs=[legacy];
 assert.deepEqual(normalizeDocumentProviderRepairs(input,schema()).repairs,[]);
 assert.deepEqual(validateSourceIngestionDocument(input,{ownedPages:[1],pageCount:1}).repairs,[legacy]);assert.deepEqual(input.repairs,[legacy]);
});
for(const provider of ['openai','gemini'])test(`${provider} actual adapter initial wire asks for quote anchors and normalizes optional repairs before publication`,async()=>{
 const candidate=doc();candidate.repairs=[quote()];const text=JSON.stringify(candidate);
 const body=provider==='openai'?{id:'resp_fresh',status:'completed',model:'gpt-6.1-sol',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:20}}:{id:'interaction_fresh',status:'completed',model:'gemini-3.8-flash',steps:[{type:'model_output',content:[{type:'text',text}]}],usage:{total_input_tokens:10,total_output_tokens:20}};
 let calls=0;
 const transport=async(url,options)=>{
  if(options.method==='DELETE')return Response.json({});
  if(url.includes('/files'))return Response.json(provider==='openai'?{id:'file-fresh'}:{file:{name:'files/fresh',uri:'https://generativelanguage.googleapis.com/v1/files/fresh',state:'ACTIVE'}});
  calls++;const request=JSON.parse(options.body),wire=provider==='openai'?request.text.format.schema:request.response_format.schema;
  assert.deepEqual(wire.properties.repairs.items.required,['blockId','original','prefix','suffix','replacement','category','reason']);assert.equal(wire.properties.repairs.items.properties.start,undefined);
  if(provider==='gemini'){const location=wire.properties.blocks.items.properties.location.anyOf.find(item=>item.type==='object');assert.deepEqual(location.properties.coordinateSystem.enum,['normalized_1000']);}
  return Response.json(body);
 };
 const Class=provider==='openai'?OpenAIDocumentProvider:GeminiDocumentProvider;
 const result=await new Class(()=> 'synthetic-only',transport).extract({model:body.model,pdf:new Uint8Array([1,2,3]),pages:1,prompt:'One owned page',schema:schema(),maxOutputTokens:8000});
 assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.candidate.repairs[0].start,3);assert.equal(result.candidate.repairs[0].end,6);assert.equal(result.candidate.blocks[0].text,candidate.blocks[0].text);
 assert.equal(result.responseHash,createHash('sha256').update(JSON.stringify(body)).digest('hex'));
});
test('initial quotes address complete emitted blocks rather than targeted snippet truncation',()=>{
 const input=doc();input.blocks[0].text='x'.repeat(5000)+'😀 $H$; '+ 'y'.repeat(5000);input.repairs=[quote()];
 const candidate=normalizeDocumentProviderRepairs(input,schema());assert.equal(candidate.repairs[0].start,5003);assert.equal(candidate.repairs[0].end,5006);assert.equal(candidate.blocks[0].text,input.blocks[0].text);
});
