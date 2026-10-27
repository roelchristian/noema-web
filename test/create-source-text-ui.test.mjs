import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {CreateEntityDialog} from '../src/client/knowledge/CreateEntityDialog.tsx';
import {api} from '../src/client/api.ts';
import {builtinProperties,builtinSubtypes} from '../src/shared/entity-schema.ts';
import {setupDOM} from './helpers/dom.mjs';

async function fixture(t,{upload,onSubmit=async()=>{},initial={source:true},capabilities={enabled:false,localExtraction:true,providers:[]}}={}) {
  const env=setupDOM(t),root=createRoot(document.querySelector('#mount')),requests=[],capabilityRequests=[],created=[];
  let closed=0;
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  env.defer(()=>act(async()=>root.unmount()));
  t.mock.method(api,'entitySchema',async()=>({properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{}}));
  t.mock.method(globalThis,'fetch',async(route,options)=>{
    if(route.endsWith('/source-ingestion/capabilities')){capabilityRequests.push({route,options});return Response.json(capabilities);}
    requests.push({route,options});
    return upload?upload(route,options):Response.json({id:'11111111-1111-4111-8111-111111111111.txt',name:new URL(route,'http://localhost').searchParams.get('name')??'URL.txt'});
  });
  await act(async()=>root.render(createElement(CreateEntityDialog,{vaultId:'synthetic-vault',initial,onClose(){closed++;},async onSubmit(input){created.push(input);await onSubmit(input);}})));
  function props(element){return element[Object.keys(element).find(key=>key.startsWith('__reactProps'))];}
  const method=value=>act(async()=>{const element=document.querySelector('[aria-label="Add source from"]');props(element).onChange({target:{value}});});
  const enter=(element,value)=>act(async()=>props(element).onChange({target:{value}}));
  const form=()=>document.querySelector('dialog form');
  const submit=()=>act(async()=>form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  return {env,requests,capabilityRequests,created,method,enter,submit,form,closed:()=>closed,textarea:()=>document.querySelector('textarea')};
}

test('New source immediately exposes all PDF processing options before a method or file is chosen',async t=>{
 const f=await fixture(t);
 assert.equal(document.querySelector('[aria-label="Add source from"]').value,'');
 assert.equal(document.querySelector('input[type=file]'),null);
 assert.ok(document.querySelector('.source-pdf-enable input'));
 const routes=document.querySelector('[aria-label="PDF processing"]');assert.ok(routes);
 assert.deepEqual([...routes.querySelectorAll('input[type=radio]')].map(input=>input.value),['local','openai','gemini']);
 assert.deepEqual([...routes.querySelectorAll('strong')].map(label=>label.textContent),['Local','OpenAI','Gemini']);
 assert.equal(f.capabilityRequests.length,1);assert.equal(f.capabilityRequests[0].options.method,'GET');
 assert.equal(f.requests.length,0,'Opening New source only reads capabilities; it never uploads or calls a provider');
 assert.equal(f.created.length,0);
});

test('Paste text stages an exact UTF-8 original and creates a genuine Source without an invented URL',async t=>{
  const f=await fixture(t);await f.method('text');
  const original='  Café e\u0301 中文 😀\r\n\r\nSecond paragraph.\n\n<script>plain text</script>  ';
  await f.enter(f.textarea(),original);
  assert.equal(f.requests.length,0,'Typing never uploads or calls AI');
  assert.equal(document.querySelector('[name="entity-name"]').value,'Pasted text');
  assert.match(document.querySelector('.source-policy').textContent,/Intelligence.*OpenAI/);
  await f.submit();
  assert.equal(f.requests.length,1);
  const {route,options}=f.requests[0],url=new URL(route,'http://localhost');
  assert.equal(url.pathname,'/api/source-files');assert.equal(url.searchParams.get('name'),'Pasted text.txt');
  assert.equal(options.headers['X-Vault-Id'],'synthetic-vault');
  assert.equal(options.body.type,'text/plain');assert.equal(await options.body.text(),original);
  assert.equal(f.created.length,1);assert.equal(f.created[0].type,'source');
  assert.deepEqual(f.created[0].attachmentIds,['11111111-1111-4111-8111-111111111111.txt']);
  assert.equal(f.created[0].name,'Pasted text');assert.ok(!('url' in f.created[0]));assert.equal(f.closed(),1);
});

test('Paste text validation, failed upload and method switches retain the draft; cancel never creates a source',async t=>{
  const f=await fixture(t,{upload:async()=>{throw new Error('Synthetic upload failed');}});await f.method('text');
  for(const value of ['  \n\t','before\0after']) {
    await f.enter(f.textarea(),value);await f.submit();
    assert.equal(f.requests.length,0);assert.equal(f.created.length,0);assert.equal(f.textarea().value,value);
    assert.ok(document.querySelector('[role="alert"]'));
  }
  const draft='Keep this paragraph.\n\nAnd this one.';
  await f.enter(f.textarea(),draft);await f.method('url');await f.method('text');
  assert.equal(f.textarea().value,draft);
  await f.submit();assert.equal(f.requests.length,1);assert.equal(f.created.length,0);assert.equal(f.textarea().value,draft);
  assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic upload failed/);
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click());
  assert.equal(f.closed(),1);assert.equal(f.requests.length,1);
});

test('pending paste creation rejects repeated submits and reuses its staged original after entity failure',async t=>{
  let finishUpload,failEntity=true;
  const f=await fixture(t,{upload:()=>new Promise(resolve=>{finishUpload=resolve;}),onSubmit:async()=>{if(failEntity)throw new Error('Synthetic entity save failed');}});
  await f.method('text');await f.enter(f.textarea(),'Retain my original\n\n第二段 😀');
  await f.enter(document.querySelector('[name="entity-name"]'),'Interview / notes');
  await act(async()=>{f.form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.form().dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(f.requests.length,1);assert.equal(f.textarea().disabled,true);assert.equal(f.closed(),0);
  assert.ok([...document.querySelectorAll('button')].some(button=>button.textContent==='Creating…'&&button.disabled));
  await act(async()=>finishUpload(Response.json({id:'11111111-1111-4111-8111-111111111111.txt',name:'Interview _ notes.txt'})));
  assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic entity save failed/);
  assert.equal(f.textarea().value,'Retain my original\n\n第二段 😀');
  assert.equal(document.querySelector('[name="entity-name"]').value,'Interview / notes');
  failEntity=false;await f.submit();
  assert.equal(f.requests.length,1,'Retry attaches the same staged original instead of uploading a duplicate');
  assert.equal(f.created.length,2);assert.deepEqual(f.created[0].attachmentIds,f.created[1].attachmentIds);
  assert.equal(f.closed(),1);
});

test('existing file and URL source paths still stage an attachment',async t=>{
  const f=await fixture(t);await f.method('file');
  const input=document.querySelector('input[type=file]'),file=new File(['Existing file'],'existing.txt',{type:'text/plain'});
  await act(async()=>input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{files:[file]}}));
  await f.submit();assert.equal(f.requests[0].options.body,file);assert.equal(f.created[0].type,'source');
  await f.method('url');await f.enter(document.querySelector('input[type=url]'),'https://example.com/reference.txt');
  await f.submit();assert.equal(f.requests[1].route,'/api/source-files/url/preview');
  assert.equal(JSON.parse(f.requests[1].options.body).url,'https://example.com/reference.txt');
  assert.equal(f.created[1].type,'source');assert.equal(f.requests.length,2);
});

test('PDF provider upload freezes consent and options and retries entity creation without another upload',async t=>{
 let failEntity=true;
 const f=await fixture(t,{onSubmit:async()=>{if(failEntity)throw new Error('Entity not saved');},capabilities:{enabled:true,localExtraction:false,providers:[{provider:'openai',available:true,models:[{id:'fixture-pdf-model'}]},{provider:'gemini',available:false,models:[]}]},upload:async()=>Response.json({id:'provider.pdf',name:'fixture.pdf'})});
 await f.method('file');
 const input=document.querySelector('input[type=file]');
 await act(async()=>input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{files:[new File(['%PDF synthetic'],'fixture.pdf',{type:'application/pdf'})]}}));
 const route=document.querySelector('[aria-label="PDF processing"]');assert.ok(route);
 assert.equal(route.querySelector('[value="local"]').disabled,true);
 await act(async()=>route.querySelector('input[value="openai"]').click());
 await f.submit();assert.equal(f.created.length,0,'PDF cannot be transmitted without affirmative consent');
 const consent=[...document.querySelectorAll('input[type=checkbox]')].find(item=>item.closest('label').textContent.includes('Allow selected source evidence'));
 await act(async()=>consent[Object.keys(consent).find(key=>key.startsWith('__reactProps'))].onChange({target:{checked:true}}));
 await f.submit();
 const uploads=f.requests.filter(item=>new URL(item.route,'http://localhost').pathname==='/api/source-files');assert.equal(uploads.length,1);
 const options=JSON.parse(new URL(uploads[0].route,'http://localhost').searchParams.get('ingestion'));
 assert.equal(options.route,'openai');assert.equal(options.model,'fixture-pdf-model');assert.equal(options.depth,'balanced');assert.equal(options.reviewPolicy,'verified');assert.equal(options.transmissionConsent,true);
 failEntity=false;await f.submit();assert.equal(f.requests.filter(item=>new URL(item.route,'http://localhost').pathname==='/api/source-files').length,1);
 assert.equal(f.created.length,2);assert.deepEqual(f.created[0].attachmentIds,f.created[1].attachmentIds);
 await f.enter(document.querySelector('[aria-label="Reconstruction depth"]'),'light');await f.submit();
 const changedUploads=f.requests.filter(item=>new URL(item.route,'http://localhost').pathname==='/api/source-files');assert.equal(changedUploads.length,2,'Changing frozen options invalidates the staged attachment');
 assert.equal(JSON.parse(new URL(changedUploads[1].route,'http://localhost').searchParams.get('ingestion')).depth,'light');
 assert.notEqual(new URL(changedUploads[0].route,'http://localhost').searchParams.get('stagingKey'),new URL(changedUploads[1].route,'http://localhost').searchParams.get('stagingKey'));
 await act(async()=>input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{files:[new File(['%PDF second synthetic'],'second.pdf',{type:'application/pdf'})]}}));
 assert.equal([...document.querySelectorAll('input[type=checkbox]')].find(item=>item.closest('label').textContent.includes('Allow selected source evidence')).checked,false,'Changing the PDF clears document transmission consent');
 await f.submit();assert.equal(f.requests.filter(item=>new URL(item.route,'http://localhost').pathname==='/api/source-files').length,2);
});

test('URL content is identified as PDF before provider choice and consent, with one retained fetch',async t=>{
 let failEntity=true;
 const f=await fixture(t,{onSubmit:async()=>{if(failEntity)throw new Error('Entity not saved');},capabilities:{enabled:true,localExtraction:false,providers:[{provider:'openai',available:true,models:[{id:'fixture-pdf-model'}]}]},upload:async(route,options)=>{
  if(route.endsWith('/url/preview'))return Response.json({id:'fetched.pdf',name:'detected.pdf',format:'pdf'});
  assert.equal(route,'/api/source-files/fetched.pdf/ingestion');return Response.json({id:'fetched.pdf',name:'detected.pdf',format:'pdf',ingestion_origin:JSON.parse(options.body).options.route});
 }});
 await f.method('url');await f.enter(document.querySelector('input[type=url]'),'https://example.com/document-without-extension');
 assert.ok(document.querySelector('[aria-label="PDF processing"]'),'Processing options are discoverable before fetching content');assert.equal(f.requests.length,0,'Visible options do not transmit URL content');
 await f.submit();assert.equal(f.created.length,0);assert.equal(f.requests.filter(item=>item.route.endsWith('/url/preview')).length,1);
 assert.ok(document.querySelector('[aria-label="PDF processing"]'));assert.match(document.body.textContent,/fetched content is a PDF/);
 await act(async()=>document.querySelector('[aria-label="PDF processing"] input[value="openai"]').click());await f.submit();assert.equal(f.requests.filter(item=>item.route.endsWith('/ingestion')).length,0,'No stage/transmission without consent');
 await f.enter(document.querySelector('[aria-label="Reconstruction depth"]'),'deep');
 const consent=[...document.querySelectorAll('input[type=checkbox]')].find(item=>item.closest('label').textContent.includes('Allow selected source evidence'));
 await act(async()=>consent[Object.keys(consent).find(key=>key.startsWith('__reactProps'))].onChange({target:{checked:true}}));
 await f.submit();assert.equal(f.requests.filter(item=>item.route.endsWith('/url/preview')).length,1,'Options reuse the already fetched PDF');
 const stages=f.requests.filter(item=>item.route.endsWith('/ingestion'));assert.equal(stages.length,1);assert.equal(JSON.parse(stages[0].options.body).options.transmissionConsent,true);assert.equal(JSON.parse(stages[0].options.body).options.depth,'deep');
 failEntity=false;await f.submit();assert.equal(f.requests.filter(item=>item.route.endsWith('/ingestion')).length,1,'Entity retry reuses frozen stage');assert.equal(f.created.length,2);
 await f.enter(document.querySelector('input[type=url]'),'https://example.com/other');assert.ok(document.querySelector('[aria-label="PDF processing"]'),'Options remain visible after changing URL');assert.equal(document.querySelector('.reprocessing-transmission-consent input').checked,false,'Changing URL invalidates transmission consent');
});


test('PDF provider settings can be enabled in the UI with separate provider choices and fresh consent',async t=>{
 const {SourcePdfProcessing,initialPdfIngestionOptions}=await import('../src/client/knowledge/SourcePdfProcessing.tsx');
 const {useState}=await import('react');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount')),requests=[];
 env.defer(()=>act(async()=>root.unmount()));
 let enabled=false,ready=false,current;
 const providers=[{provider:'openai',available:true,models:[{id:'gpt-6.1-sol'}]},{provider:'gemini',available:true,models:[{id:'gemini-3.8-flash'}]}];
 t.mock.method(globalThis,'fetch',async(route,options)=>{
  requests.push({route,options});
  if(options.method==='PUT'){enabled=JSON.parse(options.body).enabled;return Response.json({enabled});}
  return Response.json({enabled,localExtraction:true,providers});
 });
 function Form(){const [value,setValue]=useState(initialPdfIngestionOptions);current=value;return createElement(SourcePdfProcessing,{vaultId:'ui-settings',value,onChange:setValue,onReady:value=>{ready=value;},disabled:false});}
 await act(async()=>root.render(createElement(Form)));
 const toggle=()=>document.querySelector('.source-pdf-enable input');
 const radio=provider=>document.querySelector(`.source-pdf-routes input[value="${provider}"]`);
 assert.equal(toggle().checked,false);assert.equal(radio('openai').disabled,true);assert.equal(radio('gemini').disabled,true);assert.equal(ready,true);
 await act(async()=>toggle().click());
 assert.equal(toggle().checked,true);assert.equal(radio('openai').disabled,false);assert.equal(radio('gemini').disabled,false);
 assert.deepEqual(JSON.parse(requests.find(item=>item.options.method==='PUT').options.body),{enabled:true});
 await act(async()=>radio('openai').click());
 assert.equal(current.route,'openai');assert.equal(current.model,'gpt-6.1-sol');assert.equal(ready,false);
 const consent=()=>document.querySelector('.reprocessing-transmission-consent input');
 await act(async()=>consent().click());assert.equal(ready,true);
 await act(async()=>radio('gemini').click());
 assert.equal(current.route,'gemini');assert.equal(current.model,'gemini-3.8-flash');assert.equal(current.transmissionConsent,false);assert.equal(ready,false);
 assert.equal(document.querySelector('[aria-label="Document model"]').closest('details'),null,'Model choice is visible without opening advanced settings');
 assert.equal(requests.filter(item=>item.options.method==='PUT').length,1,'Choosing providers never transmits a PDF or changes server settings');
 await act(async()=>toggle().click());
 assert.equal(current.route,'local');assert.equal(current.transmissionConsent,false);assert.equal(ready,true);assert.equal(radio('openai').disabled,true);
});

test('PDF processing capability failures remain visible and block upload until retried',async t=>{
 const {SourcePdfProcessing,initialPdfIngestionOptions}=await import('../src/client/knowledge/SourcePdfProcessing.tsx');
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 let fail=true,ready=true;
 t.mock.method(globalThis,'fetch',async()=>{if(fail)throw new Error('Synthetic capability failure');return Response.json({enabled:false,localExtraction:true,providers:[]});});
 await act(async()=>root.render(createElement(SourcePdfProcessing,{vaultId:'capability-failure',value:initialPdfIngestionOptions,onChange(){},onReady:value=>{ready=value;},disabled:false})));
 assert.equal(ready,false);assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic capability failure/);
 fail=false;await act(async()=>document.querySelector('[role="alert"] button').click());
 assert.equal(document.querySelector('[role="alert"]'),null);assert.equal(ready,true);
});


test('New source offers single-entry BibTeX while create-and-insert keeps its existing creation contract',async t=>{
 const f=await fixture(t);assert.ok([...document.querySelector('[aria-label="Add source from"]').options].some(option=>option.value==='bibtex'));await f.method('bibtex');assert.match(document.querySelector('dialog h2').textContent,/New source from BibTeX/);assert.equal(f.requests.length,0);
});

test('create-and-insert source creation keeps the original submission flow',async t=>{
 await fixture(t,{initial:{source:true,intent:'insert',onCreated(){}}});assert.equal([...document.querySelector('[aria-label="Add source from"]').options].some(option=>option.value==='bibtex'),false);
});
