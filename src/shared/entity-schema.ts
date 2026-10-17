import type { EntityType } from './domain.js';

export interface EntitySubtype { id: string; name: string; type: EntityType }
export interface EntitySchema { subtypes: EntitySubtype[]; properties: Record<EntityType, string[]>; subtypeProperties: Record<string, string[]> }

export function inheritedPropertyNames(schema: EntitySchema, type: EntityType, subtypes: string[]): string[] {
  const names = [...schema.properties[type], ...subtypes.filter(id => schema.subtypes.some(subtype => subtype.id === id && subtype.type === type)).flatMap(id => schema.subtypeProperties[id] ?? [])];
  return names.filter((name, index) => names.findIndex(candidate => candidate.toLowerCase() === name.toLowerCase()) === index);
}

export const builtinSubtypes: EntitySubtype[] = Object.entries({
  person: ['Actor', 'Writer', 'Artist', 'Scientist'],
  place: ['City', 'Country', 'Region / province / state', 'Landmark'],
  event: ['Conference', 'Exhibition', 'Historical event'],
  creativework: ['Book', 'Film', 'Song', 'Article'],
  organization: ['Company', 'University', 'Nonprofit'],
  organism: ['Plant', 'Animal', 'Fungus', 'Microorganism', 'Taxon', 'Individual'],
  culture: ['Language', 'Nationality'],
  source: ['Website', 'Journal article', 'Interview'],
  concept: ['Mathematics', 'Science', 'Social Sciences', 'Technology', 'Philosophy', 'Religion / belief'],
}).flatMap(([type, names]) => names.map(name => ({id: `${type}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, type: type as EntityType})));

export const builtinProperties: Record<EntityType, string[]> = {
  person: ['birth date', 'birthplace', 'nationality', 'website'],
  place: ['country', 'region', 'coordinates', 'website'],
  event: ['start date', 'end date', 'location', 'organizer'],
  creativework: ['author', 'release date', 'language', 'type'],
  organization: ['founded', 'headquarters', 'website'],
  organism: [],
  culture: [],
  source: ['url', 'author', 'publication date', 'accessed date'],
  concept: [],
};
