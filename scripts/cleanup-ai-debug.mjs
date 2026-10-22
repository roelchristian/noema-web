// Remove completed debug payloads while keeping activity and provider token counts.
// node --import tsx scripts/cleanup-ai-debug.mjs [database-path] [--vacuum]
import {existsSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {Store} from '../src/server/store.ts';
import {AIActivityLog} from '../src/server/modules/ai-activity.ts';
const args=process.argv.slice(2),files=args.filter(arg=>!arg.startsWith('--'));
if(files.length>1||args.some(arg=>arg.startsWith('--')&&arg!=='--vacuum'))throw new Error('Usage: cleanup-ai-debug.mjs [database-path] [--vacuum]');
const filename=path.resolve(files[0]??process.env.DB_PATH??'data/noema.sqlite');
if(!existsSync(filename))throw new Error('Database does not exist; cleanup did not create a new database.');
const db=new DatabaseSync(filename);
try {
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 const snapshot=()=>({
  fileBytes:statSync(filename).size,
  activity:db.prepare('SELECT COUNT(*) records,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,COALESCE(SUM(cached_input_tokens),0) cachedInputTokens,COALESCE(SUM(reasoning_tokens),0) reasoningTokens FROM ai_activity').get(),
  traces:db.prepare('SELECT COUNT(*) count FROM ai_activity_debug').get().count,
  events:db.prepare('SELECT COUNT(*) count FROM ai_activity_debug_events').get().count,
 });
 const before=snapshot();
 const activity=new AIActivityLog(new Store(db),{recoverRunning:false});
 activity.cleanupDebug();
 let vacuum='not requested';
 if(args.includes('--vacuum')) {
  const running=db.prepare("SELECT COUNT(*) count FROM ai_activity WHERE status='running'").get().count;
  if(running)vacuum='skipped while AI requests are running';
  else {db.exec('VACUUM');db.exec('PRAGMA wal_checkpoint(PASSIVE)');vacuum='completed';}
 }
 const after=snapshot();
 console.log(JSON.stringify({before,after,removedTraces:before.traces-after.traces,removedEvents:before.events-after.events,vacuum},null,2));
}finally{db.close();}
