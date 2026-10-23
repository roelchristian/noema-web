import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
import {PropertyDefinitionManager} from '../src/client/knowledge/PropertyDefinitionManager.tsx';
import {api} from '../src/client/api.ts';
import {builtinProperties,builtinSubtypes} from '../src/shared/entity-schema.ts';
import {propertyDefinitionFor} from '../src/shared/property-definitions.ts';
const custom={id:'custom:count',key:'research_count',legacyName:'Research Count',label:'Research Count',description:'',scope:{kind:'main_type',type:'person'},origin:'user_defined',visibility:'additional',valueKind:'short_text',cardinality:'many',allowedTargetTypes:[],allowedTargetSubtypes:[],sortOrder:100,editable:true,validation:{},compatibility:'legacy'};
async function fixture(t,work){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));const schema={properties:builtinProperties,subtypes:builtinSubtypes,subtypeProperties:{},propertyDefinitions:[custom,propertyDefinitionFor('person','birth date')]};let changed;
 const props={vaultId:'fixture',type:'person',schema,onChange:value=>changed=value};
 const render=async()=>act(async()=>root.render(React.createElement(PropertyDefinitionManager,props)));
 const select=async(label,value)=>{const node=document.querySelector('[aria-label="'+label+'"]');assert.ok(node,label);await act(async()=>{node.value=value;node.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});};
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
 await select('Property definition','builtin:person:birth_date');assert.equal(document.querySelector('.property-definition-form>fieldset').disabled,true);
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
 t.mock.method(api,'entitySchema',async()=>{reads++;return {...schema,propertyDefinitions:[...schema.propertyDefinitions,{...custom,id:'custom:recovered',key:'recovered',legacyName:'Recovered',label:'Recovered'}]};});
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
