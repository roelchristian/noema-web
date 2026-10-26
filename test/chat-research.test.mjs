import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatMentionChoices,chatScopeChoices} from '../src/client/chat/ChatContextPicker.tsx';
import {chatEvidenceCoverage,chatResearchPrompts} from '../src/client/chat/ChatResearch.tsx';

test('scope boundaries and subject mentions use separate choices and reject archived/foreign entities',()=>{
 const entity=(id,type,extra={})=>({id,type,name:id,vault_id:'v',...extra});
 const entities=[entity('Subject','person'),entity('Source','source'),entity('Foreign','person',{vault_id:'other'}),entity('Archived','person',{archived_at:'2026-10-26'}),entity('Inactive','source',{inactive:true})];
 const notes=[{id:'note',title:'Note'},{id:'archived-note',title:'Archived note',archived_at:'2026-10-26'}];
 const folders=[{id:'root',name:'Root',parent_id:null},{id:'child',name:'Child',parent_id:'root'}];
 assert.deepEqual(chatMentionChoices('v','',entities,[]).map(item=>item.key),['entity:Subject']);
 assert.deepEqual(chatMentionChoices('v','',entities,[{id:'Subject',name:'Subject'}]),[]);
 assert.deepEqual(chatScopeChoices('v','',entities,notes,folders).map(item=>item.key),['page:note','source:Source','folder:root','folder:child']);
 assert.deepEqual(chatScopeChoices('v','Root / Child',entities,notes,folders).map(item=>item.key),['folder:child']);
 assert.deepEqual(chatMentionChoices('v','source',entities,[]),[],'a source cannot silently change scope through @');
});

test('coverage counts real parent materials and prompts follow the selected scope',()=>{
 const evidence=[{kind:'source',objectId:'s'},{kind:'source',objectId:'s'},{kind:'source',objectId:'s2'},{kind:'own_note',objectId:'n'},{kind:'entity_fact',objectId:'e'},{kind:'entity_overview',objectId:'e'}];
 assert.deepEqual(chatEvidenceCoverage(evidence),{passages:6,sources:2,notes:1,entities:1});
 assert.deepEqual(chatEvidenceCoverage([]),{passages:0,sources:0,notes:0,entities:0});
 for(const kind of ['vault','source','page','folder','entity']){
  const prompts=chatResearchPrompts({kind,id:'synthetic'});assert.equal(prompts.length,3);assert.equal(new Set(prompts).size,3);assert.ok(prompts.every(prompt=>prompt.length<100));
 }
 assert.match(chatResearchPrompts({kind:'folder',id:'f'})[0],/this folder/);
 assert.match(chatResearchPrompts({kind:'source',id:'s'})[0],/this source/);
});
