import {bibliographicLegacyConflicts,assertBibliographicReconciliation} from './bibliographic-property-projection.js';
import {exportBibliographicBundle} from './bibliographic-export.js';
import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {parseBibliography,exportBibliography,normalizeDoi,isCitationKey,type BibliographicEntry} from '../../shared/bibliography.js';
import {Store} from '../store.js';
import {HttpError,now,required,text,object} from '../validation.js';
import {Vaults} from './vaults.js';

export function setupBibliographySchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS bibliographic_import_batches (id TEXT NOT NULL,vault_id TEXT NOT NULL REFERENCES vaults(id),raw TEXT NOT NULL,PRIMARY KEY(vault_id,id));
 CREATE TABLE IF NOT EXISTS bibliographic_records (
 source_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id),
 citation_key TEXT NOT NULL,entry_type TEXT NOT NULL,fields_json TEXT NOT NULL,provenance_json TEXT NOT NULL,raw_imports_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,UNIQUE(vault_id,citation_key));
 CREATE TABLE IF NOT EXISTS bibliographic_proposals (
 id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id),
 revision INTEGER NOT NULL,provider TEXT NOT NULL,fields_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
}
type Origin='manual'|'bibtex'|'crossref'|'datacite'|'ai';
interface Provenance {origin:Origin;at:string;history?:{value:string;origin:Origin;at:string}[]}
interface Row {source_id:string;vault_id:string;citation_key:string;entry_type:string;fields_json:string;provenance_json:string;raw_imports_json:string;revision:number}
export interface BibliographyRecord {sourceId:string;citationKey:string;entryType:string;fields:Record<string,string>;provenance:Record<string,Provenance>;rawImports:string[];revision:number}
type ImportConflict={field:string;current:string;incoming:string;currentOrigin?:string};
type Match={sourceId:string;title:string;reason:'doi'|'isbn'|'key'|'title';revision:number;conflicts?:ImportConflict[]};
const digest=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const fold=(v:string)=>v.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
const isbn=(v:string)=>v.replace(/[^\dXx]/g,'').toUpperCase();
function fields(value:unknown) {const result=object(value);if(Object.keys(result).length>200)throw new HttpError(400,'Too many bibliographic fields');const clean:Record<string,string>={};for(const [key,val] of Object.entries(result)){if(!/^[a-z][a-z0-9_:.-]{0,63}$/i.test(key))throw new HttpError(400,'Invalid bibliographic field');clean[key.toLowerCase()]=text(val,100000);}return clean;}
function citationKey(value:unknown) {const key=required(value,200);if(!isCitationKey(key))throw new HttpError(400,'Invalid citation key');return key;}
function entryType(value:unknown) {const type=required(value,100).toLowerCase();if(!/^[a-z][a-z0-9_-]*$/.test(type))throw new HttpError(400,'Invalid entry type');return type;}
export class Bibliography {
 constructor(protected store:Store) {}
 protected open(vault:string) {new Vaults(this.store).requireOpen(vault);}
 protected source(vault:string,id:string) {this.open(vault);if(!this.store.get("SELECT 1 FROM entities WHERE vault_id=? AND id=? AND type='source' AND archived_at IS NULL",vault,id))throw new HttpError(404,'Source not found');}
 private row(vault:string,id:string) {return this.store.get<Row>('SELECT * FROM bibliographic_records WHERE vault_id=? AND source_id=?',vault,id);}
 private record(row:Row):BibliographyRecord {return {sourceId:row.source_id,citationKey:row.citation_key,entryType:row.entry_type,fields:JSON.parse(row.fields_json),provenance:JSON.parse(row.provenance_json),rawImports:(JSON.parse(row.raw_imports_json) as string[]).map(raw=>this.store.get<{raw:string}>('SELECT raw FROM bibliographic_import_batches WHERE vault_id=? AND id=?',row.vault_id,raw)?.raw??raw),revision:row.revision};}
 get(vault:string,id:string) {this.source(vault,id);const row=this.row(vault,id);return row?this.record(row):null;}
 list(vault:string,includeRaw=false) {this.open(vault);return this.store.all<Row>("SELECT b.* FROM bibliographic_records b JOIN entities e ON e.id=b.source_id WHERE b.vault_id=? AND e.archived_at IS NULL ORDER BY b.citation_key",vault).map(row=>this.record(includeRaw?row:{...row,raw_imports_json:'[]'}));}
 private parse(raw:unknown) {const input=text(raw,2000000);try {const result=parseBibliography(input);if(!result.entries.length||result.entries.length>2000)throw new Error('Choose between 1 and 2000 records');return result;}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid bibliography');}}
 private matches(vault:string,entry:BibliographicEntry):Match[] {
 const doi=normalizeDoi(entry.fields.doi??''),book=isbn(entry.fields.isbn??''),title=fold(entry.fields.title??'');
 const records=this.list(vault,false),matches:Match[]=[];
 for(const record of records){const reason=doi&&doi===normalizeDoi(record.fields.doi??'')?'doi':book&&book===isbn(record.fields.isbn??'')?'isbn':record.citationKey===entry.citationKey?'key':title&&title===fold(record.fields.title??'')?'title':undefined;if(reason)matches.push({sourceId:record.sourceId,title:record.fields.title??record.citationKey,reason,revision:record.revision});}
 // Sources without bibliographic records remain candidates, never automatic merges.
 for(const property of this.store.all<{entity_id:string;name:string;value:string;title:string}>("SELECT p.entity_id,p.name,p.value,e.name AS title FROM properties p JOIN entities e ON e.id=p.entity_id WHERE e.vault_id=? AND e.type='source' AND e.archived_at IS NULL AND lower(p.name) IN ('doi','isbn') AND p.value IS NOT NULL",vault)){const reason=property.name.toLowerCase()==='doi'&&doi&&normalizeDoi(property.value)===doi?'doi':property.name.toLowerCase()==='isbn'&&book&&isbn(property.value)===book?'isbn':undefined;if(reason&&!matches.some(match=>match.sourceId===property.entity_id))matches.push({sourceId:property.entity_id,title:property.title,reason,revision:this.get(vault,property.entity_id)?.revision??0});}
 if(title)for(const source of this.store.all<{id:string;name:string}>("SELECT id,name FROM entities WHERE vault_id=? AND type='source' AND archived_at IS NULL AND id NOT IN (SELECT source_id FROM bibliographic_records)",vault))if(fold(source.name)===title)matches.push({sourceId:source.id,title:source.name,reason:'title',revision:0});
 return matches;
 }
 private conflicts(entry:BibliographicEntry,current:BibliographyRecord|null):ImportConflict[] {
 return current?Object.keys(entry.fields).filter(field=>current.fields[field]!==undefined&&current.fields[field]!==entry.fields[field]).map(field=>({field,current:current.fields[field]!,incoming:entry.fields[field]!,currentOrigin:current.provenance[field]?.origin})):[];
 }
 preview(vault:string,raw:unknown) {this.open(vault);const parsed=this.parse(raw);return {batchId:digest(parsed.rawBibtex),entries:parsed.entries.map((entry,index)=>{const matches=this.matches(vault,entry).map(match=>({...match,conflicts:this.conflicts(entry,this.get(vault,match.sourceId)),propertyConflicts:bibliographicLegacyConflicts(this.store,vault,match.sourceId,{...this.get(vault,match.sourceId)?.fields,...entry.fields},this.get(vault,match.sourceId)?.fields)}));return {index,entry:{citationKey:entry.citationKey,entryType:entry.entryType,fields:entry.fields,creators:entry.creators},matches,conflicts:[...new Set(matches.flatMap(match=>match.conflicts.map(conflict=>conflict.field)))]};}),warnings:parsed.warnings};}
 import(vault:string,body:Record<string,unknown>) {
 this.open(vault);const parsed=this.parse(body.raw);if(!Array.isArray(body.decisions)||body.decisions.length!==parsed.entries.length)throw new HttpError(400,'Review every imported record');
 const decisions=body.decisions.map(object);if(new Set(decisions.map(d=>d.index)).size!==parsed.entries.length||decisions.some(d=>!Number.isInteger(d.index)||Number(d.index)<0||Number(d.index)>=parsed.entries.length))throw new HttpError(400,'Invalid import decisions');
 return this.store.transaction(()=>{const result={sourceIds:[] as string[],created:0,updated:0,skipped:0};for(const decision of decisions){const entry=parsed.entries[Number(decision.index)]!;if(decision.action==='skip'){result.skipped++;continue;}
 const matches=this.matches(vault,entry);let id:string;
 if(decision.action==='merge'){id=required(decision.sourceId);this.source(vault,id);const current=this.get(vault,id);if((current?.revision??0)!==decision.revision)throw new HttpError(409,'The source changed. Review the import again.');
 // Explicit record selection is still required for ambiguous title matches.
 if(!matches.some(match=>match.sourceId===id))throw new HttpError(409,'The selected match changed. Review again.');
 if(current){const conflicts=this.conflicts(entry,current),choices=decision.fields===undefined?{}:object(decision.fields);
 if(conflicts.some(conflict=>!['current','incoming'].includes(String(choices[conflict.field])))||Object.entries(choices).some(([field,choice])=>!conflicts.some(conflict=>conflict.field===field)||!['current','incoming'].includes(String(choice))))throw new HttpError(400,'Review each conflicting field and choose its current or imported value.');
 const merged={...entry.fields,...current.fields};for(const conflict of conflicts)if(choices[conflict.field]==='incoming')merged[conflict.field]=conflict.incoming;const originals=[...current.rawImports];if(!originals.includes(parsed.rawBibtex))originals.push(parsed.rawBibtex);if(JSON.stringify(merged)!==JSON.stringify(current.fields)||originals.length!==current.rawImports.length){this.write(vault,id,current.citationKey,current.entryType,merged,'bibtex',originals,current,decision.reviewedProperties);result.updated++;}else result.skipped++;}
 else {this.write(vault,id,entry.citationKey,entry.entryType,entry.fields,'bibtex',[parsed.rawBibtex],undefined,decision.reviewedProperties);result.updated++;}
 }else if(decision.action==='create'){
 // Exact identifiers and keys must be reviewed against their existing records.
 if(matches.some(match=>match.reason!=='title'))throw new HttpError(409,'An identifier or citation key already exists. Review and merge explicitly.');
 id=randomUUID();this.store.run("INSERT INTO entities (id,vault_id,name,type,aliases,mention_case,referent_status,subtypes,description,updated_at) VALUES (?,?,?,'source','[]','canonical','actual','[]','',?)",id,vault,(entry.fields.title||entry.citationKey).slice(0,200),now());this.write(vault,id,entry.citationKey,entry.entryType,entry.fields,'bibtex',[parsed.rawBibtex]);result.created++;
 }else throw new HttpError(400,'Choose create, merge or skip');result.sourceIds.push(id);}return result;});
 }
 protected write(vault:string,id:string,key:string,type:string,value:Record<string,string>,origin:Origin,rawImports:string[],previous?:BibliographyRecord,reviewedProperties?:unknown) {
 try{exportBibliography([{citationKey:key,entryType:type,fields:value,creators:[],rawBibtex:''}]);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid bibliographic fields');}
 if(this.store.get('SELECT 1 FROM bibliographic_records WHERE vault_id=? AND citation_key=? AND source_id<>?',vault,key,id))throw new HttpError(409,'Citation key already belongs to another Source');
 assertBibliographicReconciliation(this.store,vault,id,value,reviewedProperties,previous?.fields);
 const provenance=Object.fromEntries(Object.entries(previous?.provenance??{}).filter(([key])=>key in value));for(const field of Object.keys(value))if(value[field]!==previous?.fields[field])provenance[field]={origin,at:now(),...(previous?.fields[field]===undefined?{}:{history:[...(previous.provenance[field]?.history??[]),{value:previous.fields[field]!,origin:previous.provenance[field]?.origin??'manual',at:previous.provenance[field]?.at??now()}]})};
 this.store.run(`INSERT INTO bibliographic_records(source_id,vault_id,citation_key,entry_type,fields_json,provenance_json,raw_imports_json,revision) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET citation_key=excluded.citation_key,entry_type=excluded.entry_type,fields_json=excluded.fields_json,provenance_json=excluded.provenance_json,raw_imports_json=excluded.raw_imports_json,revision=excluded.revision`,id,vault,citationKey(key),entryType(type),JSON.stringify(value),JSON.stringify(provenance),JSON.stringify(rawImports.map(raw=>{const id=digest(raw);this.store.run('INSERT OR IGNORE INTO bibliographic_import_batches(id,vault_id,raw) VALUES(?,?,?)',id,vault,raw);return id;})),(previous?.revision??0)+1);
 return this.get(vault,id)!;
 }
 reconcilePreview(vault:string,id:string,body:Record<string,unknown>) {this.source(vault,id);const current=this.get(vault,id);if(body.revision!==(current?.revision??0))throw new HttpError(409,'The bibliography changed. Reload before reviewing.');return {conflicts:bibliographicLegacyConflicts(this.store,vault,id,fields(body.fields),current?.fields)};}
 save(vault:string,id:string,body:Record<string,unknown>,origin:'manual'|'ai'='manual') {this.source(vault,id);const apply=()=>{const current=this.get(vault,id);if(body.revision!==(current?.revision??0))throw new HttpError(409,'The bibliography changed. Reload before saving.');return this.write(vault,id,citationKey(body.citationKey),entryType(body.entryType),fields(body.fields),origin,current?.rawImports??[],current??undefined,body.reviewedProperties);};return this.store.db.isTransaction?apply():this.store.transaction(apply);}
 export(vault:string) {this.open(vault);const records=this.list(vault,false).map(record=>({...record,rawImportIds:JSON.parse(this.row(vault,record.sourceId)!.raw_imports_json) as string[]}));const batches=this.store.all<{id:string;raw:string}>('SELECT id,raw FROM bibliographic_import_batches WHERE vault_id=? ORDER BY id',vault);const result=exportBibliographicBundle(this.store,vault,records,batches);return {...result,annotated:result.annotatedBiblatex};}

}
