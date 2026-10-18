import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {DomainPicker, domainBreadcrumb} from '../src/client/knowledge/DomainPicker.tsx';
import {PageConceptCategory} from '../src/client/intelligence/PageConceptCategory.tsx';
import {DOMAINS, TAXONOMY_VERSION} from '../src/shared/domains.ts';
import {entityDraftValues, mergeEntityDraft, entityDraftDirty} from '../src/client/knowledge/entity-drafts.ts';

async function ui(work) {
  const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
  const keys = ['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'];
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis,key));
  for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
  dom.window.HTMLElement.prototype.attachEvent = function() {};
  dom.window.HTMLElement.prototype.detachEvent = function() {};
  const root = createRoot(document.querySelector('#mount'));
  const click = async selector => {const target=typeof selector==='string'?document.querySelector(selector):selector;assert.ok(target);await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
  try {await work(root,click);} finally {await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}

test('domain picker progressively browses canonical hierarchy and keeps subtype-independent selections', async()=>{
  await ui(async(root,click)=>{
    let selected=[];
    const render=()=>root.render(React.createElement(DomainPicker,{value:selected,onChange:value=>{selected=value;render();}}));
    await act(async()=>render());
    assert.equal(document.querySelectorAll('.domain-option-row').length,0);
    await click('.subtype-trigger');
    assert.equal(document.querySelectorAll('.domain-option-row').length,DOMAINS.filter(domain=>!domain.parent_id).length);
    await click('[aria-label="Browse Mathematics and Formal Sciences"]');
    assert.ok(document.querySelector('.domain-breadcrumb').textContent.includes('Mathematics'));
    await click('[aria-label="Browse Algebra"]');
    const option=[...document.querySelectorAll('.subtype-option')].find(button=>button.textContent.includes('Abstract Algebra'));
    await click(option);
    assert.deepEqual(selected,['mathematics.algebra.abstract']);
    assert.equal(domainBreadcrumb(selected[0]),'Mathematics and Formal Sciences → Algebra → Abstract Algebra');
    await click('[aria-label="Remove Mathematics and Formal Sciences → Algebra → Abstract Algebra"]');
    assert.deepEqual(selected,[]);
  });
});

test('page subjects save through workspace callback and follow new page assignments',async()=>{
  await ui(async(root,click)=>{
    const page={id:'p',vault_id:'default',conceptContentHash:'body-v1',pageDomains:{primaryDomainId:'mathematics',secondaryDomainIds:[],origin:'inferred',status:'inferred',contentHash:'body-v1',taxonomyVersion:TAXONOMY_VERSION}};
    let saved;
    const props={page,onDomainsChange:async(primary,secondary)=>{saved={primary,secondary};}};
    await act(async()=>root.render(React.createElement(PageConceptCategory,props)));
    assert.match(document.querySelector('.page-domain-summary').textContent,/Mathematics/);
    assert.equal(document.querySelector('.domain-status').textContent,'Inferred');
    await act(async()=>root.render(React.createElement(PageConceptCategory,{...props,page:{...page,conceptContentHash:undefined}})));
    assert.equal(document.querySelector('.domain-status').textContent,'Needs refresh');
    await click('.summary-toggle');
    await click('.page-domain-actions .primary');
    assert.deepEqual(saved,{primary:'mathematics',secondary:[]});
    await act(async()=>root.render(React.createElement(PageConceptCategory,{...props,page:{...page,conceptContentHash:undefined,pageDomains:{...page.pageDomains,primaryDomainId:'psychology',status:'manual',origin:'manual'}}})));
    assert.equal(document.querySelector('.domain-status').textContent,'Manual');
    assert.match(document.querySelector('.page-domain-summary').textContent,/Psychology/);
  });
});

test('entity draft preserves edited disciplines and refreshes untouched subtypes independently',()=>{
  const entity={name:'Field',type:'concept',description:'',subtypes:['concept:mathematics'],domainIds:['mathematics'],aliases:[]};
  const baseline=entityDraftValues(entity);
  const values={...baseline,domainIds:['mathematics.algebra.abstract']};
  const server=entityDraftValues({...entity,subtypes:['custom:algebra'],domainIds:['psychology']});
  const merged=mergeEntityDraft({baseline,values},server);
  assert.deepEqual(merged.domainIds,['mathematics.algebra.abstract']);
  assert.deepEqual(merged.subtypes,['custom:algebra']);
  assert.equal(entityDraftDirty(values,baseline),true);
  assert.equal(entityDraftDirty({...baseline,domainIds:[...baseline.domainIds]},baseline),false);
});
