import {test} from 'node:test';
import assert from 'node:assert/strict';
import {builtinProperties,builtinSubtypes} from '../src/shared/entity-schema.ts';
import {builtinPropertyDefinitions,propertyLabel,propertyDefinitionFor,propertyDefinitionsForSchema,inheritedPropertyDefinitions,propertyDefinitionConflicts} from '../src/shared/property-definitions.ts';

const schema={properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{}};
test('definition registry preserves every existing builtin API name and has stable unique IDs',()=>{
  assert.deepEqual(builtinProperties.person,['birth date','birthplace','nationality','website']);
  assert.deepEqual(builtinProperties.source,['Import method','Source URL','url','author','publication date','accessed date']);
  assert.equal(builtinPropertyDefinitions.length,Object.values(builtinProperties).flat().length);
  assert.equal(builtinSubtypes.length,50);
  assert.ok(builtinSubtypes.some(subtype=>subtype.id==='culture:language'));
  assert.ok(!builtinSubtypes.some(subtype=>subtype.name==='Software'));
  assert.equal(new Set(builtinPropertyDefinitions.map(item=>item.id)).size,builtinPropertyDefinitions.length);
  for(const [type,names] of Object.entries(builtinProperties))for(const name of names){
    const definition=propertyDefinitionFor(type,name);
    assert.equal(definition.legacyName,name);
    assert.equal(definition.compatibility,'legacy');
    assert.match(definition.id,/^builtin:/);
  }
  assert.equal(propertyDefinitionFor('person','BIRTH DATE').id,'builtin:person:birth_date');
  assert.equal(propertyLabel('Source URL'),'Source URL');
  assert.equal(propertyLabel('isbn'),'ISBN');
  assert.equal(propertyLabel('birth_date'),'Birth Date');
  assert.equal(propertyLabel('My custom ABC'),'My custom ABC');
});
test('inferred reference metadata distinguishes language identity and ambiguous nationality',()=>{
  assert.deepEqual(propertyDefinitionFor('person','birthplace').allowedTargetTypes,['place']);
  assert.deepEqual(propertyDefinitionFor('creativework','language').allowedTargetSubtypes,['culture:language']);
  assert.equal(propertyDefinitionFor('creativework','language').cardinality,'many');
  assert.equal(propertyDefinitionFor('person','nationality').valueKind,'short_text');
  assert.equal(propertyDefinitionFor('person','birth date').valueKind,'date');
  assert.equal(propertyDefinitionFor('source','Source URL').valueKind,'url');
  assert.equal(propertyDefinitionFor('source','Source URL').cardinality,'many');
  assert.equal(propertyDefinitionFor('source','Import method').cardinality,'many');
  assert.equal(propertyDefinitionFor('source','Source URL').editable,false);
  assert.equal(propertyDefinitionFor('source','url').editable,true);
});
test('custom schema adapters remain scoped, preserve labels and do not constrain legacy data',()=>{
  const extended={...schema,subtypeProperties:{'person:actor':['My custom ABC','birth date']}};
  const definitions=propertyDefinitionsForSchema(extended,'vault-a');
  const custom=definitions.find(item=>item.legacyName==='My custom ABC');
  assert.equal(custom.label,'My custom ABC');
  assert.equal(custom.cardinality,'many');
  assert.equal(custom.compatibility,'legacy');
  assert.notEqual(custom.id,propertyDefinitionsForSchema(extended,'vault-b').find(item=>item.legacyName==='My custom ABC').id);
  const inherited=inheritedPropertyDefinitions({...extended,propertyDefinitions:definitions},'person',['person:actor']);
  assert.equal(inherited.filter(item=>item.key==='birth_date').length,2);
  assert.equal(propertyDefinitionConflicts(inherited)[0].key,'birth_date');
  assert.ok(inherited.some(item=>item.id===custom.id));
  assert.ok(!inheritedPropertyDefinitions({...extended,propertyDefinitions:definitions},'person',[]).some(item=>item.id===custom.id));
});
