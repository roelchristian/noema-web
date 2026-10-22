// Run after building: node --import tsx scripts/benchmark-ai-debug.mjs
// Synthetic provider data only; each mode uses its own temporary SQLite database.
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
import {redactedTrace,readOpenAIResponse} from '../src/server/modules/openai-response.ts';
const directory=mkdtempSync(path.join(tmpdir(),'noema-debug-benchmark-'));
const fileBytes=file=>{try{return statSync(file).size;}catch{return 0;}};
try {
 const rows=[];
 for(const mode of ['compact','full']) {
  const filename=path.join(directory,mode+'.sqlite'),db=openDatabase(filename),store=new Store(db),log=new AIActivityLog(store);
  try {
   log.saveDebugSettings({enabled:true,...(mode==='full'?{fullTraceMinutes:15}:{})});
   db.exec('PRAGMA wal_checkpoint(TRUNCATE)');const before=fileBytes(filename);
   let writes=0,eventInserts=0,bodyWrites=0;
   const run=store.run.bind(store);
   store.run=(sql,...args)=>{if(/(?:INSERT INTO|UPDATE) ai_activity_debug/.test(sql))writes++;if(sql.startsWith('INSERT INTO ai_activity_debug_events'))eventInserts++;if(sql.startsWith('UPDATE ai_activity_debug SET response_body='))bodyWrites++;return run(sql,...args);};
   const id=log.start('page_summary',{model:'synthetic',reasoningEffort:'low'}),trace=redactedTrace(log.request(id,32000,1),'synthetic-key');
   trace.request('/responses',{model:'synthetic',input:'Private synthetic input. '.repeat(1400),stream:true});
   const delta='Synthetic output text. ',output=delta.repeat(500),final={id:'synthetic-response',status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}],usage:{input_tokens:8000,output_tokens:2500}};
   const frame=event=>`data: ${JSON.stringify(event)}\n\n`;
   const body=Array.from({length:500},()=>frame({type:'response.output_text.delta',delta})).join('')+frame({type:'response.completed',response:final});
   await readOpenAIResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),trace,undefined,undefined,trace.usage);
   log.finish(id,'completed',200);
   const summary=log.debug(id,{includeEvents:false});
   rows.push({mode,retainedBytes:summary.retainedBytes,eventInserts,debugWrites:writes,bodyWrites,summaryResponseBytes:Buffer.byteLength(JSON.stringify(summary)),walBytes:fileBytes(filename+'-wal')});
   db.exec('PRAGMA wal_checkpoint(TRUNCATE)');rows.at(-1).databaseGrowthBytes=fileBytes(filename)-before;
  }finally{db.close();}
 }
 console.table(rows);
}finally{rmSync(directory,{recursive:true,force:true});}
