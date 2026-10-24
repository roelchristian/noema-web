import {test} from 'node:test';
import assert from 'node:assert/strict';
import {builtinProperties,builtinSubtypes,inheritedPropertyNames,vaultSubtypes,subtypeDisplayName} from '../src/shared/entity-schema.ts';
import {recommendedPropertyDefinitions,withPropertyCatalogue,propertyDefinitionsForSchema,inheritedPropertyDefinitions,propertyDefinitionConflicts,suggestedPropertyDefinitions,propertyLabel,catalogueDisciplinePolicy,resolvePropertyDefinition} from '../src/shared/property-definitions.ts';
const legacy={properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{}};
const schema=withPropertyCatalogue(legacy);
const resolve=(type,ids=[])=>inheritedPropertyDefinitions({...schema,propertyDefinitions:propertyDefinitionsForSchema(schema,'fixture')},type,ids);

test('catalogue covers all ten types and 82 subtype IDs without replacing legacy arrays',()=>{
 assert.equal(builtinSubtypes.length,82);
 assert.deepEqual(builtinProperties.person,['birth date','birthplace','nationality','website']);
 assert.deepEqual(builtinProperties.organism,[]);
 assert.equal(new Set(recommendedPropertyDefinitions.map(item=>item.id)).size,recommendedPropertyDefinitions.length);
 const ids=new Set(recommendedPropertyDefinitions.filter(item=>item.scope.kind==='subtype').map(item=>item.scope.subtypeId));
 assert.equal(ids.size,82);
 assert.deepEqual([...ids].sort(),builtinSubtypes.map(item=>item.id).sort());
 assert.equal(schema.subtypes,legacy.subtypes);
 assert.ok(schema.properties.organism.includes('scientific name'));
 assert.ok(schema.subtypeProperties['person:actor'].includes('awards'));
 assert.deepEqual(withPropertyCatalogue(schema),schema,'discovery augmentation is idempotent');
 assert.ok(!recommendedPropertyDefinitions.some(item=>['disciplines','discipline','associated discipline'].includes(item.legacyName)));
 assert.match(catalogueDisciplinePolicy,/Domain IDs/);
});

test('typed targets preserve language identity, nationality ambiguity, hierarchy and Work/Source distinction',()=>{
 const find=id=>recommendedPropertyDefinitions.find(item=>item.id===id);
 assert.deepEqual(find('builtin:person:citizenship').allowedTargetSubtypes,['place:country']);
 assert.deepEqual(find('builtin:source:language').allowedTargetSubtypes,['culture:language']);
 assert.match(find('builtin:source:language').description,/independent of display/);
 assert.deepEqual(find('builtin:source:associated_work').allowedTargetTypes,['creativework']);
 assert.deepEqual(find('builtin:person:journalist:publications').allowedTargetTypes,['source','organization']);
 assert.equal(find('builtin:organism:taxon:parent_taxon').validation.hierarchical,true);
 assert.deepEqual(find('builtin:organism:taxon:parent_taxon').allowedTargetSubtypes,['organism:taxon']);
 assert.equal(find('builtin:culture:language:language_family').validation.hierarchical,true);
 assert.equal(find('builtin:organization:parent_organization').validation.hierarchical,true);
 assert.equal(propertyLabel('isbn'),'ISBN');assert.equal(propertyLabel('iso_639_code'),'ISO 639 Code');assert.equal(propertyLabel('native range'),'Native Range');
});

test('multi-subtype catalogue deduplicates compatible stable keys and reports constraint conflicts',()=>{
 const definitions=resolve('person',['person:researcher','person:educator','person:physician']);
 assert.equal(definitions.filter(item=>item.key==='institution').length,1);
 assert.equal(propertyDefinitionConflicts(definitions).length,0);
 const core=resolve('creativework',['creativework:book']).filter(item=>item.key==='author');
 assert.equal(core.length,1);assert.equal(core[0].scope.kind,'main_type');
 const reverse=propertyDefinitionsForSchema(schema,'fixture').sort((a,b)=>a.id.localeCompare(b.id));
 const sortedCore=inheritedPropertyDefinitions({...schema,propertyDefinitions:reverse},'creativework',['creativework:book']).filter(item=>item.key==='author');
 assert.equal(sortedCore.length,1);assert.equal(sortedCore[0].scope.kind,'main_type','persisted ID order cannot downgrade core fields');
 const one=definitions.find(item=>item.key==='institution');
 const conflict={...one,id:'fixture:incompatible',cardinality:'one'};
 const constraints={...one,id:'fixture:constraint',validation:{max:3,min:1}};
 const sameConstraints={...constraints,id:'fixture:same-constraint',validation:{min:1,max:3}};
 assert.equal(propertyDefinitionConflicts([constraints,sameConstraints]).length,0);
 assert.equal(propertyDefinitionConflicts([one,conflict])[0].key,'institution');
 assert.equal(propertyDefinitionConflicts([one,constraints])[0].key,'institution');
 const inherited=inheritedPropertyDefinitions({...schema,propertyDefinitions:[one,conflict]},'person',[one.scope.subtypeId]);
 assert.equal(inherited.length,2,'incompatible definitions remain reviewable');
});

test('deterministic suggestions preserve scopes, limit unset rows and never instantiate values',()=>{
 const first=suggestedPropertyDefinitions(schema,'organism',['organism:taxon'],[],3);
 assert.equal(first.length,3);assert.deepEqual(first,suggestedPropertyDefinitions(schema,'organism',['organism:taxon'],[],3));
 const next=suggestedPropertyDefinitions(schema,'organism',['organism:taxon'],first.map(item=>item.legacyName),3);
 assert.ok(next.every(item=>!first.some(previous=>previous.key===item.key)));
 assert.ok(!inheritedPropertyNames(schema,'person',['person:writer']).includes('awards'));
 assert.ok(inheritedPropertyNames(schema,'person',['person:actor']).includes('awards'));
 assert.equal(suggestedPropertyDefinitions(schema,'person',[],[],0).length,0);
});


test('bound definitions remain resolvable after a classification change while fresh selection prefers core',()=>{
 const definitions=propertyDefinitionsForSchema(schema,'fixture');
 const id='builtin:person:researcher:institution';
 assert.equal(resolvePropertyDefinition(definitions,'place',[],'institution',id).id,id);
 assert.equal(resolvePropertyDefinition(definitions,'person',[],'institution'),undefined);
 assert.equal(resolvePropertyDefinition(definitions,'creativework',['creativework:book'],'author').scope.kind,'main_type');
});


test('the 19 requested additions have curated schemas and compatible multi-subtype unions',()=>{
 const additions={place:['building','natural-feature','historical-place'],creativework:['album','journal','painting','poem','software','academic-paper'],organization:['government-body','religious-institution','research-institute','association'],culture:['cultural-tradition'],concept:['theory','theorem','method','principle','framework']};
 const expected=Object.entries(additions).flatMap(([type,names])=>names.map(name=>`${type}:${name}`));
 assert.equal(expected.length,19);
 const choices=vaultSubtypes([{id:'fixture:building',name:'Building',type:'place'}]);
 assert.equal(subtypeDisplayName(choices.find(item=>item.id==='fixture:building'),choices),'Building (custom)');
 assert.equal(subtypeDisplayName(choices.find(item=>item.id==='place:building'),choices),'Building');
 assert.deepEqual(builtinSubtypes.filter(item=>expected.includes(item.id)&&item.description).map(item=>item.id).sort(),expected.sort());
 for(const id of expected){
  const subtype=builtinSubtypes.find(item=>item.id===id);
  assert.equal(subtype.type,id.split(':')[0]);assert.ok(subtype.description.length>30);
  const fields=recommendedPropertyDefinitions.filter(item=>item.scope.kind==='subtype'&&item.scope.subtypeId===id);
  assert.equal(fields.length,3);assert.ok(fields.every(item=>item.origin==='builtin'&&item.visibility==='suggested'&&item.description));
  assert.ok(fields.every(item=>item.valueKind!=='long_text'),'content belongs in overview/pages');
 }
 for(const type of Object.keys(additions)){
  const all=resolve(type,builtinSubtypes.filter(item=>item.type===type).map(item=>item.id));
  assert.deepEqual(propertyDefinitionConflicts(all),[],`no contradictory native fields for ${type}`);
  assert.equal(new Set(all.map(item=>item.key)).size,all.length);
 }
 const find=id=>recommendedPropertyDefinitions.find(item=>item.id===id);
 assert.deepEqual(find('builtin:creativework:academic-paper:journal').allowedTargetTypes,['creativework']);
 assert.deepEqual(find('builtin:creativework:academic-paper:journal').allowedTargetSubtypes,['creativework:journal']);
 assert.equal(find('builtin:creativework:journal:issn').valueKind,'identifier');
 assert.equal(find('builtin:creativework:software:version').valueKind,'identifier');
 for(const id of ['builtin:place:natural-feature:elevation','builtin:creativework:album:duration','builtin:creativework:painting:width']){
  assert.equal(find(id).valueKind,'quantity');assert.match(find(id).description,/unit/);
 }
 assert.equal(find('builtin:concept:theorem:proven').valueKind,'date');
 assert.deepEqual(find('builtin:concept:framework:based_on_theories').allowedTargetSubtypes,['concept:theory']);
 assert.deepEqual(builtinSubtypes.filter(item=>item.type==='source').map(item=>item.id),['source:website','source:journal-article','source:interview']);
 assert.ok(!recommendedPropertyDefinitions.some(item=>item.key==='discipline'||item.key==='proof'||item.key==='definition'));
});
