import type {PageDomains} from '../../shared/domain.js';
import {domainById,TAXONOMY_VERSION} from '../../shared/domains.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
export function validatedDomainIds(value:unknown,max=162):string[] {
  if(!Array.isArray(value)||value.length>max||value.some(id=>typeof id!=='string'||!domainById(id)))throw new HttpError(400,'Choose valid disciplinary domains.');
  return [...new Set(value as string[])];
}
export function domainSelection(input:Record<string,unknown>) {
  const primary=input.primaryDomainId;
  if(primary!==null&&(typeof primary!=='string'||!domainById(primary)))throw new HttpError(400,'Choose a valid primary domain.');
  const secondary=validatedDomainIds(input.secondaryDomainIds??[],2).filter(id=>id!==primary);
  return {primaryDomainId:primary as string|null,secondaryDomainIds:secondary};
}
export class Domains {
  constructor(private store:Store) {}
  get(pageId:string,contentHash?:string):PageDomains {
    const state=this.store.get<{origin:'manual'|'inferred';content_hash:string|null;taxonomy_version:string;revision:number}>('SELECT * FROM page_domain_state WHERE page_id=?',pageId);
    const rows=this.store.all<{domain_id:string;role:string}>('SELECT domain_id,role FROM page_domains WHERE page_id=? ORDER BY domain_id',pageId);
    const assigned=rows.length>0;
    return {primaryDomainId:rows.find(row=>row.role==='primary')?.domain_id??null,secondaryDomainIds:rows.filter(row=>row.role==='secondary').map(row=>row.domain_id),origin:state?.origin??'inferred',status:state?.origin==='manual'?'manual':!assigned?'unclassified':state?.taxonomy_version!==TAXONOMY_VERSION||contentHash!==undefined&&state?.content_hash!==contentHash?'needs_refresh':'inferred',...(state?.content_hash?{contentHash:state.content_hash}:{}),taxonomyVersion:state?.taxonomy_version??TAXONOMY_VERSION,revision:state?.revision??0};
  }
  private requirePage(vault:string,pageId:string) {
    const page=this.store.get<{revision:number}>('SELECT revision FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',pageId,vault);
    if(!page)throw new HttpError(404,'Page not found');return page;
  }
  private write(pageId:string,selection:ReturnType<typeof domainSelection>,origin:'manual'|'inferred',contentHash?:string) {
    this.store.run('DELETE FROM page_domains WHERE page_id=?',pageId);
    for(const [role,ids] of [['primary',selection.primaryDomainId?[selection.primaryDomainId]:[]],['secondary',selection.secondaryDomainIds]] as const)
      for(const id of ids)this.store.run('INSERT INTO page_domains (page_id,domain_id,role,origin,updated_at) VALUES (?,?,?,?,?)',pageId,id,role,origin,now());
    this.store.run('INSERT INTO page_domain_state (page_id,origin,content_hash,taxonomy_version,revision) VALUES (?,?,?,?,1) ON CONFLICT(page_id) DO UPDATE SET origin=excluded.origin,content_hash=excluded.content_hash,taxonomy_version=excluded.taxonomy_version,revision=page_domain_state.revision+1',pageId,origin,contentHash??null,TAXONOMY_VERSION);
  }
  setManual(vault:string,pageId:string,input:Record<string,unknown>,revision:unknown) {
    const selection=domainSelection(input);
    this.store.transaction(()=>{
      const page=this.requirePage(vault,pageId);
      if(page.revision!==revision)throw new HttpError(409,'This page changed. Save the latest note before editing subjects.');
      if(this.store.get('SELECT 1 FROM page_edit_locks WHERE page_id=?',pageId))throw new HttpError(423,'Unlock this page before editing subjects.');
      this.write(pageId,selection,'manual');
      this.store.run('UPDATE pages SET revision=revision+1,updated_at=? WHERE id=? AND vault_id=?',now(),pageId,vault);
      this.store.run("DELETE FROM page_ai_enrichments WHERE page_id=? AND kind='entity_scan'",pageId);
    });
    return this.get(pageId);
  }
  setInferred(vault:string,pageId:string,input:Record<string,unknown>,contentHash:string) {
    this.requirePage(vault,pageId);const selection=domainSelection(input);
    if(this.get(pageId).origin==='manual')return this.get(pageId);
    const current=this.get(pageId);
    if(current.contentHash===contentHash&&current.taxonomyVersion===TAXONOMY_VERSION)return current;
    const write=()=>this.write(pageId,selection,'inferred',contentHash);
    if(this.store.db.isTransaction)write();else this.store.transaction(write);
    return this.get(pageId,contentHash);
  }
}
