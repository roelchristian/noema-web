import type { EntityType } from './domain.js';
import type { PropertyDefinition } from './property-definitions.js';

export interface EntitySubtype { id: string; name: string; type: EntityType; description?: string; origin?: 'builtin' | 'user_defined' }
export interface EntitySchema { subtypes: EntitySubtype[]; properties: Record<EntityType, string[]>; subtypeProperties: Record<string, string[]>; propertyDefinitions?: PropertyDefinition[] }

export function inheritedPropertyNames(schema: EntitySchema, type: EntityType, subtypes: string[]): string[] {
  const names = [...schema.properties[type], ...subtypes.filter(id => schema.subtypes.some(subtype => subtype.id === id && subtype.type === type)).flatMap(id => schema.subtypeProperties[id] ?? [])];
  return names.filter((name, index) => names.findIndex(candidate => candidate.toLowerCase() === name.toLowerCase()) === index);
}

/** Curated additions; saved classifications are never inferred from these descriptions. */
const subtypeDescriptions: Record<string, string> = {
  'person:fictional-character': 'An individual narrative agent, human or nonhuman. Keep distinct versions and adaptations separate; referent status is independent of type.',
  'organism:fictional-taxon': 'A biological kind or taxonomic group described within a fictional setting, distinct from an individual character.',
  'concept:folkloric-archetype': 'An abstract recurring folkloric figure or pattern, distinct from a particular narrative agent.',
  'concept:mythological-creature': 'A creature kind in an authored mythological context, distinct from an individual character or biological taxon. Do not infer the status of living beliefs.',
  'concept:role': 'An abstract social or narrative role, distinct from its individual bearer.',
  'thing:food': 'A culinary product or edible material, distinct from a biological species. Combine with Ingredient, Dish or Beverage where supported.',
  'thing:ingredient': 'A material used in preparing food; optionally derived from an existing organism.',
  'thing:dish': 'A prepared culinary product, distinct from its recipe or source organism.',
  'thing:beverage': 'A drink as a culinary product.',
  'thing:material': 'A physical material, distinct from an abstract concept.',
  'thing:substance': 'A physical substance, distinct from an abstract concept.',
  'thing:artefact': 'A made physical object or object kind, distinct from an authored creative work.',
  'creativework:recipe': 'An authored culinary instruction work, distinct from a prepared dish.',
  'place:building': 'A constructed building, distinct from the organization occupying it. May also be a Landmark or Historical Place.',
  'place:natural-feature': 'A named natural geographic feature, such as a mountain, river or lake.',
  'place:historical-place': 'A place significant for its history, including former settlements and archaeological sites. May also be a City, Building or Landmark.',
  'creativework:album': 'A collection of recorded music as a creative work, distinct from an imported recording file.',
  'creativework:journal': 'A continuing scholarly or literary publication as a creative work, distinct from its publisher, an individual paper or a consulted Source.',
  'creativework:painting': 'An individual painted artwork as a creative work.',
  'creativework:poem': 'An individual poem as a creative work; its text and interpretation belong in the overview or linked pages.',
  'creativework:software': 'A named software work or project, distinct from an organization or a general technical concept.',
  'creativework:academic-paper': 'A scholarly paper as an intellectual work. A consulted or imported document remains a Source, optionally linked to this work.',
  'organization:government-body': 'An organized government institution or agency, distinct from the territory it governs.',
  'organization:religious-institution': 'An organized religious institution, distinct from a building, belief or cultural tradition.',
  'organization:research-institute': 'An organization principally conducting research; may also be a University or Nonprofit.',
  'organization:association': 'An organized membership or professional association; may also be a Nonprofit.',
  'culture:cultural-tradition': 'A shared cultural practice or tradition, distinct from a language, nationality, institution or abstract belief.',
  'concept:theory': 'An explanatory or formal theory. Discipline classification remains independent; exposition belongs in the overview or linked pages.',
  'concept:theorem': 'A named mathematical or formal result. Statements, assumptions in full and proofs belong in the overview or linked pages.',
  'concept:method': 'A named procedure or technique. Instructions and worked examples belong in the overview or linked pages.',
  'concept:principle': 'A named foundational rule or guiding proposition. Its formulation and discussion belong in the overview or linked pages.',
  'concept:framework': 'A named conceptual or analytical structure. Its exposition belongs in the overview or linked pages; software implementations remain Creative Works.',
};

export const builtinSubtypes: EntitySubtype[] = Object.entries({
  person: ['Actor', 'Writer', 'Artist', 'Scientist', 'Researcher', 'Philosopher', 'Historian', 'Educator', 'Engineer', 'Physician', 'Entrepreneur', 'Politician', 'Activist', 'Journalist', 'Musician', 'Composer', 'Filmmaker', 'Athlete', 'Religious leader', 'Fictional Character'],
  place: ['City', 'Country', 'Region / province / state', 'Landmark', 'Building', 'Natural Feature', 'Historical Place'],
  event: ['Conference', 'Exhibition', 'Historical event'],
  creativework: ['Book', 'Film', 'Song', 'Article', 'Album', 'Journal', 'Painting', 'Poem', 'Software', 'Academic Paper', 'Recipe'],
  organization: ['Company', 'University', 'Nonprofit', 'Government Body', 'Religious Institution', 'Research Institute', 'Association'],
  organism: ['Plant', 'Animal', 'Fungus', 'Microorganism', 'Taxon', 'Individual', 'Fictional Taxon'],
  culture: ['Language', 'Nationality', 'Cultural Tradition'],
  source: ['Website', 'Journal article', 'Interview'],
  concept: ['Mathematics', 'Science', 'Social Sciences', 'Technology', 'Philosophy', 'Religion / belief', 'Theory', 'Theorem', 'Method', 'Principle', 'Framework', 'Folkloric Archetype', 'Mythological Creature', 'Role'],
  thing: ['Food', 'Ingredient', 'Dish', 'Beverage', 'Material', 'Substance', 'Artefact'],
}).flatMap(([type, names]) => names.map(name => {
  const id = `${type}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {id, name, type: type as EntityType, origin: 'builtin' as const, ...(subtypeDescriptions[id] ? {description: subtypeDescriptions[id]} : {})};
}));

export const builtinProperties: Record<EntityType, string[]> = {
  person: ['birth date', 'birthplace', 'nationality', 'website'],
  place: ['country', 'region', 'coordinates', 'website'],
  event: ['start date', 'end date', 'location', 'organizer'],
  creativework: ['author', 'release date', 'language', 'type'],
  organization: ['founded', 'headquarters', 'website'],
  organism: [],
  thing: [],
  culture: [],
  source: ['Import method', 'Source URL', 'url', 'author', 'publication date', 'accessed date'],
  concept: [],
};

/** Historical custom identities win exact ID collisions; same-name IDs stay separate. */
export function vaultSubtypes(custom: EntitySubtype[]): EntitySubtype[] {
  const ids = new Set(custom.map(item => item.id));
  return [...builtinSubtypes.filter(item => !ids.has(item.id)), ...custom.map(item => ({...item, origin: 'user_defined' as const}))];
}

/** Keep same-name native/custom choices distinguishable without renaming either identity. */
export function subtypeDisplayName(subtype:EntitySubtype,subtypes:EntitySubtype[]):string {
  return subtype.origin==='user_defined'&&subtypes.some(item=>item.id!==subtype.id&&item.type===subtype.type&&item.name.toLowerCase()===subtype.name.toLowerCase()) ? `${subtype.name} (custom)` : subtype.name;
}
