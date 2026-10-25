import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setupSourceReprocessingVersionSchema} from '../src/server/source-reprocessing-version-schema.ts';
import {setupSourceReprocessingSummarySchema} from '../src/server/source-reprocessing-summary-schema.ts';

function harness(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE source_files(id TEXT PRIMARY KEY);INSERT INTO source_files VALUES('f'),('g');
 CREATE TABLE source_reprocessing(id TEXT PRIMARY KEY,file_id TEXT,vault_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,payload TEXT);`);
 const insert=(id,status='queued',file='f',versionNumber)=>db.prepare('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)').run(id,file,'v',status,id,id,JSON.stringify({id,fileId:file,status,versionNumber,report:{},patches:[]}));
 const version=id=>JSON.parse(db.prepare('SELECT payload FROM source_reprocessing WHERE id=?').get(id).payload).versionNumber;
 return {db,insert,version};
}

test('migration numbers all statuses once and deletion of all runs never reuses their numbers',t=>{
 const {db,insert,version}=harness(t);insert('a','failed');insert('b','interrupted');insert('c','completed');insert('d','running');
 setupSourceReprocessingSummarySchema(db);setupSourceReprocessingVersionSchema(db);
 assert.deepEqual(['a','b','c','d'].map(version),[1,2,3,4]);
 db.exec("DELETE FROM source_reprocessing WHERE id IN ('a','d')");setupSourceReprocessingVersionSchema(db);
 assert.equal(version('b'),2);assert.equal(version('c'),3);
 insert('e');assert.equal(version('e'),5);
 db.exec('DELETE FROM source_reprocessing');setupSourceReprocessingVersionSchema(db);insert('f');assert.equal(version('f'),6);
 insert('other','queued','g');assert.equal(version('other'),1);
 const summary=JSON.parse(db.prepare("SELECT summary_json FROM source_reprocessing WHERE id='f'").get().summary_json);assert.equal(summary.versionNumber,6);
});

test('version remains immutable through status changes and rejected updates roll back',t=>{
 const {db,insert,version}=harness(t);setupSourceReprocessingVersionSchema(db);insert('a');
 db.exec("UPDATE source_reprocessing SET status='failed',payload=json_set(payload,'$.status','failed') WHERE id='a'");assert.equal(version('a'),1);
 assert.throws(()=>db.exec("UPDATE source_reprocessing SET payload=json_set(payload,'$.versionNumber',9) WHERE id='a'"),/immutable/);
 assert.throws(()=>db.exec("UPDATE source_reprocessing SET payload=json_remove(payload,'$.versionNumber') WHERE id='a'"),/immutable/);
 db.exec('BEGIN');insert('rollback');db.exec('ROLLBACK');insert('b');assert.equal(version('b'),2);
});

test('restored ordinal gaps and source high-water marks survive subsequent inserts',t=>{
 const {db,insert,version}=harness(t);setupSourceReprocessingVersionSchema(db);
 insert('high','completed','f',8);insert('low','failed','f',2);setupSourceReprocessingVersionSchema(db);
 insert('next');assert.equal(version('next'),9);assert.equal(version('low'),2);
});
