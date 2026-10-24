import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setupSourceReprocessingSummarySchema} from '../src/server/source-reprocessing-summary-schema.ts';
import {SourceReprocessing} from '../src/server/modules/source-reprocessing.ts';
import {Store} from '../src/server/store.ts';

const table=`CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT)`;
const snapshot='Synthetic academic document. '.repeat(10000);
const revision=id=>({id,fileId:'f',createdAt:id,updatedAt:id,status:'completed',baseHash:'base',instructions:'Preserve evidence',furniture:[{text:snapshot,hidden:false}],patches:[{decision:'pending'},{decision:'accepted'},{decision:'rejected'}],original:{text:snapshot},reprocessed:{text:snapshot},nodeLinks:[{originalNodeId:'a',reprocessedNodeIds:['b']}],report:{chunksCompleted:2,chunksTotal:2,diagnostics:['Scholarly observation'],validationDiagnostics:['Detail only'],excerpts:[{index:0,attemptHistory:[{error:'detail'}]}]}});
const insert=(db,r,vault='v')=>db.prepare('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)').run(r.id,r.fileId,vault,r.status,r.createdAt,r.updatedAt,JSON.stringify(r));

test('revision summary migration preserves full legacy payload and maintains counts on insert, review and resume',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(table);const r=revision('legacy');insert(db,r);const original=JSON.stringify(r);
  setupSourceReprocessingSummarySchema(db);setupSourceReprocessingSummarySchema(db);
  let row=db.prepare('SELECT payload,summary_json FROM source_reprocessing WHERE id=?').get(r.id),summary=JSON.parse(row.summary_json);
  assert.equal(row.payload,original);assert.equal(summary.patchCount,3);assert.equal(summary.pendingCount,1);assert.equal(summary.original,undefined);assert.equal(summary.reprocessed,undefined);assert.equal(summary.patches,undefined);assert.equal(summary.nodeLinks,undefined);assert.equal(summary.furniture,undefined);assert.deepEqual(summary.report.diagnostics,[]);assert.equal(summary.report.excerpts,undefined);assert.equal(summary.report.validationDiagnostics,undefined);assert.ok(row.summary_json.length<1000);
  r.status='queued';r.updatedAt='updated';r.patches[0].decision='accepted';
  db.prepare('UPDATE source_reprocessing SET status=?,updated_at=?,payload=? WHERE id=?').run(r.status,r.updatedAt,JSON.stringify(r),r.id);
  summary=JSON.parse(db.prepare('SELECT summary_json FROM source_reprocessing WHERE id=?').get(r.id).summary_json);
  assert.equal(summary.status,'queued');assert.equal(summary.pendingCount,0);assert.equal(summary.patchCount,3);assert.equal(summary.updatedAt,'updated');
  const restored=revision('restored');restored.patches=[];insert(db,restored);
  summary=JSON.parse(db.prepare('SELECT summary_json FROM source_reprocessing WHERE id=?').get(restored.id).summary_json);assert.equal(summary.patchCount,0);assert.equal(summary.pendingCount,0);
 }finally{db.close();}
});

test('revision list loads at most 100 persisted summaries scoped to file and vault without fetching snapshots',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(table);setupSourceReprocessingSummarySchema(db);
  for(let i=0;i<105;i++)insert(db,revision(String(i).padStart(3,'0')));
  insert(db,revision('foreign-vault'),'other');
  const foreign=revision('foreign-file');foreign.fileId='other';insert(db,foreign);
  const queries=[],store=new Store(db),all=store.all.bind(store);store.all=(sql,...args)=>{queries.push(sql);return all(sql,...args);};
  const service=new SourceReprocessing(store,{require:()=>({})},{},()=>{},{});service.currentHash=()=> 'base';queries.length=0;
  const list=service.list('v','f');assert.equal(list.length,100);assert.equal(list[0].id,'104');assert.equal(list.at(-1).id,'005');assert.ok(list.every(item=>item.stale===false&&item.patchCount===3&&item.pendingCount===1));
  assert.ok(queries.every(sql=>!/SELECT\s+\*|\bpayload\b/i.test(sql)));assert.ok(queries.some(sql=>/summary_json/.test(sql)));assert.ok(JSON.stringify(list).length<100000);
 }finally{db.close();}
});
