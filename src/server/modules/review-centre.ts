import type {Store} from '../store.js';
import {Vaults} from './vaults.js';
import type {ReviewCategory,ReviewItem,ReviewQueue} from '../../shared/review-centre.js';

const categories:ReviewCategory[]=['scan','discovery','editorial','source'];
const pageAccess=`p.vault_id=? AND p.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM page_edit_locks l WHERE l.page_id=p.id)`;
const entityAccess=`e.vault_id=? AND e.archived_at IS NULL AND e.inactive=0`;
/** Metadata projections only: never transfers page blocks, discovery evidence or source documents to the client.
 * One row per current run, bounded independently so category failures remain isolated. */
export class ReviewCentre {
 constructor(private store:Store){}
 private rows(vault:string,category:ReviewCategory,offset:number,origin?:string):ReviewItem[]{
  const pending=(array:string,column:string)=>`(SELECT count(*) FROM json_each(${column},'$.${array}') j WHERE json_extract(j.value,'$.status')='pending')`;
  let sql:string;
  if(category==='scan')sql=`SELECT 'scan:'||p.id AS id,'scan' AS category,p.id AS originId,p.title,
   json_extract(a.data,'$.scan.id') AS runId,CASE WHEN a.revision<>p.revision THEN 'operations' ELSE 'decisions' END AS "group",
   CASE WHEN a.revision<>p.revision THEN 'stale' ELSE 'pending' END AS state,'Review detected entities and subtypes' AS decision,
   ${pending('scan.suggestions','a.data')}+${pending('scan.subtypeSuggestions','a.data')} AS count,a.updated_at AS updatedAt
   FROM page_ai_enrichments a JOIN pages p ON p.id=a.page_id WHERE ${pageAccess} AND a.kind='entity_scan'`;
  else if(category==='discovery')sql=`SELECT 'discovery:'||e.id AS id,'discovery' AS category,e.id AS originId,e.name AS title,d.id AS runId,
   'decisions' AS "group",'saved · freshness checked on open' AS state,'Review synthesis, relationships or associated pages' AS decision,
   ${pending('suggestions','d.payload')} AS count,d.created_at AS updatedAt
   FROM entity_discoveries d JOIN entities e ON e.id=d.entity_id WHERE ${entityAccess} AND e.type<>'source'
   AND d.rowid=(SELECT rowid FROM entity_discoveries WHERE entity_id=e.id ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
  else if(category==='editorial')sql=`SELECT 'editorial:'||f.id AS id,'editorial' AS category,e.id AS originId,e.name||' · '||f.name AS title,f.id AS fileId,r.id AS runId,
   CASE WHEN r.status IN ('queued','running') THEN 'activity' WHEN r.status IN ('failed','interrupted') THEN 'operations' ELSE 'decisions' END AS "group",
   CASE WHEN r.status='completed' THEN 'pending review · freshness checked on open' ELSE r.status END AS state,'Review source corrections' AS decision,
   (SELECT count(*) FROM json_each(r.payload,'$.patches') j WHERE json_extract(j.value,'$.decision')='pending') AS count,r.updated_at AS updatedAt
   FROM source_reprocessing r JOIN source_files f ON f.id=r.file_id AND f.vault_id=r.vault_id JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id
   WHERE ${entityAccess} AND e.type='source' AND f.admitted=1 AND f.status='ready'
   AND r.rowid=(SELECT rowid FROM source_reprocessing WHERE file_id=f.id AND vault_id=e.vault_id ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
  else sql=`SELECT 'source:'||f.id AS id,'source' AS category,e.id AS originId,e.name||' · '||f.name AS title,f.id AS fileId,
   CASE WHEN f.status='failed' OR f.status='ready' AND f.enrichment_status IN ('failed','interrupted') THEN 'operations' ELSE 'activity' END AS "group",
   CASE WHEN f.status<>'ready' THEN f.status ELSE f.enrichment_status END AS state,'Inspect source processing' AS decision,0 AS count,f.created_at AS updatedAt
   FROM source_files f JOIN entities e ON e.id=f.entity_id AND e.vault_id=f.vault_id WHERE e.vault_id=? AND e.archived_at IS NULL AND e.type='source'
   AND (f.status IN ('queued','processing','failed') OR f.enrichment_status IN ('pending','running','failed','interrupted'))`;
  // Materialization bounds JSON traversal to 51 status records, even in large vaults.
  // The optional identity predicate is applied before paging for navigation validation.
  const from=sql.indexOf('\n   FROM '),projection=sql.slice(0,from),source=sql.slice(from);
  if(category==='source')return this.store.all<ReviewItem>(`SELECT * FROM (${sql}) WHERE (? IS NULL OR id=?) ORDER BY updatedAt DESC,id LIMIT 51 OFFSET ?`,vault,origin??null,origin??null,offset);
  const identity=category==='scan'?"'scan:'||p.id":category==='discovery'?"'discovery:'||e.id":"'editorial:'||f.id";
  const ordering=category==='scan'?'a.updated_at':category==='discovery'?'d.created_at':'r.updated_at';
  const columns=category==='scan'?'p.id AS pid,p.title,p.revision AS current_revision,a.data,a.revision,a.updated_at':category==='discovery'?'e.id AS eid,e.name,d.id,d.payload,d.created_at':'f.id AS fid,e.id AS eid,e.name,f.name AS filename,r.id,r.status,r.payload,r.updated_at';
  let projected=projection;
  if(category==='scan')projected=projected.replaceAll('p.id','pid').replaceAll('p.title','title').replaceAll('p.revision','current_revision').replaceAll('a.','');
  if(category==='discovery')projected=projected.replaceAll('e.id','eid').replaceAll('e.name','name').replaceAll('d.','');
  if(category==='editorial')projected=projected.replaceAll('f.id','fid').replaceAll('e.id','eid').replaceAll('e.name','name').replaceAll('f.name','filename').replaceAll('r.','');
  return this.store.all<ReviewItem>(`WITH candidates AS MATERIALIZED (SELECT ${columns} ${source} AND (? IS NULL OR ${identity}=?) ORDER BY ${ordering} DESC,${identity} LIMIT 51 OFFSET ?) ${projected} FROM candidates`,vault,origin??null,origin??null,offset);

 }
 list(vault:string,offset=0):ReviewQueue {
  new Vaults(this.store).requireOpen(vault);
  const result:ReviewQueue={items:[],errors:[],more:[]};
  for(const category of categories)try{const rows=this.rows(vault,category,offset);result.items.push(...rows.slice(0,50).filter(item=>this.visible(item)));if(rows.length>50)result.more.push(category);}catch{result.errors.push(`${category}: saved status could not be loaded.`);}
  result.items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));return result;
 }
 private visible(item:ReviewItem){return item.category==='source'||item.category==='editorial'&&(item.group==='activity'||item.group==='operations')||item.count>0;}
 resolve(vault:string,id:string):ReviewItem|null {
  new Vaults(this.store).requireOpen(vault);
  const category=id.split(':')[0] as ReviewCategory;
  if(!categories.includes(category))return null;
  const item=this.rows(vault,category,0,id)[0];return item&&this.visible(item)?item:null;
 }
}
