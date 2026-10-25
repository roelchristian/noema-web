import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {SourceMetadata,sourceMetadataFieldFingerprint} from '../src/server/modules/source-metadata.ts';
import {proposeValue} from '../src/server/modules/property-provenance.ts';
import {locateMetadataEvidence,metadataEvidenceStaleReason} from '../src/server/modules/source-metadata-evidence.ts';
import {rewriteBackupArchive} from './helpers/backup-archive.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const text='Synthetic monograph\nPublished: 1776\nUnrelated body text.';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'noema-metadata-evidence-')),db=openDatabase(join(dir,'synthetic.sqlite')),store=new Store(db),files=new SourceFiles(store),knowledge=new Knowledge(store);
 const file=files.add('default','synthetic.md',Buffer.from(text)),source=knowledge.create('default',{name:'Synthetic monograph',type:'source',attachmentIds:[file.id]});
 store.run("UPDATE source_files SET status='ready',text=?,admitted=1 WHERE id=?",text,file.id);
 const excerpt='Published: 1776',evidence={fileId:file.id,runId:'synthetic-run',version:'canonical',revision:hash(text),excerpt,start:text.indexOf(excerpt),end:text.indexOf(excerpt)+excerpt.length,evidenceHash:hash(excerpt),validated:true,validationReason:'Explicit publication label for the identified publication.'};
 t.after(()=>{files.close();db.close();rmSync(dir,{recursive:true,force:true});});return {db,store,file,source,evidence,backups:new VaultBackups(store)};
}
test('evidence remaps only unique exact support, preserves original offsets, and fails closed for attachment and excerpt changes',t=>{
 const {store,file,source,evidence}=fixture(t),original=structuredClone(evidence),check=()=>metadataEvidenceStaleReason(store,'default',source.id,evidence);
 assert.equal(check(),null);
 store.run('UPDATE source_files SET text=? WHERE id=?','New unrelated heading\n'+text+'\nLater body update',file.id);
 assert.equal(check(),null);assert.deepEqual(locateMetadataEvidence('New unrelated heading\n'+text,evidence),{start:evidence.start+22,end:evidence.end+22});assert.deepEqual(evidence,original);
 for(const changed of [text.replace('1776','1777'),text.replace(evidence.excerpt,''),text+'\n'+evidence.excerpt]){store.run('UPDATE source_files SET text=? WHERE id=?',changed,file.id);assert.match(check(),/changed|disappeared|ambiguous/);}
 store.run('UPDATE source_files SET text=? WHERE id=?',text,file.id);
 assert.equal(locateMetadataEvidence(text,{...evidence,start:0,end:evidence.excerpt.length}),null);
 assert.equal(locateMetadataEvidence(text,{...evidence,evidenceHash:hash('forged')}),null);
 store.run("UPDATE source_files SET status='failed' WHERE id=?",file.id);assert.match(check(),/attachment/);
});
test('editorial evidence records its own derivative version and fails closed after changed or missing revisions',t=>{
 const {store,file,source,evidence}=fixture(t),derivative=text.replace('1776','1777'),excerpt='Published: 1777',stamp=new Date().toISOString();
 const proof={...evidence,version:'editorial',revision:hash(derivative),excerpt,evidenceHash:hash(excerpt)};
 store.run('INSERT INTO source_reprocessing(id,file_id,vault_id,status,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',proof.runId,file.id,'default','completed',stamp,stamp,JSON.stringify({original:{text},reprocessed:{text:derivative}}));
 assert.equal(metadataEvidenceStaleReason(store,'default',source.id,proof),null);
 store.run("UPDATE source_reprocessing SET payload=json_set(payload,'$.reprocessed.text',?) WHERE id=?",derivative+' changed',proof.runId);
 assert.equal(metadataEvidenceStaleReason(store,'default',source.id,proof),null);assert.equal(proof.revision,hash(derivative));
 for(const changed of [derivative.replace('1777','1778'),derivative+'\n'+excerpt]){store.run("UPDATE source_reprocessing SET payload=json_set(payload,'$.reprocessed.text',?) WHERE id=?",changed,proof.runId);assert.match(metadataEvidenceStaleReason(store,'default',source.id,proof),/changed|ambiguous/);}
 store.run('DELETE FROM source_reprocessing WHERE id=?',proof.runId);assert.match(metadataEvidenceStaleReason(store,'default',source.id,proof),/unavailable/);
 assert.equal('canonicalReference' in proof,false);assert.deepEqual(evidence.start,text.indexOf(evidence.excerpt));
});
test('metadata backups preserve typed evidence, decisions and policy with remapped owners, accept old backups, and roll back invalid sidecars',async t=>{
 const {db,store,file,source,evidence,backups}=fixture(t),proposal=proposeValue(store,'default',{entity_id:source.id,property_name:'bibliography:year',value:'1776',origin:'ai',source_file_id:file.id,source_hash:hash(text)});
 store.run('INSERT INTO source_metadata_candidates(proposal_id,field_key,target_fingerprint,evidence_json,status) VALUES(?,?,?,?,?)',proposal.id,'bibliography:year',sourceMetadataFieldFingerprint(source.id,'bibliography:year',null,null,undefined,null),JSON.stringify([evidence]),'pending');
 store.run('INSERT INTO source_metadata_policies VALUES(?,?,?)',source.id,'default','fill_validated_empty');
 const archive=await backups.export('default'),restored=await backups.import(archive.bytes),candidate=store.get('SELECT c.*,p.entity_id FROM source_metadata_candidates c JOIN property_proposals p ON p.id=c.proposal_id WHERE p.vault_id=?',restored.id),proof=JSON.parse(candidate.evidence_json)[0];
 assert.notEqual(candidate.entity_id,source.id);assert.notEqual(candidate.proposal_id,proposal.id);assert.notEqual(proof.fileId,file.id);assert.equal(proof.start,evidence.start);assert.equal(proof.revision,evidence.revision);assert.equal(candidate.status,'pending');
 const workspace=new SourceMetadata(store),pending=workspace.snapshot(restored.id,candidate.entity_id).fields.find(field=>field.key==='bibliography:date').proposals[0];assert.equal(candidate.target_fingerprint,sourceMetadataFieldFingerprint(candidate.entity_id,'bibliography:date',null,null,undefined,null));assert.equal(pending.stale,false,pending.staleReason);workspace.review(restored.id,candidate.entity_id,{proposalId:pending.id,fingerprint:pending.fingerprint,action:'accept',value:'1777'});assert.equal(workspace.snapshot(restored.id,candidate.entity_id).fields.find(field=>field.key==='bibliography:date').value,'1777');assert.equal(store.get('SELECT policy FROM source_metadata_policies WHERE source_id=?',candidate.entity_id).policy,'fill_validated_empty');
 const acceptedArchive=await backups.export(restored.id),acceptedRestore=await backups.import(acceptedArchive.bytes),accepted=store.get('SELECT c.decision_json,p.value,c.status FROM source_metadata_candidates c JOIN property_proposals p ON p.id=c.proposal_id WHERE p.vault_id=?',acceptedRestore.id);
 assert.equal(accepted.status,'accepted');assert.equal(accepted.value,'1776');assert.equal(JSON.parse(accepted.decision_json).value,'1777');
 const staleRestore=await backups.import(rewriteBackupArchive(archive.bytes,a=>{a.tables.source_metadata_candidates[0].target_fingerprint=hash('older target');})),staleOwner=store.get('SELECT entity_id FROM property_proposals WHERE vault_id=?',staleRestore.id);
 const staleProposal=workspace.snapshot(staleRestore.id,staleOwner.entity_id).fields.flatMap(field=>field.proposals).find(item=>item.fieldKey==='bibliography:date');assert.equal(staleProposal.stale,true);assert.match(staleProposal.staleReason,/target field/);
 const legacy=await backups.import(rewriteBackupArchive(archive.bytes,a=>{delete a.tables.source_metadata_candidates;delete a.tables.source_metadata_policies;delete a.tables.source_metadata_extraction_cache;}));
 assert.equal(store.get('SELECT count(*) n FROM source_metadata_policies WHERE vault_id=?',legacy.id).n,0);
 const before=store.get('SELECT count(*) n FROM vaults').n;
 for(const mutate of [a=>{a.tables.source_metadata_candidates[0].field_key='source:display_name';},a=>{a.tables.source_metadata_candidates[0].status='accepted';},a=>{a.tables.source_metadata_candidates[0].decision_json=JSON.stringify({action:'accept',value:'edited',at:'invalid'});},a=>{a.tables.source_metadata_candidates[0].proposal_id='foreign';},a=>{const row=a.tables.source_metadata_candidates[0],proof=JSON.parse(row.evidence_json);proof[0].fileId='foreign';row.evidence_json=JSON.stringify(proof);},a=>{a.tables.source_metadata_candidates[0].evidence_json='[{"version":"editorial"}]';},a=>{a.tables.source_metadata_policies[0].policy='confidence_only';}]){
  await assert.rejects(backups.import(rewriteBackupArchive(archive.bytes,mutate)),error=>error.status===400);assert.equal(store.get('SELECT count(*) n FROM vaults').n,before);
 }
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
