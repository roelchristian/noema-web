// Disposable browser fixture. All source data and mutations remain in memory.
// Run: node scripts/source-workspace-safari-fixture.mjs, then open the printed URL in Safari.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';

const repo=resolve(import.meta.dirname,'..'),moduleId=resolve(repo,'__source-workspace-fixture.tsx');
const template=JSON.parse(readFileSync(resolve(repo,'test/fixtures/dante-editorial-revision.json'),'utf8'));
template.id='revision';template.fileId='fixture.pdf';template.stale=false;template.status='completed';
template.pipelineVersion=2;template.configuration={depth:'balanced',reviewPolicy:'verified',evidence:{originalPages:false,ocr:false,allowExternalTransmission:false}};
template.report.chunksCompleted=template.report.chunksTotal=3;
template.patches=template.patches.slice(0,3).map((patch,index)=>({...patch,id:'patch-'+index,decision:index===2?'accepted':'pending'}));
const mutations=[];
let revision=structuredClone(template);
const file={id:'fixture.pdf',entity_id:'source',vault_id:'fixture',name:'Scholarly source.pdf',format:'pdf',status:'ready',admitted:1,text:template.original.text,document:template.original.document,textHash:'fixture-canonical',pages:5,page_start_lines:'[]',structural_nodes:'[]',enrichment_status:'completed',generated_name:null,language:'en',source_url:null};
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__source-workspace-fixture.tsx"></script></body></html>';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {SourceReader} from '/src/client/sources/SourceReader.tsx';import '/src/client/styles/tokens.css';import '/src/client/styles.css';
const params=new URLSearchParams(location.search);document.documentElement.dataset.mode=params.get('theme')||'light';
const noop=()=>{};createRoot(document.querySelector('#root')).render(<main style={{padding:'24px',maxWidth:'1500px',margin:'auto'}}><SourceReader vaultId="fixture" source={{id:'source',name:'Teaching Dante — Review fixture',subtypes:[],updated_at:'fixed'}} entities={[]} onOpenEntity={noop} onCreatePageFromSource={noop} onError={message=>console.error(message)} onAddPassage={noop} onAnnotate={noop} onReadingNoteCreated={noop} onOpenReadingNote={noop} onRemoveReadingNote={noop}/></main>);`;
const server=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:5197,strictPort:true},plugins:[{name:'source-workspace-synthetic',resolveId(id){return id==='/__source-workspace-fixture.tsx'?moduleId:null;},load(id){return id===moduleId?source:undefined;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');const width=url.searchParams.get('width');res.end(width?`<!doctype html><html><body style="margin:0;background:#888"><iframe title="Responsive source workspace" style="border:0;width:${Number(width)||390}px;height:100vh" src="/fixture?theme=${url.searchParams.get('theme')||'light'}"></iframe></body></html>`:await vite.transformIndexHtml(req.url,html));return;}
 if(url.pathname==='/fixture-state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({revision,mutations}));return;}
 if(url.pathname==='/fixture-reset'){revision=structuredClone(template);if(url.searchParams.get('status'))revision.status=url.searchParams.get('status');if(revision.status!=='completed'){revision.report.chunksCompleted=1;revision.report.stage='verifying';revision.report.stageProgress={completed:1,total:3};revision.report.error=revision.status==='failed'?'Synthetic provider configuration failure.':undefined;revision.report.errorCode=revision.status==='failed'?'provider_http_400':undefined;}res.end('Fixture reset; return to /fixture.');return;}
 if(!url.pathname.startsWith('/api/'))return next();
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 let result;
 if(req.method!=='GET'){mutations.push({url:url.pathname,method:req.method,body});if(url.pathname.endsWith('/review'))revision={...revision,updatedAt:new Date().toISOString(),patches:revision.patches.map(p=>{const d=body.decisions.find(d=>d.patchId===p.id);return d?{...p,decision:d.decision,...(d.replacement===undefined?{}:{userReplacement:d.replacement})}:p;})};else if(url.pathname.endsWith('/cancel'))revision.status='interrupted';else if(url.pathname.endsWith('/resume')||url.pathname.endsWith('/reprocessing'))revision.status='running';result=url.pathname.includes('/reading-locations')?{ok:true}:revision;}
 else if(url.pathname==='/api/entities/source')result={attachments:[file]};
 else if(url.pathname==='/api/source-files/fixture.pdf')result=file;
 else if(url.pathname.endsWith('/reading-locations'))result={resume:null,bookmarks:[]};
 else if(url.pathname.endsWith('/highlights')||url.pathname.endsWith('/reading-notes'))result=[];
 else if(url.pathname.endsWith('/reprocessing/capabilities'))result={originalPages:true,ocr:true,externalImages:true,reason:'Synthetic evidence; no provider requests.'};
 else if(url.pathname==='/api/intelligence')result={model:'gpt-5-mini',reasoningEffort:'low'};
 else if(url.pathname.endsWith('/reprocessing'))result=[{...revision,patchCount:revision.patches.length,pendingCount:revision.patches.filter(p=>p.decision==='pending').length}];
 else if(url.pathname.endsWith('/status'))result={id:revision.id,status:revision.status,updatedAt:revision.updatedAt,...revision.report};
 else if(url.pathname.endsWith('/evidence'))result={originalAvailable:true,rawExtraction:{pageEvidence:[{page:Number(url.searchParams.get('page')),method:'native',text:'Synthetic original PDF evidence.'}]}};
 else if(url.pathname.includes('/page-image/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><text x="40" y="80" fill="black" font-size="24">Synthetic PDF evidence</text></svg>');return;}
 else result=revision;
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });}}]});
await server.listen();console.log('Synthetic source workspace: http://127.0.0.1:5197/fixture');
console.log('Use ?width=390&theme=dark for responsive dark fixture; /fixture-reset?status=interrupted or failed to inspect recovery.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await server.close();process.exit(0);});
