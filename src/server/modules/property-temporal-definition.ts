import type {PropertyDefinition} from '../../shared/property-definitions.js';
import {Store} from '../store.js';
/** Read-only resolution of declared date semantics; canonical dates still belong to temporal tables. */
export function propertyDeclaresDate(store:Store,vault:string,propertyId:string):boolean {
 if(!store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='property_value_metadata'"))return false;
 const row=store.get<{definition_json:string}>(`SELECT d.definition_json FROM property_value_metadata m JOIN property_definitions d ON d.vault_id=m.vault_id AND d.id=m.definition_id WHERE m.vault_id=? AND m.property_id=?`,vault,propertyId);
 if(row)return (JSON.parse(row.definition_json) as PropertyDefinition).valueKind==='date';
 const property=store.get<{name:string;type:string;subtypes:string}>('SELECT p.name,e.type,e.subtypes FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=? AND e.vault_id=?',propertyId,vault);
 if(!property)return false;
 const subtypes=JSON.parse(property.subtypes) as string[];
 return store.all<{definition_json:string}>('SELECT definition_json FROM property_definitions WHERE vault_id=?',vault).some(row=>{const definition=JSON.parse(row.definition_json) as PropertyDefinition;return definition.valueKind==='date'&&definition.scope.type===property.type&&definition.legacyName.toLowerCase()===property.name.toLowerCase()&&(definition.scope.kind==='main_type'||subtypes.includes(definition.scope.subtypeId));});
}
