import {SourceMath} from './source-math.js';
import {SourceAuthorBackfill,recordSourceAuthorsProcessed} from './source-author-backfill.js';
import {sourceEnrichmentLines} from './source-enrichment-prompt.js';
import {mergeSourceStructure} from './source-structure.js';
import {AINotifications} from './ai-notifications.js';
import {saveSourceAuthors} from './source-authors.js';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {Intelligence} from './intelligence.js';
import {AIActivityLog} from './ai-activity.js';

/** Extraction and AI enrichment have independent durable state and failure handling. */
export class SourceEnrichments {
 private busy=false;
 private closed=false;
 private mathController=new AbortController();
 private activityId?:string;
 private authorBackfill:SourceAuthorBackfill;
 constructor(private store:Store,private intelligence:Intelligence,private activity:AIActivityLog) {
  this.authorBackfill=new SourceAuthorBackfill(store,intelligence,activity);
  store.run("UPDATE source_files SET enrichment_status='pending' WHERE enrichment_status='running'");
 }
 retry(vault:string,id:string) {
  const file=this.store.get<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND id=?',vault,id);
  if(!file)throw new HttpError(404,'Source file not found');
  if(file.status!=='ready'||file.enrichment_status!=='failed')throw new HttpError(409,'Only failed enrichment of processed sources can be retried.');
  this.store.run("UPDATE source_files SET enrichment_status='pending',enrichment_error=NULL,enrichment_attempts=0,enrichment_next_attempt_at='' WHERE id=?",id);
  return this.store.get<SourceFile>('SELECT * FROM source_files WHERE id=?',id)!;
 }
 async tick() {
  if(this.closed||this.busy)return;
  this.busy=true;
  try {
   if(!this.intelligence.status().configured)return;
   const file=this.store.get<SourceFile>(`SELECT f.* FROM source_files f JOIN vaults v ON v.id=f.vault_id JOIN entities e ON e.id=f.entity_id
    WHERE f.status='ready' AND f.enrichment_status='pending' AND f.enrichment_next_attempt_at<=? AND v.locked=0 AND e.type='source' ORDER BY f.created_at LIMIT 1`,now());
   if(!file){await this.authorBackfill.tick();return;}
   const entity=this.store.get<{name:string;updated_at:string}>('SELECT name,updated_at FROM entities WHERE id=?',file.entity_id!);
   this.store.run("UPDATE source_files SET enrichment_status='running',enrichment_attempts=enrichment_attempts+1,enrichment_error=NULL WHERE id=?",file.id);
   this.activityId=this.activity.start('source_enrichment',this.intelligence.selection(),file.vault_id,file.entity_id,'entity');
   try {
    // Bound request size while sampling the beginning, middle and end of long uploads.
    const cleaned=await new SourceMath(this.store).prepare(file,async input=>{
     const activityId=this.activity.start('source_math_preprocessing',this.intelligence.selection(),file.vault_id,file.entity_id,'entity');
     try {
      const output=await this.intelligence.generate(input,false,bytes=>this.activity.request(activityId,bytes,null),false,false,false,undefined,true,{signal:this.mathController.signal,onDelta:()=>{},mathPreparation:true});
      this.activity.finish(activityId,'completed',200);return output;
     }catch(error){this.activity.finish(activityId,this.closed?'interrupted':'failed',error instanceof HttpError?error.status:500);throw error;}
    },this.mathController.signal);
    const input=sourceEnrichmentLines(cleaned.text);
    const result=await this.intelligence.enrichSource(input,bytes=>this.activity.request(this.activityId!,bytes,null));
    if(this.closed)return;
    const open=this.store.get('SELECT 1 FROM vaults WHERE id=? AND locked=0',file.vault_id);
    const current=this.store.get<SourceFile>('SELECT * FROM source_files WHERE id=?',file.id);
    if(!open||!current||current.text!==file.text||current.status!=='ready'||current.enrichment_status!=='running') {
     if(current?.enrichment_status==='running')this.store.run("UPDATE source_files SET enrichment_status='pending' WHERE id=?",file.id);
     this.activity.finish(this.activityId!,'skipped',409);return;
    }
    this.store.transaction(()=>{
     let explicit:import('../../shared/domain.js').SourceStructureNode[]=[];
     try{const parsed:unknown=JSON.parse(current.structural_nodes??'[]');if(Array.isArray(parsed))explicit=parsed;}catch{/* Recover legacy metadata from the text. */}
     // Preserve known heading locations, while allowing semantic block extents
     // to refine locally detected labels at the same line.
     const refined=result.structure.map(node=>({...explicit.find(existing=>existing.startLine===node.startLine),...node}));
     const structure=mergeSourceStructure(file.text,[...explicit,...refined]);
     this.store.run('UPDATE source_files SET structural_nodes=? WHERE id=?',JSON.stringify(structure),file.id);
     this.store.run("UPDATE source_files SET generated_name=?,language=?,summary=?,enrichment_status='completed',enrichment_error=NULL WHERE id=?",result.name,result.language,result.summary,file.id);
     // A user edit made during the request takes precedence over generated naming.
     this.store.run('UPDATE entities SET name=?,updated_at=? WHERE id=? AND vault_id=? AND name=? AND updated_at=?',result.name,now(),file.entity_id!,file.vault_id,entity!.name,entity!.updated_at);
     if(saveSourceAuthors(this.store,file.vault_id,file.entity_id!,result.authors))this.store.run('UPDATE entities SET updated_at=? WHERE id=? AND vault_id=?',now(),file.entity_id!,file.vault_id);
     recordSourceAuthorsProcessed(this.store,file);
    });
    new AINotifications(this.store).recordSource(file.vault_id,file.entity_id!,'completed','source_enrichment');
    this.activity.finish(this.activityId!,'completed',200);
   }catch(error) {
    if(this.closed)return;
    const code=error instanceof HttpError?error.status:502;
    const retry=(code===409||code===429||code>=500)&&file.enrichment_attempts<2;
    this.store.run('UPDATE source_files SET enrichment_status=?,enrichment_error=?,enrichment_next_attempt_at=? WHERE id=? AND enrichment_status=?',retry?'pending':'failed',error instanceof Error?error.message:'Source enrichment failed.',new Date(Date.now()+30000*2**file.enrichment_attempts).toISOString(),file.id,'running');
    this.activity.finish(this.activityId!,'failed',code);
   }finally{this.activityId=undefined;}
  }finally{this.busy=false;}
 }
 close() {
  this.closed=true;this.mathController.abort();
  this.authorBackfill.close();
  if(this.activityId)this.activity.finish(this.activityId,'interrupted',null);
 }
}
