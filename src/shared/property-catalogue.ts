import {entityTypes, type EntityType} from './domain.js';
import type {EntitySchema} from './entity-schema.js';
import type {PropertyDefinition,PropertyValueKind} from './property-definitions.js';

type Field = {name:string;label:string;kind?:PropertyValueKind;many?:boolean;targets?:EntityType[];subtypes?:string[];values?:string[];hierarchical?:boolean;description?:string};
const text=(name:string,label:string,many=false):Field=>({name,label,many});
const ref=(name:string,label:string,targets:EntityType[],many=false,subtypes:string[]=[],hierarchical=false):Field=>({name,label,kind:'entity_reference',targets,many,subtypes,hierarchical});
const date=(name:string,label:string,many=false):Field=>({name,label,kind:'date',many});
const number=(name:string,label:string,kind:'integer'|'quantity'='integer'):Field=>({name,label,kind});
const identifier=(name:string,label:string):Field=>({name,label,kind:'identifier'});
const enumeration=(name:string,label:string,values:string[]):Field=>({name,label,kind:'enum',values});
const person:EntityType[]=['person'],place:EntityType[]=['place'],organization:EntityType[]=['organization'],work:EntityType[]=['creativework'],concept:EntityType[]=['concept'],culture:EntityType[]=['culture'],organism:EntityType[]=['organism'];
const people:EntityType[]=['person','organization'];
const language=(name='language',label='Language',many=true)=>({...ref(name,label,culture,many,['culture:language']),description:'Language identity is a Culture entity with the Language subtype; independent of display or extracted-text language metadata.'});
const taxon=(name='taxon',label='Taxon',hierarchical=false)=>ref(name,label,organism,false,['organism:taxon'],hierarchical);
const main:Record<EntityType,Field[]>={
 thing:[ref('derived from','Derived From',['organism','thing'],true),ref('made of','Made Of',['thing'],true),text('physical form','Physical Form')],
 person:[date('death date','Death Date'),ref('citizenship','Citizenship',place,true,['place:country']),ref('employer','Employer',organization,true),ref('occupation','Occupation',concept),ref('affiliation','Affiliation',organization,true),ref('notable works','Notable Works',work,true)],
 place:[ref('parent place','Parent Place',place,false,[],true),number('population','Population'),text('alternative names','Alternative Names',true)],
 event:[ref('participants','Participants',[],true),ref('associated work','Associated Work',work,true),enumeration('event status','Event Status',['planned','ongoing','completed','cancelled','postponed','unknown'])],
 creativework:[ref('creator','Creator',people,true),date('publication date','Publication Date'),enumeration('work type','Work Type',['book','film','song','article','other','unknown']),ref('publisher','Publisher',organization),ref('subject','Subject',concept,true),ref('part of','Part Of',work,false,[],true),identifier('isbn','ISBN'),identifier('doi','DOI')],
 organization:[ref('founded by','Founded By',people,true),ref('parent organization','Parent Organization',organization,false,[],true),date('dissolved','Dissolved'),ref('industry','Industry',concept)],
 organism:[text('scientific name','Scientific Name'),taxon(),ref('geographic range','Geographic Range',place,true),text('common names','Common Names',true),enumeration('conservation status','Conservation Status',['not evaluated','data deficient','least concern','near threatened','vulnerable','endangered','critically endangered','extinct in the wild','extinct','unknown']),ref('habitat','Habitat',place,true)],
 culture:[ref('region','Region',place,true),language('related languages','Related Languages'),ref('historical period','Historical Period',['event']),ref('parent tradition','Parent Tradition',culture,false,[],true),text('writing system','Writing System'),text('endonyms','Endonyms',true)],
 source:[language(),ref('publisher','Publisher',organization),ref('associated work','Associated Work',work,true),identifier('doi','DOI'),identifier('isbn','ISBN')],
 concept:[ref('related concepts','Related Concepts',concept,true),text('notation','Notation'),ref('introduced by','Introduced By',person,true),ref('originating work','Originating Work',work)],
};
/** Built-in subtype recommendations. Disciplinary fields continue to use Domain IDs. */
const subtype:Record<string,Field[]>={
 'place:building':[ref('architect designer','Architect / Designer',person,true),date('established','Established'),ref('architectural style','Architectural Style',concept,true)],
 'place:natural-feature':[ref('feature kind','Feature Kind',concept),{...number('elevation','Elevation','quantity'),description:'Elevation with an explicit unit and reference datum where known, for example 1200 m above sea level.'},{...number('length','Length','quantity'),description:'Measured length with an explicit unit, for example 42 km.'}],
 'place:historical-place':[ref('associated events','Associated Events',['event'],true),date('established','Established'),date('abandoned','Abandoned')],
 'creativework:album':[ref('performer','Performer',people,true),ref('composer','Composer',person,true),{...number('duration','Duration','quantity'),description:'Playing time with an explicit unit, for example 42 min.'}],
 'creativework:journal':[identifier('issn','ISSN'),date('first published','First Published'),ref('publisher','Publisher',organization)],
 'creativework:painting':[text('medium','Medium'),{...number('height','Height','quantity'),description:'Artwork height with an explicit unit, for example 60 cm.'},{...number('width','Width','quantity'),description:'Artwork width with an explicit unit, for example 40 cm.'}],
 'creativework:poem':[ref('poetic form','Poetic Form',concept),text('meter','Meter'),date('composed','Composed')],
 'creativework:software':[identifier('version','Version'),{name:'repository',label:'Repository',kind:'url'},text('license','License')],
 'creativework:academic-paper':[ref('journal','Journal',work,false,['creativework:journal']),identifier('arxiv id','arXiv ID'),identifier('doi','DOI')],
 'organization:government-body':[ref('jurisdiction','Jurisdiction',place,true),ref('responsibilities','Responsibilities',concept,true),date('established','Established')],
 'organization:religious-institution':[ref('religious tradition','Religious Tradition',['culture','concept']),ref('affiliation','Affiliation',organization,true),date('established','Established')],
 'organization:research-institute':[ref('research areas','Research Areas',concept,true),ref('affiliation','Affiliation',organization,true),date('established','Established')],
 'organization:association':[ref('focus areas','Focus Areas',concept,true),ref('affiliation','Affiliation',organization,true),date('established','Established')],
 'culture:cultural-tradition':[ref('associated communities','Associated Communities',culture,true),ref('origin place','Origin Place',place,true),ref('associated events','Associated Events',['event'],true)],
 'concept:theory':[ref('proponents','Proponents',person,true),ref('related theories','Related Theories',concept,true,['concept:theory']),date('proposed','Proposed')],
 'concept:theorem':[ref('assumptions','Assumptions',concept,true),ref('depends on theorems','Depends On Theorems',concept,true,['concept:theorem']),date('proven','Proven')],
 'concept:method':[ref('applications','Applications',concept,true),ref('related methods','Related Methods',concept,true,['concept:method']),date('introduced','Introduced')],
 'concept:principle':[ref('applications','Applications',concept,true),ref('related principles','Related Principles',concept,true,['concept:principle']),date('introduced','Introduced')],
 'concept:framework':[ref('components','Components',concept,true),ref('based on theories','Based On Theories',concept,true,['concept:theory']),date('introduced','Introduced')],
 'person:actor':[ref('filmography','Filmography',work,true),ref('awards','Awards',['creativework','event'],true)],
 'person:writer':[ref('published works','Published Works',work,true),ref('literary movement','Literary Movement',['concept','culture'])],
 'person:artist':[ref('works','Works',work,true),text('medium','Medium'),ref('artistic movement','Artistic Movement',concept)],
 'person:scientist':[ref('discoveries','Discoveries',concept,true)],
 'person:researcher':[ref('research areas','Research Areas',concept,true),ref('institution','Institution',organization,true)],
 'person:philosopher':[ref('school','School',concept),ref('influences','Influences',person,true)],
 'person:historian':[ref('historical periods','Historical Periods',concept,true),ref('major works','Major Works',work,true)],
 'person:educator':[ref('institution','Institution',organization,true),ref('subject areas','Subject Areas',concept,true)],
 'person:engineer':[ref('specialisation','Specialisation',concept),ref('projects','Projects',['creativework','event'],true)],
 'person:physician':[ref('specialisation','Specialisation',concept),ref('institution','Institution',organization,true)],
 'person:entrepreneur':[ref('founded organizations','Founded Organizations',organization,true)],
 'person:politician':[text('political offices','Political Offices',true),ref('party','Party',organization),date('terms','Terms',true)],
 'person:activist':[ref('movements','Movements',['concept','culture'],true),ref('organizations','Organizations',organization,true)],
 'person:journalist':[ref('publications','Publications',['source','organization'],true),ref('areas covered','Areas Covered',concept,true)],
 'person:musician':[text('instrument','Instrument',true),ref('recordings','Recordings',work,true)],
 'person:composer':[ref('compositions','Compositions',work,true),ref('musical period','Musical Period',concept)],
 'person:filmmaker':[ref('filmography','Filmography',work,true),text('role','Role')],
 'person:athlete':[ref('sport','Sport',concept),ref('team','Team',organization,true),ref('achievements','Achievements',['event'],true)],
 'person:religious-leader':[ref('religious tradition','Religious Tradition',['culture','concept']),ref('institution','Institution',organization,true),text('office','Office')],
 'place:city':[number('population','Population'),ref('administrative region','Administrative Region',place),date('founded','Founded')],
 'place:country':[ref('capital','Capital',place),language('official languages','Official Languages'),identifier('iso code','ISO Code')],
 'place:region-province-state':[ref('administrative parent','Administrative Parent',place,false,[],true),text('administrative level','Administrative Level'),identifier('code','Code')],
 'place:landmark':[ref('location','Location',place),date('established','Established'),ref('architect designer','Architect / Designer',person,true)],
 'event:conference':[ref('venue','Venue',place),ref('host','Host',organization),ref('speakers','Speakers',person,true)],
 'event:exhibition':[ref('venue','Venue',place),ref('curator','Curator',person,true),ref('exhibited works','Exhibited Works',work,true)],
 'event:historical-event':[ref('participants','Participants',[],true),ref('causes','Causes',['event'],true),ref('consequences','Consequences',['event'],true),ref('historical period','Historical Period',concept)],
 'creativework:book':[ref('author','Author',people,true),ref('publisher','Publisher',organization),date('publication date','Publication Date'),identifier('isbn','ISBN'),number('pages','Pages')],
 'creativework:film':[ref('director','Director',person,true),ref('cast','Cast',person,true),ref('production company','Production Company',organization),number('runtime','Runtime','quantity')],
 'creativework:song':[ref('composer','Composer',person,true),ref('performer','Performer',people,true),ref('album','Album',work),number('duration','Duration','quantity')],
 'creativework:article':[ref('author','Author',people,true),ref('journal publication','Journal / Publication',['creativework','organization']),identifier('doi','DOI'),date('published','Published')],
 'organization:company':[ref('industry','Industry',concept),ref('founder','Founder',person,true),ref('headquarters','Headquarters',place),ref('parent company','Parent Company',organization,false,[],true)],
 'organization:university':[ref('campus','Campus',place,true),date('established','Established'),ref('affiliation','Affiliation',organization,true)],
 'organization:nonprofit':[text('mission','Mission'),date('established','Established'),ref('service region','Service Region',place,true),ref('founder','Founder',person,true)],
 'person:fictional-character':[ref('portrayed by','Portrayed By',person,true),ref('character role','Character Role',concept,true,['concept:role'])],
 'organism:fictional-taxon':[text('scientific name','Scientific Name'),ref('parent fictional taxon','Parent Fictional Taxon',organism,false,['organism:fictional-taxon'],true)],
 'concept:folkloric-archetype':[ref('associated tradition','Associated Tradition',['culture','concept'],true)],
 'concept:mythological-creature':[ref('associated tradition','Associated Tradition',['culture','concept'],true)],
 'concept:role':[ref('role bearers','Role Bearers',person,true)],
 'thing:food':[ref('culinary tradition','Culinary Tradition',culture,true,['culture:cultural-tradition'])],
 'thing:ingredient':[ref('source organism','Source Organism',organism,true)],
 'thing:dish':[ref('ingredients','Ingredients',['thing'],true,['thing:food','thing:ingredient']),ref('recipe','Recipe',work,true,['creativework:recipe'])],
 'thing:beverage':[ref('ingredients','Ingredients',['thing'],true,['thing:food','thing:ingredient'])],
 'thing:material':[text('composition','Composition')],
 'thing:substance':[identifier('chemical formula','Chemical Formula')],
 'thing:artefact':[ref('maker','Maker',people,true),date('created','Created')],
 'creativework:recipe':[ref('ingredients','Ingredients',['thing'],true,['thing:food','thing:ingredient']),ref('resulting dish','Resulting Dish',['thing'],true,['thing:dish','thing:beverage'])],
 'organism:plant':[text('scientific name','Scientific Name'),taxon('family','Family'),ref('native range','Native Range',place,true)],
 'organism:animal':[text('scientific name','Scientific Name'),taxon('family','Family'),ref('habitat','Habitat',place,true)],
 'organism:fungus':[text('scientific name','Scientific Name'),taxon('family','Family'),ref('habitat','Habitat',place,true)],
 'organism:microorganism':[text('scientific name','Scientific Name'),taxon('taxonomic classification','Taxonomic Classification'),ref('habitat','Habitat',place,true)],
 'organism:taxon':[enumeration('taxonomic rank','Taxonomic Rank',['domain','kingdom','phylum','class','order','family','genus','species','subspecies','other','unknown']),taxon('parent taxon','Parent Taxon',true),text('scientific name','Scientific Name')],
 'organism:individual':[taxon(),date('birth hatching date','Birth / Hatching Date'),ref('location','Location',place)],
 'culture:language':[identifier('iso 639 code','ISO 639 Code'),ref('language family','Language Family',culture,false,['culture:language'],true),text('writing system','Writing System'),ref('geographic regions','Geographic Regions',place,true)],
 'culture:nationality':[ref('associated country','Associated Country',place),text('demonym','Demonym'),text('historical context','Historical Context')],
 'source:website':[{name:'url',label:'URL',kind:'url'},ref('publisher operator','Publisher / Operator',organization),date('accessed date','Accessed Date')],
 'source:journal-article':[ref('author','Author',people,true),ref('journal','Journal',['creativework','organization']),identifier('doi','DOI'),date('published','Published'),text('volume','Volume'),text('issue','Issue')],
 'source:interview':[ref('interviewee','Interviewee',person,true),ref('interviewer','Interviewer',person,true),date('conducted','Conducted'),text('medium','Medium')],
 'concept:mathematics':[text('notation','Notation'),ref('introduced by','Introduced By',person,true),ref('related theorems','Related Theorems',concept,true)],
 'concept:science':[ref('related phenomena','Related Phenomena',concept,true)],
 'concept:social-sciences':[ref('theoretical tradition','Theoretical Tradition',concept),ref('proponents','Proponents',person,true)],
 'concept:technology':[ref('inventor developer','Inventor / Developer',people,true),date('introduced','Introduced'),ref('related technologies','Related Technologies',concept,true)],
 'concept:philosophy':[ref('philosophical tradition','Philosophical Tradition',concept),ref('proponents','Proponents',person,true)],
 'concept:religion-belief':[ref('associated tradition','Associated Tradition',['culture','concept']),ref('historical origin','Historical Origin',['place','event'])],
};
const additionalSubtypeIds=new Set(['place:building', 'place:natural-feature', 'place:historical-place', 'creativework:album', 'creativework:journal', 'creativework:painting', 'creativework:poem', 'creativework:software', 'creativework:academic-paper', 'organization:government-body', 'organization:religious-institution', 'organization:research-institute', 'organization:association', 'culture:cultural-tradition', 'concept:theory', 'concept:theorem', 'concept:method', 'concept:principle', 'concept:framework']);
function fieldGuidance(field:Field):string {
 switch(field.kind) {
  case 'date': return 'Use the known date precision and preserve approximate or uncertain expressions.';
  case 'entity_reference': return 'Link an existing entity or deliberately create one; unresolved names may remain literals for review.';
  case 'identifier': return 'Preserve the exact identifier as text, including leading zeros and punctuation.';
  case 'url': return 'An HTTP or HTTPS address for this work.';
  default: return 'Brief identifying metadata; detailed content belongs in the overview or linked pages.';
 }
}
function definition(type:EntityType,field:Field,index:number,subtypeId?:string):PropertyDefinition {
 const key=field.name.replace(/ /g,'_');
 return {id:subtypeId?`builtin:${subtypeId}:${key}`:`builtin:${type}:${key}`,key,legacyName:field.name,label:field.label,description:field.description??(subtypeId&&additionalSubtypeIds.has(subtypeId)?fieldGuidance(field):''),valueKind:field.kind??'short_text',cardinality:field.many?'many':'one',allowedTargetTypes:field.targets??[],allowedTargetSubtypes:field.subtypes??[],scope:subtypeId?{kind:'subtype',type,subtypeId}:{kind:'main_type',type},origin:'builtin',visibility:subtypeId?'suggested':'core',sortOrder:(subtypeId?500:100)+index,editable:true,validation:{...(field.values?{values:field.values}:{}),...(field.hierarchical?{hierarchical:true}:{})},compatibility:'legacy'};
}
/** Additive recommendations, not mandatory fields or replacement legacy names. */
export const recommendedPropertyDefinitions:PropertyDefinition[]=[
 ...entityTypes.flatMap(type=>[ref('setting','Setting',['creativework','place'],true),ref('originating work','Originating Work',work,true),ref('tradition belief context','Tradition / Belief Context',['culture','concept'],true),ref('attested in','Attested In',['source','creativework'],true)].map((field,index)=>definition(type,{...field,description:'Optional authored context. Preserve distinct adaptations and source identities; never infer belief status from a name.'},1000+index))),
 ...Object.entries(main).flatMap(([type,fields])=>fields.map((field,index)=>definition(type as EntityType,field,index))),
 ...Object.entries(subtype).flatMap(([id,fields])=>fields.map((field,index)=>definition(id.split(':')[0] as EntityType,field,index,id))),
];
export const catalogueDisciplinePolicy='Concept Disciplines and disciplinary recommendations use the existing Domain IDs, not duplicate text properties.';
/** A custom identity occupying a native ID must not acquire native fields or target meaning. */
export function propertyCatalogueForSchema(schema:EntitySchema):PropertyDefinition[] {
 const customIds=new Set(schema.subtypes.filter(item=>item.origin==='user_defined').map(item=>item.id));
 return recommendedPropertyDefinitions.filter(item=>(item.scope.kind==='main_type'||!customIds.has(item.scope.subtypeId))&&!item.allowedTargetSubtypes.some(id=>customIds.has(id)));
}
/** Populate additive discovery arrays without changing the legacy builtinProperties registry. */
export function withPropertyCatalogue(schema:EntitySchema):EntitySchema {
 const properties=Object.fromEntries(Object.entries(schema.properties).map(([type,names])=>[type,[...names]])) as Record<EntityType,string[]>;
 const subtypeProperties=Object.fromEntries(Object.entries(schema.subtypeProperties).map(([id,names])=>[id,[...names]]));
 for(const item of propertyCatalogueForSchema(schema)) {
  if(item.scope.kind==='main_type'){const names=properties[item.scope.type];if(!names.some(name=>name.toLowerCase()===item.legacyName.toLowerCase()))names.push(item.legacyName);}
  else {const scope=item.scope;if(schema.subtypes.some(subtype=>subtype.id===scope.subtypeId&&subtype.type===scope.type)){
   const fields=subtypeProperties[scope.subtypeId]??=[];if(!fields.some(name=>name.toLowerCase()===item.legacyName.toLowerCase()))fields.push(item.legacyName);
  }}
 }
 return {...schema,properties,subtypeProperties};
}
