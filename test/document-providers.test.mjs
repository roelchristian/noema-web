import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {OpenAIDocumentProvider} from '../dist/server/modules/document-provider-openai.js';
import {GeminiDocumentProvider} from '../dist/server/modules/document-provider-gemini.js';
import {PdfPlatform} from '../dist/server/modules/pdf-platform.js';
import {ServerSecretStore} from '../dist/server/modules/intelligence.js';
import {documentModel,documentPrice} from '../dist/shared/document-models.js';
const base={pdf:new Uint8Array([1,2,3]),pages:1,prompt:'Owned original physical pages: 1',schema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},maxOutputTokens:1000};
const result={value:'faithful'};
test('provider rejections retain safe HTTP, phase and validation fields without echoed source or secrets',async()=>{
 const {providerHTTP}=await import('../dist/server/modules/document-provider.js');
 const secret='private-credential-and-source';
 const body={error:{code:400,status:'INVALID_ARGUMENT',message:secret,param:'response_format.schema',details:[{fieldViolations:[{field:'generation_config.thinking_level',description:secret},{field:'response_format.schema',description:secret},{field:secret,description:secret}]}]}};
 await assert.rejects(()=>providerHTTP(async()=>Response.json(body,{status:400}),'https://generativelanguage.googleapis.com/v1/interactions?key='+secret,{method:'POST'},true),error=>{
  assert.equal(error.status,400);assert.equal(error.code,'provider_http');assert.equal(error.outcomeUncertain,false);
  assert.match(error.message,/generation \(HTTP 400; INVALID_ARGUMENT; fields: response_format\.schema, generation_config\.thinking_level\)/);
  assert.equal(error.message.includes(secret),false);assert.equal(error.message.includes('https:'),false);return true;
 });
 await assert.rejects(()=>providerHTTP(async()=>Response.json({error:{code:secret,status:secret,message:secret}},{status:403}),'https://generativelanguage.googleapis.com/upload/v1/files?key='+secret,{method:'POST'}),error=>{assert.equal(error.code,'credentials');assert.match(error.message,/file transfer \(HTTP 403\)/);assert.equal(error.message.includes(secret),false);return true;});
 await assert.rejects(()=>providerHTTP(async()=>new Response(secret.repeat(2000),{status:429,headers:{'retry-after':'2'}}),'https://example.com/v1/responses',{method:'POST'},true),error=>{assert.equal(error.code,'rate_limit');assert.equal(error.outcomeUncertain,false);assert.equal(error.retryAfterMs,2000);assert.match(error.message,/generation \(HTTP 429\)/);assert.equal(error.message.includes(secret),false);return true;});
});
test('Gemini Interactions documented errors expose their own code without free-form messages',async()=>{
 const {providerHTTP}=await import('../dist/server/modules/document-provider.js');
 const secret='private-source-and-key';
 for(const code of ['invalid_request','parameter_unknown','failed_precondition','payment_required','quota_exceeded']){
  const body={error:{code,message:`The value '${secret}' is not supported for 'type' at 'tools[0]'. Unknown field '${secret}'.`}};
  await assert.rejects(()=>providerHTTP(async()=>Response.json(body,{status:400}),'https://generativelanguage.googleapis.com/v1/interactions',{method:'POST'},true),error=>{
   assert.equal(error.outcomeUncertain,false);assert.ok(error.message.includes(`HTTP 400; ${code})`));assert.equal(error.message.includes(secret),false);assert.equal(error.message.includes('The value'),false);return true;
  });
 }
 await assert.rejects(()=>providerHTTP(async()=>Response.json({error:{code:'invalid_request',message:'Invalid input received.'}},{status:400}),'https://generativelanguage.googleapis.com/v1/interactions',{method:'POST'},true),error=>{assert.match(error.message,/HTTP 400; invalid_request\)/);assert.equal(error.message.includes('Invalid input received'),false);return true;});
});
test('tsx development PDF platform launches the compiled isolated worker',async()=>{
 const {PdfPlatform:DevelopmentPdfPlatform}=await import('../src/server/modules/pdf-platform.ts');
 const document=await PDFDocument.create();document.addPage([200,300]);
 assert.equal(await new DevelopmentPdfPlatform().count(await document.save({useObjectStreams:false})),1);
});
function openai(status='completed',content=[{type:'output_text',text:JSON.stringify(result)}]){return {id:'resp_1',status,model:'gpt-6.1-sol',output:[{type:'message',content}],usage:{input_tokens:9,output_tokens:7,output_tokens_details:{reasoning_tokens:2},input_tokens_details:{cached_tokens:3}}};}
function gemini(status='completed'){return {id:'interaction_1',status,model:'gemini-3.8-flash',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(result)}]}],usage:{total_input_tokens:9,total_output_tokens:7,total_thought_tokens:2,total_cached_tokens:3}};}
function transport(provider,response,check=()=>{}){return async(url,options)=>{assert.equal(options.redirect,'error');assert.ok(!url.includes('secret'));if(options.method==='DELETE')return Response.json({});if(url.includes('/files')){check('upload',url,options);return Response.json(provider==='openai'?{id:'file-test'}:{file:{name:'files/test',uri:'https://generativelanguage.googleapis.com/v1/files/test',state:'ACTIVE',expirationTime:'2099-01-01T00:00:00Z'}});}check('generation',url,options);return Response.json(response);};}
for(const provider of ['openai','gemini']){
 const Class=provider==='openai'?OpenAIDocumentProvider:GeminiDocumentProvider,model=provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash';
 test(`${provider}: extraction wire instructions distinguish table evidence and define cell coordinates`,async()=>{
  let instructions;
  const adapter=new Class(()=> 'synthetic',transport(provider,provider==='openai'?openai():gemini(),(kind,url,options)=>{if(kind==='generation'){const body=JSON.parse(options.body);instructions=body.instructions??body.system_instruction;}}));
  await adapter.extract({...base,model});
  assert.match(instructions,/actual visible row-and-column table/);
  assert.match(instructions,/ordinary paragraphs, headings, lists/);
  assert.match(instructions,/checkbox distribution forms, signatures and page layout columns are not tables/);
  assert.match(instructions,/table=null on every non-table block/);
  assert.match(instructions,/zero-based indices/);
  assert.match(instructions,/rowSpan and columnSpan are positive counts/);
  assert.match(instructions,/row\+rowSpan<=rows and column\+columnSpan<=columns/);
  assert.match(instructions,/retain the faithful block text with table=null/);
  assert.match(instructions,/earlier same-kind block/);
  assert.match(instructions,/together in this single response/);assert.match(instructions,/metadata\.candidates/);assert.match(instructions,/institutional issuing body/);assert.match(instructions,/concise AI synopsis/);
  assert.match(instructions,/valid LaTeX using \$\.\.\.\$ for inline mathematics and \$\$\.\.\.\$\$ for display equations/);
  assert.match(instructions,/mathematical expressions within prose, headings and the synopsis/);
  assert.match(instructions,/do not use bare caret or underscore notation, or alternate delimiters/);
  assert.ok(instructions.includes('$x^{i}y^{j}$'));
  assert.ok(instructions.includes('$$x^{i}y^{j}=e$$'));
  assert.match(instructions,/including printed mathematical errors; never silently solve, simplify or correct them/);
  assert.match(instructions,/exact substrings of the emitted block\.text, including any math delimiters/);
  assert.match(instructions,/Systematically inspect EVERY block/);
  assert.match(instructions,/Cover single-letter variables and group\/set names embedded in prose/);
  assert.match(instructions,/relations, products, quotients, set-builder notation, cyclic groups, generated subgroups and complete equations/);
  assert.match(instructions,/including their operators and operands/);
  assert.match(instructions,/KaTeX-compatible LaTeX with balanced braces and supported commands/);
  assert.match(instructions,/Escape every LaTeX backslash correctly in JSON string values/);
  assert.match(instructions,/Do not stop after formatting exponents or isolated identifiers/);
  assert.match(instructions,/ordinary counts, dates, bibliography numbers and URLs; these are not automatically math/);
 });
 test(`${provider}: current envelope, one generation, normalized usage and cleanup`,async()=>{
  let generation=0,uploads=0,deletes=0;
  const mocked=transport(provider,provider==='openai'?openai():gemini(),(kind,url,options)=>{if(kind==='upload'){uploads++;if(provider==='openai'){assert.equal(options.body.get('purpose'),'user_data');assert.equal(options.body.get('expires_after[seconds]'),'3600');}return;}generation++;const sent=JSON.parse(options.body);assert.equal(sent.store,false);assert.equal(sent.tools,undefined);assert.equal(sent.model,model);if(provider==='openai'){assert.equal(sent.text.format.strict,true);assert.equal(sent.input[0].content[0].type,'input_file');}else{assert.ok(url.endsWith('/v1/interactions'));assert.equal(sent.input[0].type,'document');assert.equal(sent.response_format.mime_type,'application/json');assert.equal(sent.generation_config.tool_choice,'none');}});
  const adapter=new Class(()=> 'secret',async(...args)=>{if(args[1].method==='DELETE')deletes++;return mocked(...args);});
  const completed=await adapter.extract({...base,model});assert.equal(completed.status,'completed');assert.deepEqual(completed.candidate,result);assert.equal(completed.usage.thinkingTokens,2);assert.equal(completed.usage.cachedInputTokens,3);assert.equal(generation,1);assert.equal(uploads,1);assert.equal(deletes,1);
 });
 test(`${provider}: truncated output retains usage and never parses partial candidate`,async()=>{const adapter=new Class(()=> 'secret',transport(provider,provider==='openai'?openai('incomplete'):gemini('incomplete')));const value=await adapter.extract({...base,model});assert.equal(value.status,'incomplete');assert.equal(value.candidate,undefined);assert.equal(value.usage.inputTokens,9);});
 test(`${provider}: cancellation before dispatch, decimal byte limits, output and model limits`,async()=>{let calls=0;const adapter=new Class(()=> 'secret',async()=>{calls++;throw Error();});for(const request of [{...base,model,pdf:new Uint8Array(50_000_000)},{...base,model,maxOutputTokens:999999},{...base,model:'invented-model'},{...base,model,signal:AbortSignal.abort()}])await assert.rejects(()=>adapter.extract(request));assert.equal(calls,0);});
 test(`${provider}: lost paid response stays uncertain and is never retried`,async()=>{let calls=0;const upload=transport(provider,{});const adapter=new Class(()=> 'secret',async(url,options)=>{if(url.endsWith('/responses')||url.endsWith('/interactions')){calls++;throw Error('socket closed');}return upload(url,options);});await assert.rejects(()=>adapter.extract({...base,model}),error=>error.outcomeUncertain===true);assert.equal(calls,1);});
}
test('OpenAI refusal and invalid JSON are not completion candidates',async()=>{for(const response of [openai('completed',[{type:'refusal',refusal:'no'}]),openai('completed',[{type:'output_text',text:'{'}])]){const value=await new OpenAIDocumentProvider(()=> 'secret',transport('openai',response)).extract({...base,model:'gpt-6.1-sol'});assert.ok(['refused','invalid'].includes(value.status));assert.equal(value.candidate,undefined);}});
test('Gemini PDF page limit and expired files fail before generation',async()=>{let generation=0;const adapter=new GeminiDocumentProvider(()=> 'secret',async(url,options)=>{if(url.endsWith('/interactions'))generation++;return Response.json({file:{name:'files/expired',uri:'https://generativelanguage.googleapis.com/v1/files/expired',state:'ACTIVE',expirationTime:'2001-01-01T00:00:00Z'}});});await assert.rejects(()=>adapter.extract({...base,model:'gemini-3.8-flash',pages:1001}));await assert.rejects(()=>adapter.extract({...base,model:'gemini-3.8-flash'}),error=>error.code==='file_expired');assert.equal(generation,0);});
test('portable synthetic PDF admits, splits, counts and renders on Linux without native Apple tools',async()=>{const document=await PDFDocument.create();document.addPage([200,300]).drawText('Synthetic first page',{x:10,y:180,size:10});document.addPage([200,300]);const bytes=await document.save({useObjectStreams:false}),platform=new PdfPlatform();const admitted=await platform.admit(bytes);assert.equal(admitted.pages,2);assert.equal(admitted.flattened,false);assert.equal(await platform.count(bytes),2);const split=await platform.split(bytes,[2,1]);assert.deepEqual(split.pageMap,[2,1]);assert.equal(await platform.count(split.bytes),2);const image=await platform.render(bytes,1);assert.equal(image.toString('hex',0,8),'89504e470d0a1a0a');assert.match(await platform.inspectText(bytes,1),/Synthetic first page/);});
test('server credential store isolates existing account and never writes configuration',()=>{const env={NOEMA_GEMINI_ACCOUNT:'account-a',NOEMA_GEMINI_API_KEY:'synthetic-key',NOEMA_GEMINI_EXPIRES_AT:'2099-01-01T00:00:00Z'};const store=new ServerSecretStore('gemini','account-a',env);assert.equal(store.read().key,'synthetic-key');assert.equal(new ServerSecretStore('gemini','account-b',env).read(),null);assert.throws(()=>store.write({}));assert.throws(()=>store.remove());});
test('registry exact IDs, capacities and effective prices are deterministic',()=>{assert.equal(documentModel('gemini-4-argon').maxOutputTokens,65536);assert.equal(documentModel('gpt-6.1-sol').contextTokens,1050000);assert.equal(documentPrice('gemini-4-argon','2026-11-30').input,2);assert.equal(documentPrice('gemini-4-argon','2026-12-01').input,4);assert.equal(documentPrice('gemini-3.8-flash','2027-01-01').output,7.5);});
test('portable source page image service requires admitted assets and never fabricates native geometry',{skip:process.platform==='darwin'},async()=>{
 const {SourcePageImages}=await import('../dist/server/modules/source-page-images.js');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const path=await import('node:path');const {createHash}=await import('node:crypto');
 const directory=mkdtempSync(path.join(tmpdir(),'noema-portable-evidence-'));const filename=path.join(directory,'synthetic.pdf');const document=await PDFDocument.create();document.addPage([200,300]);const bytes=Buffer.from(await document.save({useObjectStreams:false}));writeFileSync(filename,bytes);
 let admitted=1;const files={root:directory,require:()=>({admitted,status:'ready',format:'pdf',pages:1}),filename:()=>filename,evidence:()=>({admittedHash:createHash('sha256').update(bytes).digest('hex')})};const images=new SourcePageImages(files);
 try{const png=await images.get('default','synthetic',1);assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.deepEqual(await images.layout('default','synthetic',1),[]);admitted=0;await assert.rejects(()=>images.get('default','synthetic',1),error=>error.status===409);admitted=1;await assert.rejects(()=>images.get('default','synthetic',2),error=>error.status===400);}finally{images.close();rmSync(directory,{recursive:true,force:true});}
});
test('shared direct and reprocessing math contract examples are valid KaTeX and retain JSON backslashes',async()=>{
 const {scholarlyMathPrompt}=await import('../dist/server/modules/source-math-prompt.js');
 const {documentSystemPrompt}=await import('../dist/server/modules/document-provider.js');
 const katex=(await import('katex')).default;
 assert.ok(documentSystemPrompt.includes(scholarlyMathPrompt));
 const {readFileSync}=await import('node:fs');
 const reprocessing=readFileSync(new URL('../src/server/modules/source-reprocessing-pass.ts',import.meta.url),'utf8');
 assert.match(reprocessing,/import \{scholarlyMathPrompt\}/);
 assert.match(reprocessing,/const substantialMathPrompt=.*\+scholarlyMathPrompt\+/);
 const examples=[...scholarlyMathPrompt.matchAll(/(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g)].map(match=>match[1]).filter(value=>value!=='...');
 assert.ok(examples.length>=10);
 assert.ok(examples.includes('\\mathbb{Z}/(p) \\times \\mathbb{Z}/(p)'));
 assert.ok(examples.includes('\\{x^i y^j : 0 \\le i,j \\le p-1\\}'));
 for(const expression of examples){assert.doesNotThrow(()=>katex.renderToString(expression,{throwOnError:true,strict:'error',trust:false}));assert.equal(JSON.parse(JSON.stringify({text:expression})).text,expression);}
 assert.ok(scholarlyMathPrompt.includes('serialized JSON contains \\\\ for each single backslash'));
});
for(const provider of ['openai','gemini'])test(`${provider}: unreadable paid response remains uncertain`,async()=>{const Class=provider==='openai'?OpenAIDocumentProvider:GeminiDocumentProvider;const upload=transport(provider,{});const adapter=new Class(()=> 'secret',async(url,options)=>url.endsWith('/responses')||url.endsWith('/interactions')?new Response('{broken'):upload(url,options));await assert.rejects(()=>adapter.extract({...base,model:provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash'}),error=>error.outcomeUncertain===true);});
for(const provider of ['openai','gemini'])test(`${provider}: caller cancellation after submission is an uncertain paid outcome`,async()=>{const Class=provider==='openai'?OpenAIDocumentProvider:GeminiDocumentProvider;const controller=new AbortController(),upload=transport(provider,{});const adapter=new Class(()=> 'secret',async(url,options)=>{if(url.endsWith('/responses')||url.endsWith('/interactions')){assert.notEqual(options.signal,controller.signal);controller.abort();if(options.signal.aborted)throw options.signal.reason;}return upload(url,options);});await assert.rejects(()=>adapter.extract({...base,model:provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash',signal:controller.signal}),error=>error.code==='cancelled'&&error.outcomeUncertain===true);});
test('portable bounded context reads document metadata and outline physical destinations',async()=>{
 const {PDFName,PDFHexString}=await import('pdf-lib');const document=await PDFDocument.create();document.setTitle('Synthetic metadata title');document.setLanguage('fr-FR');document.addPage([200,300]);const second=document.addPage([200,300]);
 const root=document.context.obj({Type:'Outlines',Count:1}),rootRef=document.context.register(root);
 const item=document.context.obj({Title:PDFHexString.fromText('Second section — printed ix'),Parent:rootRef,Dest:[second.ref,'Fit']});const itemRef=document.context.register(item);root.set(PDFName.of('First'),itemRef);root.set(PDFName.of('Last'),itemRef);document.catalog.set(PDFName.of('Outlines'),rootRef);
 const bytes=await document.save({useObjectStreams:false}),platform=new PdfPlatform();const context=await platform.inspectContext(bytes);assert.equal(context.title,'Synthetic metadata title');assert.equal(context.language,'fr-FR');assert.deepEqual(context.sections,[{page:2,title:'Second section — printed ix'}]);
});
test('portable batched native evidence retains page order, blank pages and explicit extractor',async()=>{
 const document=await PDFDocument.create();document.addPage([200,300]).drawText('First native evidence',{x:10,y:200,size:10});document.addPage([200,300]);document.addPage([200,300]).drawText('Third native evidence',{x:10,y:200,size:10});const bytes=await document.save({useObjectStreams:false}),platform=new PdfPlatform();
 const evidence=await platform.inspectTexts(bytes,[3,2,1]);assert.deepEqual(evidence.map(value=>value.page),[3,2,1]);assert.match(evidence[0].text,/Third native evidence/);assert.equal(evidence[1].text,'');assert.match(evidence[2].text,/First native evidence/);assert.ok(evidence.every(value=>value.extractor==='pdfjs-dist/6.4.299'));assert.deepEqual(await platform.inspectTexts(bytes,[]),[]);
 await assert.rejects(()=>platform.inspectTexts(bytes,[1,1]),error=>error.status===400);await assert.rejects(()=>platform.inspectTexts(bytes,Array.from({length:33},(_,index)=>index+1)),error=>error.status===400);await assert.rejects(()=>platform.inspectTexts(bytes,[4]),error=>error.status===502);
 const empty=await PDFDocument.create();empty.addPage([200,300]);assert.deepEqual((await platform.inspectContext(await empty.save({useObjectStreams:false}))).sections,[]);
});
for(const provider of ['openai','gemini'])test(`${provider}: targeted task instructions avoid a compulsory second transcription`,async()=>{
 const Class=provider==='openai'?OpenAIDocumentProvider:GeminiDocumentProvider,model=provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash';
 for(const task of ['repair','relations']){
  let observed;
  const adapter=new Class(()=> 'synthetic',transport(provider,provider==='openai'?openai():gemini(),(kind,url,options)=>{if(kind==='generation')observed=JSON.parse(options.body);}));
  await adapter.extract({...base,model,task});
  const instructions=observed.instructions??observed.system_instruction;
  assert.match(instructions,/untrusted/);assert.match(instructions,/only/i);assert.doesNotMatch(instructions,/Transcribe the entire/);
  assert.match(instructions,task==='relations'?/existing block IDs/:/exact-span repair/);
 }
});

test('verified OpenAI long-input tariffs are versioned without changing the application window guard',()=>{for(const id of ['gpt-6.1-sol','gpt-6-astra']){const price=documentPrice(id,'2026-10-26');assert.equal(price.longInputThreshold,272000);assert.equal(price.longInputMultiplier,2);assert.equal(price.longOutputMultiplier,1.5);}});
