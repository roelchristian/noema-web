import {createHash} from 'node:crypto';
import {Store} from '../store.js';
import {aiRetryPolicy} from './ai-retry-policy.js';
import type {Intelligence} from './intelligence.js';
/** Durable, content-free terminal policy shared by automatic discovery and forced jobs. */
export class EmbeddingRetryState {
  constructor(private store:Store,private intelligence:Intelligence,private kind:'page'|'source') {}
  configurationIdentity() {return createHash('sha256').update(typeof this.intelligence.retryConfigurationIdentity==='function'?this.intelligence.retryConfigurationIdentity('embedding'):'legacy').digest('hex');}
  blocked(id:string,contentHash:string) {return !!this.store.get("SELECT 1 FROM embedding_retry_blocks WHERE kind=? AND ((item_id=? AND content_hash=?) OR category='configuration') AND configuration=?",this.kind,id,contentHash,this.configurationIdentity());}
  record(id:string,vault:string,contentHash:string,error:unknown,configuration=this.configurationIdentity()) {
    const policy=aiRetryPolicy(error);if(policy.retryable)return;
    if(!error||typeof error!=='object'||!('providerStatus' in error))return;
    const providerStatus=error&&typeof error==='object'&&'providerStatus' in error&&typeof error.providerStatus==='number'?error.providerStatus:null;
    this.store.run('INSERT INTO embedding_retry_blocks(kind,item_id,vault_id,content_hash,configuration,category,provider_status) VALUES (?,?,?,?,?,?,?) ON CONFLICT(kind,item_id) DO UPDATE SET content_hash=excluded.content_hash,configuration=excluded.configuration,category=excluded.category,provider_status=excluded.provider_status',this.kind,id,vault,contentHash,configuration,policy.category,providerStatus);
  }
  configurationChanged():{id:string;vault:string}[] {
    const rows=this.store.all<{id:string;vault:string}>('SELECT b.item_id AS id,b.vault_id AS vault FROM embedding_retry_blocks b JOIN vaults v ON v.id=b.vault_id LEFT JOIN embedding_settings s ON s.vault_id=b.vault_id WHERE b.kind=? AND b.configuration<>? AND v.locked=0 AND coalesce(s.automatic,1)=1',this.kind,this.configurationIdentity());
    for(const row of rows)this.store.run('DELETE FROM embedding_retry_blocks WHERE kind=? AND item_id=?',this.kind,row.id);
    return rows;
  }
}
