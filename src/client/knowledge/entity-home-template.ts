import type {EntityType} from '../../shared/domain';

export type EntityHomeSection = 'overview' | 'properties' | 'connections' | 'pages' | 'aliases';
export interface EntityHomeTemplate {
  sections: readonly EntityHomeSection[];
  detailsTitle: string;
  overviewGuidance: string;
  prominentProperties: readonly string[];
}
const defaultTemplate: EntityHomeTemplate = {
  sections: ['overview', 'properties', 'connections', 'pages', 'aliases'],
  detailsTitle: 'Details',
  overviewGuidance: 'Write a synthesis in your own words. Markdown and math are supported.',
  prominentProperties: [],
};
/** Reusable sections with a few considered defaults; schemas still own editable fields. */
export function entityHomeTemplate(type: EntityType): EntityHomeTemplate {
  const details: Partial<Record<EntityType, Partial<EntityHomeTemplate>>> = {
    person: {detailsTitle:'Life and background', prominentProperties:['birth date','birthplace','nationality'], overviewGuidance:'Develop your understanding of this person: their life, work, influence, and connections. Markdown and math are supported.'},
    concept: {sections:['overview','connections','pages','properties','aliases'], detailsTitle:'Concept details', overviewGuidance:'Develop definitions, notation, examples, and connections in your own words. Markdown and math are supported.'},
    event: {sections:['properties','overview','pages','connections','aliases'], detailsTitle:'Event details', prominentProperties:['start date','end date','location','organizer'], overviewGuidance:'Describe the event, its context, participants, and significance. Markdown and math are supported.'},
    creativework: {sections:['properties','overview','pages','connections','aliases'], detailsTitle:'Publication and authorship', prominentProperties:['author','release date','language','type'], overviewGuidance:'Collect your interpretation of this work, its themes, and its significance. Markdown and math are supported.'},
    organization: {sections:['properties','overview','connections','pages','aliases'], detailsTitle:'Organization details', prominentProperties:['founded','headquarters','website']},
    place: {sections:['properties','overview','pages','connections','aliases'], detailsTitle:'Place details', prominentProperties:['country','region','coordinates']},
    organism: {sections:['properties','overview','connections','pages','aliases'], detailsTitle:'Characteristics'},
    culture: {detailsTitle:'Cultural context'},
  };
  return {...defaultTemplate, ...details[type]};
}
