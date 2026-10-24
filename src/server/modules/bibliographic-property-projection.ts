import {createHash} from 'node:crypto';
import type {Property} from '../../shared/domain.js';
import {normalizeDoi} from '../../shared/bibliography.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';

/** A bibliographic fact has one editing surface. Authored properties remain immutable evidence. */
const projections=[
 {field:'doi',names:['doi'],label:'DOI'},
 {field:'isbn',names:['isbn'],label:'ISBN'},
 {field:'issn',names:['issn'],label:'ISSN'},
 {field:'author',names:['author','authors'],label:'author'},
 {field:'editor',names:['editor','editors'],label:'editor'},
 {field:'translator',names:['translator','translators'],label:'translator'},
 {field:'publisher',names:['publisher'],label:'publisher'},
 {field:'title',names:['title','publication title'],label:'title'},
 {field:'abstract',names:['abstract','author abstract'],label:'author abstract'},
 {field:'booktitle',names:['book title','container title'],label:'book title'},
 {field:'series',names:['series'],label:'series'},
 {field:'journal',alternatives:['journaltitle'],names:['journal','journal title'],label:'journal'},
 {field:'volume',names:['volume'],label:'volume'},
 {field:'issue',alternatives:['number'],names:['issue','number'],label:'issue'},
 {field:'pages',names:['pages','page range'],label:'pages'},
 {field:'edition',names:['edition'],label:'edition'},
 {field:'date',alternatives:['year'],names:['publication date','published'],label:'publication date'},
 {field:'url',names:['url'],label:'url'},
] as const;
function canonical(store:Store,vault:string,id:string) {
 if(!store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bibliographic_records'"))return undefined;
 const row=store.get<{fields_json:string;revision:number}>("SELECT b.fields_json,b.revision FROM bibliographic_records b JOIN entities e ON e.id=b.source_id AND e.vault_id=b.vault_id WHERE b.vault_id=? AND b.source_id=? AND e.type='source'",vault,id);
 return row?{fields:JSON.parse(row.fields_json) as Record<string,string>,revision:row.revision}:undefined;
}
function selected(record:{fields:Record<string,string>},projection:typeof projections[number]) {return [projection.field,...('alternatives' in projection?projection.alternatives:[])].find(field=>Object.hasOwn(record.fields,field));}
function same(field:string,canonicalValue:string,value:string|null) {
 if(value===null)return false;
 if(field==='doi'){const left=normalizeDoi(canonicalValue),right=normalizeDoi(value);return left&&right?left===right:canonicalValue.trim()===value.trim();}
 if(field==='isbn'||field==='issn'){const left=canonicalValue.replace(/[^\dX]/gi,'').toUpperCase(),right=value.replace(/[^\dX]/gi,'').toUpperCase();return left&&right?left===right:canonicalValue.trim()===value.trim();}
 return canonicalValue.trim()===value.trim();
}
export function projectBibliographicProperties(store:Store,vault:string,id:string,properties:Property[]):Property[] {
 const record=canonical(store,vault,id);if(!record)return properties;
 const originals=store.all<Property&{targetName?:string}>('SELECT p.*,e.name AS targetName FROM properties p LEFT JOIN entities e ON e.id=p.target_id AND e.vault_id=? WHERE p.entity_id=?',vault,id);
 const managed=new Set<string>(),projected:Property[]=[];
 for(const projection of projections){const field=selected(record,projection);if(!field)continue;for(const name of projection.names)managed.add(name);
 const legacy=originals.filter(property=>(projection.names as readonly string[]).includes(property.name.toLowerCase()));
 projected.push({id:`bibliography:${id}:${projection.field}`,entity_id:id,name:legacy[0]?.name??projection.label,value:record.fields[field]!,target_id:null,bibliographicProjection:{field,revision:record.revision,legacyValues:legacy.map(property=>({id:property.id,name:property.name,value:property.value,target_id:property.target_id,...(property.targetName?{targetName:property.targetName}:{}),conflicts:!same(field,record.fields[field]!,property.value)}))}});
 }
 return [...properties.filter(property=>!managed.has(property.name.toLowerCase())),...projected];
}
/** Reject adding, renaming, changing or removing a second independently editable fact. */
export function assertBibliographicPropertyWritable(store:Store,vault:string,id:string,name?:string,propertyId?:string) {
 if(propertyId?.startsWith('bibliography:'))throw new HttpError(409,'This property is projected from the bibliographic record. Edit it in Bibliographic details.');
 const record=canonical(store,vault,id);if(!record)return;
 const existing=propertyId?store.get<{name:string}>('SELECT name FROM properties WHERE id=? AND entity_id=?',propertyId,id)?.name:undefined;
 const names=[name,existing].filter((value):value is string=>typeof value==='string').map(value=>value.trim().toLowerCase());
 if(projections.some(projection=>selected(record,projection)&&names.some(value=>(projection.names as readonly string[]).includes(value))))throw new HttpError(409,'This property is projected from the bibliographic record. Edit it in Bibliographic details; original authored values are retained as evidence.');
}

export interface BibliographicLegacyConflict {field:string;proposedValue:string;property:{id:string;name:string;value:string|null;target_id:string|null;targetName?:string};fingerprint:string}
/** Fingerprints bind approval to both the preserved authored fact and the proposed canonical value. */
export function bibliographicLegacyConflicts(store:Store,vault:string,id:string,fields:Record<string,string>,previousFields?:Record<string,string>):BibliographicLegacyConflict[] {
 const originals=store.all<Property&{targetName?:string}>('SELECT p.*,e.name AS targetName FROM properties p JOIN entities source ON source.id=p.entity_id LEFT JOIN entities e ON e.id=p.target_id AND e.vault_id=? WHERE source.id=? AND source.vault_id=? AND source.type=? ORDER BY p.id',vault,id,vault,'source');
 const conflicts:BibliographicLegacyConflict[]=[];
 for(const projection of projections){const field=selected({fields},projection);if(!field||previousFields?.[field]===fields[field])continue;for(const property of originals){if(!(projection.names as readonly string[]).includes(property.name.toLowerCase())||same(field,fields[field]!,property.value))continue;const preserved={id:property.id,name:property.name,value:property.value,target_id:property.target_id,...(property.targetName?{targetName:property.targetName}:{})};const proposedValue=fields[field]!;conflicts.push({field,proposedValue,property:preserved,fingerprint:createHash('sha256').update(JSON.stringify({field,proposedValue,property:preserved})).digest('hex')});}}
 return conflicts;
}
/** The caller invokes this inside its existing canonical-write transaction. Originals are never deleted. */
export function assertBibliographicReconciliation(store:Store,vault:string,id:string,fields:Record<string,string>,reviewed:unknown,previousFields?:Record<string,string>) {
 const conflicts=bibliographicLegacyConflicts(store,vault,id,fields,previousFields);
 const approvals=reviewed===undefined?[]:reviewed;if(!Array.isArray(approvals)||approvals.length>1000||approvals.some(item=>!item||typeof item!=='object'||typeof item.propertyId!=='string'||typeof item.fingerprint!=='string'))throw new HttpError(400,'Invalid authored-property review decisions');
 if(conflicts.some(conflict=>!approvals.some(approval=>approval.propertyId===conflict.property.id&&approval.fingerprint===conflict.fingerprint)))throw new HttpError(409,'Bibliographic facts conflict with authored Source properties. Review their current values explicitly; original properties will be retained as evidence.');
}
