import type { EntityType } from './domain.js';
import { builtinProperties, type EntitySchema } from './entity-schema.js';
import {recommendedPropertyDefinitions,propertyCatalogueForSchema} from './property-catalogue.js';
export {recommendedPropertyDefinitions,withPropertyCatalogue,catalogueDisciplinePolicy} from './property-catalogue.js';

export type PropertyValueKind = 'short_text' | 'long_text' | 'entity_reference' | 'date' | 'datetime' | 'integer' | 'quantity' | 'boolean' | 'enum' | 'url' | 'identifier' | 'coordinates';
export interface PropertyDefinition {
  /** Stable registry identity. Existing property row IDs remain independent. */
  id: string;
  key: string;
  legacyName: string;
  label: string;
  description: string;
  valueKind: PropertyValueKind;
  cardinality: 'one' | 'many';
  allowedTargetTypes: EntityType[];
  allowedTargetSubtypes: string[];
  scope: { kind: 'main_type'; type: EntityType } | { kind: 'subtype'; type: EntityType; subtypeId: string };
  origin: 'builtin' | 'user_defined';
  visibility: 'core' | 'suggested' | 'additional';
  sortOrder: number;
  editable: boolean;
  validation: Record<string, unknown>;
  /** Advisory until persisted bindings and compatibility review are implemented. */
  compatibility: 'legacy';
}

const labels: Record<string, string> = {
  'birth date': 'Birth Date', birthplace: 'Birthplace', nationality: 'Nationality', website: 'Website',
  country: 'Country', region: 'Region', coordinates: 'Coordinates', 'start date': 'Start Date',
  'end date': 'End Date', location: 'Location', organizer: 'Organizer', author: 'Author',
  'release date': 'Release Date', language: 'Language', type: 'Type', founded: 'Founded',
  headquarters: 'Headquarters', 'import method': 'Import Method', 'source url': 'Source URL', url: 'URL',
  'publication date': 'Publication Date', 'accessed date': 'Accessed Date', isbn: 'ISBN', doi: 'DOI',
  issn: 'ISSN', orcid: 'ORCID', 'parent taxon': 'Parent Taxon', 'scientific name': 'Scientific Name',
  'language family': 'Language Family', 'iso 639 code': 'ISO 639 Code',
};

/** Display-only adapter. Unknown/custom names retain their authored presentation. */
export function propertyLabel(name: string): string {
  return labels[name.toLowerCase().replace(/_/g, ' ')] ?? recommendedPropertyDefinitions.find(item=>item.legacyName===name.toLowerCase().replace(/_/g,' '))?.label ?? name;
}

const targets: Record<string, EntityType[]> = {
  birthplace: ['place'], country: ['place'], region: ['place'], location: ['place'],
  organizer: ['person', 'organization'], author: ['person', 'organization'], language: ['culture'],
  headquarters: ['place'],
};
const multiple = new Set(['location', 'organizer', 'author', 'language', 'import method', 'source url']);
const dates = new Set(['birth date', 'start date', 'end date', 'release date', 'founded', 'publication date', 'accessed date']);
const urls = new Set(['website', 'source url', 'url']);
const propertyKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '_');

/** Native defaults describe existing keys only; no authored values are converted. */
export const builtinPropertyDefinitions: PropertyDefinition[] = Object.entries(builtinProperties).flatMap(([type, names]) =>
  names.map((name, sortOrder) => {
    const normalized = name.toLowerCase();
    const valueKind: PropertyValueKind = targets[normalized] ? 'entity_reference' : dates.has(normalized) ? 'date' : urls.has(normalized) ? 'url' : normalized === 'coordinates' ? 'coordinates' : 'short_text';
    return {
      id: `builtin:${type}:${propertyKey(name)}`, key: propertyKey(name), legacyName: name, label: propertyLabel(name),
      description: normalized === 'nationality' ? 'Legacy nationality; preserve cultural or legal meaning without assuming citizenship.' : normalized === 'language' ? 'Language identity represented by a Culture entity with the Language subtype; separate from display-language metadata.' : '',
      valueKind, cardinality: multiple.has(normalized) ? 'many' : 'one',
      allowedTargetTypes: targets[normalized] ?? [], allowedTargetSubtypes: normalized === 'language' ? ['culture:language'] : [],
      scope: {kind: 'main_type', type: type as EntityType}, origin: 'builtin', visibility: 'core', sortOrder,
      editable: !(type === 'source' && (normalized === 'import method' || normalized === 'source url')), validation: {}, compatibility: 'legacy',
    };
  }),
);

export function propertyDefinitionFor(type: EntityType, name: string): PropertyDefinition | undefined {
  return builtinPropertyDefinitions.find(definition => definition.scope.type === type && definition.legacyName.toLowerCase() === name.toLowerCase()) ?? recommendedPropertyDefinitions.find(definition=>definition.scope.kind==='main_type'&&definition.scope.type===type&&definition.legacyName.toLowerCase()===name.toLowerCase());
}

/** Read adapter for current custom name-based definitions. These IDs are derived,
 * not persisted bindings: definition rename/type governance belongs to Phase 2/3. */
export function propertyDefinitionsForSchema(schema: EntitySchema, vaultId = ''): PropertyDefinition[] {
  const definitions: PropertyDefinition[] = [];
  const recommendations = propertyCatalogueForSchema(schema);
  const custom = (type: EntityType, name: string, sortOrder: number, subtypeId?: string): PropertyDefinition => ({
    id: `legacy:${encodeURIComponent(vaultId)}:${type}:${encodeURIComponent(subtypeId ?? '')}:${encodeURIComponent(name.toLowerCase())}`,
    key: propertyKey(name), legacyName: name, label: propertyLabel(name), description: '', valueKind: 'short_text',
    cardinality: 'many', allowedTargetTypes: [], allowedTargetSubtypes: [],
    scope: subtypeId ? {kind: 'subtype', type, subtypeId} : {kind: 'main_type', type},
    origin: 'user_defined', visibility: subtypeId ? 'suggested' : 'additional', sortOrder,
    editable: true, validation: {}, compatibility: 'legacy',
  });
  for (const [type, names] of Object.entries(schema.properties) as [EntityType, string[]][]) {
    names.forEach((name, index) => definitions.push(propertyDefinitionFor(type, name) ?? custom(type, name, index)));
  }
  for (const subtype of schema.subtypes) {
    (schema.subtypeProperties[subtype.id] ?? []).forEach((name, index) => definitions.push(recommendations.find(item=>item.scope.kind==='subtype'&&item.scope.subtypeId===subtype.id&&item.legacyName.toLowerCase()===name.toLowerCase()) ?? custom(subtype.type, name, index, subtype.id)));
  }
  for(const recommendation of recommendations)if((recommendation.scope.kind==='main_type'||schema.subtypes.some(subtype=>recommendation.scope.kind==='subtype'&&subtype.id===recommendation.scope.subtypeId))&&!definitions.some(item=>item.id===recommendation.id))definitions.push(recommendation);
  return definitions;
}

export interface PropertyDefinitionConflict { key: string; definitions: PropertyDefinition[] }
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
export const propertyDefinitionSignature = (definition: PropertyDefinition): string => JSON.stringify([definition.valueKind, definition.cardinality, [...definition.allowedTargetTypes].sort(), [...definition.allowedTargetSubtypes].sort(),canonical(definition.validation)]);

/** Conflicting inherited definitions remain visible to callers for explicit review. */
export function propertyDefinitionConflicts(definitions: PropertyDefinition[]): PropertyDefinitionConflict[] {
  const keys = [...new Set(definitions.map(definition => definition.key))];
  return keys.flatMap(key => {
    const matching = definitions.filter(definition => definition.key === key);
    return new Set(matching.map(propertyDefinitionSignature)).size > 1 ? [{key, definitions: matching}] : [];
  });
}

export function inheritedPropertyDefinitions(schema: EntitySchema, type: EntityType, subtypes: string[]): PropertyDefinition[] {
  const inherited = (schema.propertyDefinitions ?? propertyDefinitionsForSchema(schema)).filter(definition => definition.scope.type === type && (definition.scope.kind === 'main_type' || subtypes.includes(definition.scope.subtypeId))).sort((a,b)=>Number(a.scope.kind==='subtype')-Number(b.scope.kind==='subtype')||a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
  return inherited.filter((definition, index) => inherited.findIndex(candidate => candidate.key === definition.key && propertyDefinitionSignature(candidate) === propertyDefinitionSignature(definition)) === index);
}


/** A small deterministic discovery set; no value rows are instantiated. */
export function suggestedPropertyDefinitions(schema:EntitySchema,type:EntityType,subtypes:string[],populatedNames:string[],limit=3):PropertyDefinition[] {
 const populated=new Set(populatedNames.map(name=>name.toLowerCase()));
 const priority={core:0,suggested:1,additional:2};
 return inheritedPropertyDefinitions(schema,type,subtypes).filter(item=>!populated.has(item.legacyName.toLowerCase())).sort((a,b)=>priority[a.visibility]-priority[b.visibility]||a.sortOrder-b.sortOrder||a.label.localeCompare(b.label)||a.id.localeCompare(b.id)).slice(0,Math.max(0,limit));
}

/** Existing authored bindings retain their identity when classifications change. */
export function resolvePropertyDefinition(definitions:PropertyDefinition[]|undefined,type:EntityType,subtypes:string[],name:string,boundId?:string):PropertyDefinition|undefined {
 const bound=boundId?definitions?.find(item=>item.id===boundId):undefined;
 if(bound)return bound;
 const eligible=definitions?.filter(item=>item.scope.type===type&&item.legacyName.toLowerCase()===name.toLowerCase()&&(item.scope.kind==='main_type'||subtypes.includes(item.scope.subtypeId)))??[];
 return eligible.find(item=>item.scope.kind==='main_type')??eligible[0]??propertyDefinitionFor(type,name);
}
