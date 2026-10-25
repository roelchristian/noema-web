import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {revealEntityFact} from '../src/client/chat/entity-evidence-navigation.ts';

test('entity evidence reveals the exact full property and relationship IDs without invoking mutation controls',t=>{
 const dom=new JSDOM('<button id="entity-home-tab-overview" aria-selected="true"></button><button id="entity-home-tab-connections" aria-selected="false"></button><article class="entity-home"><div data-property-id="p1" tabindex="-1">short</div><details><summary>Properties</summary><div class="entity-property-card" data-property-id="p1" tabindex="-1">full property</div></details><div hidden id="connections"><details><summary>Relationships</summary><div data-relationship-id="r1" tabindex="-1">exact relationship</div></details></div><p data-entity-description tabindex="-1">description</p><section data-entity-overview tabindex="-1">overview</section></article>');
 const previous={document:global.document,HTMLDetailsElement:global.HTMLDetailsElement,CSS:global.CSS};Object.assign(global,{document:dom.window.document,HTMLDetailsElement:dom.window.HTMLDetailsElement,CSS:{escape:value=>value}});t.after(()=>{Object.assign(global,previous);dom.window.close();});
 dom.window.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};
 const root=document.querySelector('article'),overview=document.getElementById('entity-home-tab-overview'),connections=document.getElementById('entity-home-tab-connections');
 connections.onclick=()=>{connections.setAttribute('aria-selected','true');overview.setAttribute('aria-selected','false');document.getElementById('connections').hidden=false;};
 overview.onclick=()=>{overview.setAttribute('aria-selected','true');connections.setAttribute('aria-selected','false');};
 assert.equal(revealEntityFact(root,'property:p1'),true);assert.equal(document.activeElement.textContent,'full property');assert.equal(document.activeElement.closest('details').open,true);
 assert.equal(revealEntityFact(root,'relationship:r1'),false,'select the correct tab before focusing its record');assert.equal(revealEntityFact(root,'relationship:r1'),true);assert.equal(document.activeElement.dataset.relationshipId,'r1');assert.equal(document.activeElement.closest('details').open,true);
 assert.equal(revealEntityFact(root,'description'),false);assert.equal(revealEntityFact(root,'description'),true);assert.equal(document.activeElement.textContent,'description');assert.equal(revealEntityFact(root,'overview'),true);assert.equal(document.activeElement.textContent,'overview');
 assert.equal(revealEntityFact(root,'property:missing'),false,'never navigate to a nearby substitute record');
});
