import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {EntityTypeManager} from '../src/client/knowledge/EntityTypeManager.tsx';
import {defaultAppearance} from '../src/client/settings/appearance.ts';
import {PropertyDefinitionManager} from '../src/client/knowledge/PropertyDefinitionManager.tsx';
import {api} from '../src/client/api.ts';
import {builtinProperties,builtinSubtypes} from '../src/shared/entity-schema.ts';
import {propertyDefinitionFor} from '../src/shared/property-definitions.ts';
const custom={id:'custom:count',key:'research_count',legacyName:'Research Count',label:'Research Count',description:'',scope:{kind:'main_type',type:'person'},origin:'user_defined',visibility:'additional',valueKind:'short_text',cardinality:'many',allowedTargetTypes:[],allowedTargetSubtypes:[],sortOrder:100,editable:true,validation:{},compatibility:'legacy'};
async function fixture(t,work){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));const schema={properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{},propertyDefinitions:[custom,propertyDefinitionFor('person','birth date')]};let changed;
 const props={vaultId:'fixture',type:'person',schema,onChange:value=>changed=value};
 const render=async()=>act(async()=>root.render(React.createElement(PropertyDefinitionManager,props)));
 const select=async(label,value)=>{if(label==='Property definition'){const node=[...document.querySelectorAll('.schema-registry-list button')].find(node=>node.textContent.includes(schema.propertyDefinitions.find(item=>item.id===value)?.label));assert.ok(node);await act(async()=>node.click());return;}const node=document.querySelector('[aria-label="'+label+'"]');assert.ok(node,label);await act(async()=>{node.value=value;node.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});};
 const click=async(node)=>{if(typeof node==='string')node=document.querySelector(node);assert.ok(node);await act(async()=>node.click());};
 const input=async(label,value)=>{const node=document.querySelector('[aria-label="'+label+'"]');assert.ok(node,label);await act(async()=>{node.focus();Object.getOwnPropertyDescriptor(env.dom.window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new env.dom.window.Event('input',{bubbles:true}));node.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));node.dispatchEvent(new env.dom.window.KeyboardEvent('keyup',{key:'d',bubbles:true}));});};
 await render();await work({props,schema,select,click,input,changed:()=>changed,dom:env.dom});}

test('custom definition manager previews populated changes and requires explicit retention before apply',async t=>fixture(t,async({schema,select,click,changed})=>{
 let previewBody,saved;
 t.mock.method(api,'propertyDefinitionImpact',async(_vault,_id,body)=>{previewBody=body;return {fingerprint:'fixture-proof',definition:{...custom,...body},affectedValues:2,compatibleValues:0,incompatible:[{propertyId:'old',entityId:'entity',reason:'Multiple authored values require cardinality review.'}]};});
 t.mock.method(api,'updatePropertyDefinition',async(_vault,id,body)=>{saved={id,...body};return {...custom,...body};});t.mock.method(api,'entitySchema',async()=>schema);
 await select('Property definition',custom.id);assert.equal(document.querySelector('[aria-label="Stable property key"]').disabled,true);
 await select('Property cardinality','one');await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Review definition impact'));
 assert.equal(previewBody.cardinality,'one');assert.match(document.querySelector('.property-definition-impact').textContent,/Affected values: 2/);
 const apply=[...document.querySelectorAll('button')].find(node=>node.textContent==='Apply definition');assert.equal(apply.disabled,true);assert.equal(saved,undefined);
 await click('.property-definition-impact input[type="checkbox"]');await click(apply);
 assert.equal(saved.id,custom.id);assert.equal(saved.impactFingerprint,'fixture-proof');assert.equal(saved.confirmCompatibility,true);assert.equal(changed(),schema);
}));
test('builtin definition settings remain protected in the manager',async t=>fixture(t,async({select})=>{
 await select('Property definition','builtin:person:birth_date');assert.equal(document.querySelector('.property-definition-form'),null);
 assert.ok(document.querySelector('.schema-builtin dl'));
 assert.match(document.querySelector('.property-definition-manager').textContent,/Built-in keys and semantics are protected/);
 assert.equal([...document.querySelectorAll('button')].some(node=>node.type==='submit'),false);
}));
test('creating a custom main-type field keeps the stored name separate from its label',async t=>fixture(t,async({schema,input,click,changed})=>{
 let saved;
 t.mock.method(api,'createPropertyDefinition',async(_vault,body)=>{saved=body;return {...custom,...body,id:'custom:new',key:body.key??'my_field',legacyName:body.name};});t.mock.method(api,'entitySchema',async()=>schema);
 await input('Stored property name','My Field');await input('Property display label','A Curated Label');
 await click('form[aria-label="Property definition editor"] button[type="submit"]');
 assert.equal(saved.name,'My Field');assert.equal(saved.label,'A Curated Label');assert.deepEqual(saved.scope,{kind:'main_type',type:'person'});assert.equal(changed(),schema);
}));


test('a committed definition survives schema refresh failure and retry only refreshes',async t=>fixture(t,async({schema,input,click})=>{
 let creates=0,reads=0;
 t.mock.method(api,'createPropertyDefinition',async(_vault,body)=>{creates++;return {...custom,...body,id:'custom:accepted',key:'accepted',legacyName:body.name};});
 t.mock.method(api,'entitySchema',async()=>{reads++;if(reads===1)throw new Error('refresh offline');return schema;});
 await input('Stored property name','Accepted');await click('form[aria-label="Property definition editor"] button[type="submit"]');
 assert.equal(creates,1);assert.equal(document.querySelector('[aria-label="Stored property name"]').disabled,true);assert.match(document.querySelector('.property-definition-manager').textContent,/definition was saved/);
 await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Retry schema refresh'));
 assert.equal(creates,1);assert.equal(reads,2);
}));
test('uncertain definition writes reconcile through a read before another mutation',async t=>fixture(t,async({schema,input,click})=>{
 let creates=0,reads=0;
 t.mock.method(api,'createPropertyDefinition',async()=>{creates++;throw new Error('response lost');});
 t.mock.method(api,'entitySchema',async()=>{reads++;return {...schema,propertyDefinitions:[...schema.propertyDefinitions,{...custom,id:'custom:recovered',key:'recovered',legacyName:'Recovered',label:'Recovered',cardinality:'one'}]};});
 await input('Stored property name','Recovered');await click('form[aria-label="Property definition editor"] button[type="submit"]');
 assert.equal(creates,1);assert.equal(document.querySelector('.property-definition-form>fieldset').disabled,true);
 await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Check saved definition'));
 assert.equal(creates,1);assert.equal(reads,1);assert.match(document.querySelector('.property-definition-manager').textContent,/Saved definition recovered/);
}));


test('an uncertain update whose server state differs retains the proposed definition draft',async t=>fixture(t,async({schema,select,click})=>{
 let updates=0,reads=0;
 t.mock.method(api,'propertyDefinitionImpact',async(_vault,_id,body)=>({fingerprint:'proposal',definition:{...custom,...body},affectedValues:0,compatibleValues:0,incompatible:[]}));
 t.mock.method(api,'updatePropertyDefinition',async()=>{updates++;throw new Error('request lost');});
 t.mock.method(api,'entitySchema',async()=>{reads++;return schema;});
 await select('Property definition',custom.id);await select('Property value kind','integer');
 await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Review definition impact'));await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Apply definition'));
 assert.equal(updates,1);await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Check saved definition'));
 assert.equal(updates,1);assert.equal(reads,1);assert.equal(document.querySelector('[aria-label="Property value kind"]').value,'integer');assert.match(document.querySelector('.property-definition-manager').textContent,/proposed settings are retained/);
}));


test('registry search and selection preserve drafts; cancel restores saved values',async t=>fixture(t,async({select,input,click})=>{
 await select('Property definition',custom.id);
 await input('Property display label','Unsaved research');
 await select('Property definition','builtin:person:birth_date');
 assert.ok(document.querySelector('.schema-builtin'));
 await select('Property definition',custom.id);
 assert.equal(document.querySelector('[aria-label="Property display label"]').value,'Unsaved research');
 await click([...document.querySelectorAll('button')].find(node=>node.textContent==='Cancel changes'));
 assert.equal(document.querySelector('[aria-label="Property display label"]').value,'Research Count');
 assert.equal(document.querySelector('[aria-label="Property cardinality"]').value,'many');
 await input('Search properties','missing synthetic field');
 assert.equal(document.querySelectorAll('.schema-registry-list button').length,0);
 assert.match(document.querySelector('.schema-registry').textContent,/No matching properties/);
}));

test('typed creation generates collision-safe identity and defaults only new definitions to one value',async t=>fixture(t,async({schema,input,click,select})=>{
 let saved;
 t.mock.method(api,'createPropertyDefinition',async(_vault,body)=>{saved=body;return {...custom,...body,id:'custom:new',legacyName:body.name};});t.mock.method(api,'entitySchema',async()=>schema);
 await input('Property display label','Research Count');
 assert.equal(document.querySelector('[aria-label="Property cardinality"]').value,'one');
 assert.equal(document.querySelector('[aria-label="Stable property key"]').value,'research_count_2');
 await select('Property definition scope','person:writer');
 await click('form[aria-label="Property definition editor"] button[type="submit"]');
 assert.equal(saved.name,'Research Count (2)');assert.equal(saved.key,'research_count_2');assert.equal(saved.label,'Research Count');assert.equal(saved.cardinality,'one');assert.deepEqual(saved.scope,{kind:'subtype',type:'person',subtypeId:'person:writer'});
}));


test('effective property conflicts link both stable definitions into the registry inspector',async t=>{
 const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const scoped={...custom,id:'custom:scoped',label:'Scoped Research',scope:{kind:'subtype',type:'person',subtypeId:'person:writer'},valueKind:'integer'};
 const schema={properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{},propertyDefinitions:[custom,scoped]};
 await act(async()=>root.render(React.createElement(EntityTypeManager,{vaultId:'fixture',schema,onChange:()=>{},entityColors:defaultAppearance().entityColors,onColorChange:()=>{}})));
 const click=async node=>act(async()=>node.click());
 await click([...document.querySelectorAll('.schema-subtype-row > button')].find(node=>node.textContent==='Writer'));
 assert.match(document.querySelector('.schema-property-summary').textContent,/Research CountPerson/);
 assert.match(document.querySelector('.schema-property-summary').textContent,/Scoped ResearchWriter/);
 const links=document.querySelectorAll('.schema-type-inspector .property-definition-conflicts button');assert.equal(links.length,2);
 await click(links[1]);assert.equal(document.querySelector('[aria-label="Property value kind"]').value,'integer');
 await click([...document.querySelectorAll('.schema-views button')].find(node=>node.textContent==='Types & subtypes'));
 await click(links[0]);assert.equal(document.querySelector('[aria-label="Property value kind"]').value,'short_text');
});


test('ordinary label edits use governance without an unnecessary compatibility step',async t=>fixture(t,async({schema,select,input,click})=>{
 let saved;
 t.mock.method(api,'propertyDefinitionImpact',async(_vault,_id,body)=>({fingerprint:'label-only',definition:{...custom,...body},affectedValues:2,compatibleValues:2,incompatible:[]}));
 t.mock.method(api,'updatePropertyDefinition',async(_vault,_id,body)=>{saved=body;return {...custom,...body};});t.mock.method(api,'entitySchema',async()=>schema);
 await select('Property definition',custom.id);await input('Property display label','Curated count');await click('form[aria-label="Property definition editor"] button[type="submit"]');
 assert.equal(saved.label,'Curated count');assert.equal(saved.impactFingerprint,'label-only');assert.equal(saved.cardinality,'many');assert.equal(document.querySelector('.property-definition-impact'),null);
}));
