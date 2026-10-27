// Live, paid benchmark. Uses the configured Noema app; never reads credentials.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const base=process.env.BENCHMARK_BASE_URL||'http://localhost:5173';
const out=path.resolve(process.env.BENCHMARK_OUTPUT_DIR||'output/pdf-benchmark-chevalley');mkdirSync(out,{recursive:true});
const sourceUrl=process.env.BENCHMARK_SOURCE_URL||'https://kconrad.math.uconn.edu/blurbs/gradnumthy/chevalleyunit.pdf';
const sourceName=process.env.BENCHMARK_SOURCE_NAME||'Chevalley';
const sourceStem=process.env.BENCHMARK_SOURCE_STEM||'chevalleyunit';
const selectedProviders=(process.env.BENCHMARK_PROVIDERS||'gemini,openai').split(',');
if(!selectedProviders.length||new Set(selectedProviders).size!==selectedProviders.length||selectedProviders.some(provider=>!['gemini','openai'].includes(provider)))throw Error('BENCHMARK_PROVIDERS must select gemini, openai, or both once.');
const expectedPromptVersion=process.env.BENCHMARK_EXPECTED_PROMPT_VERSION;
const reportPath=path.join(out,'results.json');
if(existsSync(reportPath)&&!process.argv.includes('--new-run'))throw Error('Results already exist; use --new-run to authorize additional paid runs.');
const bytes=readFileSync(path.join(out,'source.pdf'));
const vaults=await api('/api/vaults');const vault=vaults.find(v=>!v.locked);if(!vault)throw Error('No unlocked vault');
const headers={'x-vault-id':vault.id,'x-noema-request':'1'};
async function api(route,options={}){const r=await fetch(base+route,options);const text=await r.text();if(!r.ok)throw Error(`${route}: ${r.status} ${text.slice(0,800)}`);return JSON.parse(text);}
const db=new DatabaseSync(path.resolve('data/noema.sqlite'),{readOnly:true});
const report={date:new Date().toISOString(),base,vaultId:vault.id,input:{url:sourceUrl,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},method:'One sequential live run per selected provider; identical balanced/verified settings. API latency measured by monotonic clock. Stage polling resolution 500ms. Durable timestamps provide attempt duration. Upload/inference/cleanup are not independently instrumented by the running app.',runs:[]};
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
for(const [provider,model] of [['gemini','gemini-3.8-flash'],['openai','gpt-6.1-sol']].filter(([provider])=>selectedProviders.includes(provider))){
 const run={provider,model,startedAt:new Date().toISOString(),timeline:[]};report.runs.push(run);save();const start=performance.now();
 try{
 const config={route:provider,model,depth:'balanced',reviewPolicy:'verified',containsMath:true,guidance:'',transmissionConsent:true,budget:{maxRequests:4,maxOutputTokens:32000,maxCostUsd:null}};run.config=config;
 let t=performance.now();const file=await api('/api/source-files?'+new URLSearchParams({name:`${sourceStem}-benchmark-${provider}.pdf`,containsMath:'true',ingestion:JSON.stringify(config),stagingKey:'benchmark-'+randomUUID()}),{method:'POST',headers:{...headers,'content-type':'application/pdf'},body:bytes});run.uploadAndStagingMs=performance.now()-t;run.fileId=file.id;save();
 t=performance.now();const entity=await api('/api/entities',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({name:`PDF benchmark: ${sourceName} (${provider})`,type:'source',attachmentIds:[file.id]})});run.sourceId=entity.id;run.entityCreationMs=performance.now()-t;save();
 let last='';let lastDurable='';run.stageObservations=[];for(;;){const durableState=db.prepare('SELECT state,stage,created_at,updated_at FROM source_ingestion_runs WHERE file_id=?').get(file.id);const durableAttempts=db.prepare('SELECT a.id,a.state,a.kind,a.created_at,a.updated_at FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id JOIN source_ingestion_runs r ON r.id=w.run_id WHERE r.file_id=? ORDER BY a.created_at').all(file.id);const durableSignature=JSON.stringify([durableState,durableAttempts]);if(durableSignature!==lastDurable){run.stageObservations.push({observedAt:new Date().toISOString(),run:durableState,attempts:durableAttempts});lastDurable=durableSignature;save();}const p=await api(`/api/source-files/${file.id}/ingestion`,{headers});run.progress=p;const signature=JSON.stringify([p.state,p.stage,p.completedPages,p.windows.map(w=>[w.state,w.repairState])]);if(signature!==last){run.timeline.push({elapsedMs:performance.now()-start,observedAt:new Date().toISOString(),state:p.state,stage:p.stage,completedPages:p.completedPages,windows:p.windows});last=signature;console.log(provider,p.state,p.stage,p.completedPages+'/'+p.pageCount);save();}if(['completed','failed','unknown','paused'].includes(p.state))break;if(performance.now()-start>25*60*1000){run.monitorTimedOut=true;break;}await new Promise(r=>setTimeout(r,500));}
 run.elapsedMs=performance.now()-start;
 run.durableRun=db.prepare('SELECT state,stage,created_at,updated_at,error FROM source_ingestion_runs WHERE file_id=?').get(file.id);
 run.attempts=db.prepare('SELECT a.*,w.ordinal,w.kind AS window_kind,w.plan_json FROM source_ingestion_attempts a JOIN source_ingestion_windows w ON w.id=a.window_id JOIN source_ingestion_runs r ON r.id=w.run_id WHERE r.file_id=? ORDER BY a.created_at').all(file.id).map(({candidate_json,...a})=>({...a,usage:a.usage_json?JSON.parse(a.usage_json):null,durationMs:Date.parse(a.updated_at)-Date.parse(a.created_at)}));
 run.activity=db.prepare("SELECT id,action,status,model,started_at,finished_at,duration_ms,input_tokens,output_tokens,reasoning_tokens,cached_input_tokens,estimated_cost FROM ai_activity WHERE object_id=? AND action='source_ingestion' AND started_at>=? ORDER BY started_at").all(entity.id,run.startedAt);
 const doc=db.prepare('SELECT document_json,assembly_json,provenance_json FROM source_ingestion_documents WHERE file_id=?').get(file.id);
 if(doc){writeFileSync(path.join(out,provider+'.json'),JSON.stringify(JSON.parse(doc.document_json),null,2)+'\n');writeFileSync(path.join(out,provider+'-assembly.json'),doc.assembly_json);const d=JSON.parse(doc.document_json);writeFileSync(path.join(out,provider+'.txt'),d.blocks.map(b=>`[Page ${b.page}; ${b.kind}]\n${b.text}`).join('\n\n'));run.provenance=JSON.parse(doc.provenance_json);run.expectedPromptVersion=expectedPromptVersion??null;run.promptVersionMatches=expectedPromptVersion?run.provenance.promptVersion===expectedPromptVersion:null;run.blockCount=d.blocks.length;run.pages=d.pages.map(p=>({number:p.number,state:p.state,unresolved:p.unresolved}));}
 }catch(e){run.error=e.message;run.elapsedMs=performance.now()-start;console.log(provider,'error:',e.message);}
 save();
}
db.close();console.log('Saved',reportPath);
