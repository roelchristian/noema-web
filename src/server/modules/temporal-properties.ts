import {getPropertyProvenance} from './property-provenance.js';
import {propertyDeclaresDate} from './property-temporal-definition.js';
import {createHash} from 'node:crypto';
import {adaptTemporalProperty} from '../../shared/temporal-properties.js';
import type {TemporalPropertyEvidence} from '../../shared/temporal.js';
import {Store} from '../store.js';
import {Vaults} from './vaults.js';
export const propertyFingerprint=(type:string,name:string,value:string)=>createHash('sha256').update(JSON.stringify([type,name,value])).digest('hex');
export const currentTemporalProperties=`FROM temporal_property_values v JOIN properties p ON p.id=v.property_id AND p.entity_id=v.entity_id JOIN entities e ON e.id=p.entity_id AND e.vault_id=v.vault_id WHERE v.vault_id=? AND v.date_id=? AND e.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM temporal_property_dirty d WHERE d.property_id=p.id)`;
export class TemporalProperties {
 constructor(private store:Store) {}
 refresh(vault:string,limit=25,propertyId?:string,nativeAssertion=false) {
  new Vaults(this.store).requireOpen(vault);
  const rows=this.store.all<{id:string;entity_id:string;type:string;name:string;value:string|null;target_id:string|null}>(`SELECT p.*,e.type FROM temporal_property_dirty d JOIN properties p ON p.id=d.property_id JOIN entities e ON e.id=p.entity_id WHERE d.vault_id=? AND e.vault_id=? ${propertyId?'AND p.id=?':''} ORDER BY p.id LIMIT ?`,...propertyId?[vault,vault,propertyId,limit]:[vault,vault,limit]);
  for(const row of rows) {
   const adapted=row.value!==null&&row.target_id===null?adaptTemporalProperty(row.type,row.name,row.value,propertyDeclaresDate(this.store,vault,row.id)):null;
   if(!adapted){this.store.run('DELETE FROM temporal_property_values WHERE property_id=?',row.id);this.store.run('DELETE FROM temporal_property_dirty WHERE property_id=?',row.id);continue;}
   const fingerprint=propertyFingerprint(row.type,row.name,row.value!);
   // Only the explicit native typed-write path may accept a new assertion. Indexing
   // and reindexing never upgrade historical/imported/AI proposals.
   const provenance=getPropertyProvenance(this.store,vault,row.id);
   const accepted=nativeAssertion&&propertyId===row.id&&propertyDeclaresDate(this.store,vault,row.id)&&provenance?.origin==='manual'&&!provenance.stale&&!provenance.source_file_id&&!provenance.source_hash&&/^-?\d{4}(?:-\d{2}(?:-\d{2})?)?(?: \((?:Gregorian|Julian)\))?$/.test(row.value!.trim())&&!!adapted.date;
   this.store.db.exec('SAVEPOINT temporal_property_refresh');
   try {
    if(adapted.date)this.store.run('INSERT OR IGNORE INTO temporal_dates VALUES (?,?,?,?,?)',vault,adapted.date.id,adapted.date.value,adapted.date.precision,adapted.date.calendar);
    this.store.run('INSERT OR REPLACE INTO temporal_property_values VALUES (?,?,?,?,?,?)',row.id,vault,row.entity_id,adapted.date?.id??null,fingerprint,adapted.reason);
    if(adapted.date&&!this.store.get('SELECT 1 FROM temporal_relations WHERE vault_id=? AND property_id=? AND property_hash=? AND date_id=? AND kind=?',vault,row.id,fingerprint,adapted.date.id,adapted.kind)) {
     const id=createHash('sha256').update(JSON.stringify([vault,row.id,fingerprint,adapted.date.id,adapted.kind])).digest('hex');
     this.store.run("INSERT INTO temporal_relations (id,vault_id,date_id,entity_id,kind,origin,status,confidence,property_id,property_hash) VALUES (?,?,?,?,?,?,?,NULL,?,?)",id,vault,adapted.date.id,row.entity_id,adapted.kind,accepted?'manual':'inferred',accepted?'accepted':'pending',row.id,fingerprint);
    }
    this.store.run('DELETE FROM temporal_property_dirty WHERE property_id=?',row.id);
    this.store.db.exec('RELEASE temporal_property_refresh');
   }catch(error){this.store.db.exec('ROLLBACK TO temporal_property_refresh; RELEASE temporal_property_refresh');throw error;}
  }
  return rows.length;
 }
 resolve(vault:string,propertyId:string,dateId:string,fingerprint:string|null):TemporalPropertyEvidence {
  new Vaults(this.store).requireOpen(vault);
  const row=this.store.get<{name:string;value:string|null;type:string;date_id:string|null;raw_hash:string}>(`SELECT p.name,p.value,e.type,v.date_id,v.raw_hash FROM properties p JOIN entities e ON e.id=p.entity_id LEFT JOIN temporal_property_values v ON v.property_id=p.id WHERE p.id=? AND e.vault_id=? AND e.archived_at IS NULL`,propertyId,vault);
  if(!row)return {status:'unavailable',reason:'Entity or date property is deleted or archived'};
  if(row.value===null||!fingerprint||row.raw_hash!==fingerprint||propertyFingerprint(row.type,row.name,row.value)!==fingerprint||row.date_id!==dateId||this.store.get('SELECT 1 FROM temporal_property_dirty WHERE property_id=?',propertyId))return {status:'stale',reason:'Original date property has changed'};
  return {status:'current',propertyId,raw:row.value,name:row.name,reason:null};
 }
}
