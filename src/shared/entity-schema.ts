import type { EntityType } from './domain.js';

export interface EntitySubtype { id: string; name: string; type: EntityType }
export interface EntitySchema { subtypes: EntitySubtype[]; properties: Record<EntityType, string[]> }

export const builtinSubtypes: EntitySubtype[] = Object.entries({
  person: ['Actor', 'Writer', 'Artist', 'Scientist'],
  place: ['City', 'Country', 'Landmark'],
  event: ['Conference', 'Exhibition', 'Historical event'],
  creativework: ['Book', 'Film', 'Song', 'Article'],
  organization: ['Company', 'University', 'Nonprofit'],
  source: ['Website', 'Journal article', 'Interview'],
}).flatMap(([type, names]) => names.map(name => ({id: `${type}:${name.toLowerCase().replaceAll(' ', '-')}`, name, type: type as EntityType})));

export const builtinProperties: Record<EntityType, string[]> = {
  person: ['birth date', 'birthplace', 'nationality', 'website'],
  place: ['country', 'region', 'coordinates', 'website'],
  event: ['start date', 'end date', 'location', 'organizer'],
  creativework: ['author', 'release date', 'language', 'type'],
  organization: ['founded', 'headquarters', 'website'],
  source: ['url', 'author', 'publication date', 'accessed date'],
};
