import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';

const css=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const {SourceRevisionDiff,revisionDiffLines,buildRevisionDiffGroups,buildRevisionDiffContext,revisionSplitRows}=await import('../src/client/sources/SourceRevisionDiff.tsx');
css.deregister();

function fixture(){
 const revision=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));
 const text='Heading\n\nA claim1.\n\n1 An explanatory note.\n\nAnother passage.';
 const base=revision.patches[0];
 const patch=(id,original,replacement,category,group)=>{const start=text.indexOf(original);return {...base,id,original,replacement,category,patchGroupId:group,decision:'pending',reason:`Explanation for ${id}`,range:{...base.range,startOffset:start,endOffset:start+original.length,startLine:text.slice(0,start).split('\n').length,endLine:text.slice(0,start+original.length).split('\n').length},riskReasons:['Check the source note.']};};
 revision.original.text=text;
 revision.patches=[patch('reference','claim1','claim[^1]','footnote','note-1'),patch('note','1 An explanatory note.','[^1]: An explanatory note.','footnote','note-1'),patch('wording','Another passage.','Another corrected passage.','ocr')];
 return revision;
}

async function mount(t,props,{width}={}){
 const env=setupDOM(t);let resize;
 if(width!==undefined){const previous=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,writable:true,value:class{constructor(callback){resize=callback;}observe(){resize([{contentRect:{width}}]);}disconnect(){}}});env.defer(()=>{if(previous)Object.defineProperty(globalThis,'ResizeObserver',previous);else delete globalThis.ResizeObserver;});}
 const root=createRoot(document.querySelector('#mount'));
 env.defer(()=>act(async()=>root.unmount()));
 await act(async()=>root.render(React.createElement(SourceRevisionDiff,props)));
 const click=async element=>{assert.ok(element,'Expected control exists');await act(async()=>element.click());};
 click.resize=async width=>act(async()=>resize([{contentRect:{width}}]));return click;
}

test('unified diff preserves exact blank lines and tracks both line numbers',()=>{
 const before='Heading\n\nOriginal\nEnd\n',after='Heading\n\nReplacement\nInserted\nEnd\n';
 const rows=revisionDiffLines(before,after,7,11);
 assert.equal(rows.filter(row=>row.kind!=='added').map(row=>row.text).join('\n'),before);
 assert.equal(rows.filter(row=>row.kind!=='removed').map(row=>row.text).join('\n'),after);
 assert.deepEqual(rows.find(row=>row.kind==='removed'),{kind:'removed',text:'Original',oldLine:9,newLine:null});
 assert.deepEqual(rows.find(row=>row.text==='Inserted'),{kind:'added',text:'Inserted',oldLine:null,newLine:14});
 assert.deepEqual(rows.at(-1),{kind:'context',text:'',oldLine:11,newLine:16});
 assert.deepEqual(revisionDiffLines('','New'),[{kind:'added',text:'New',oldLine:null,newLine:1}]);
 assert.deepEqual(revisionDiffLines('Old',''),[{kind:'removed',text:'Old',oldLine:1,newLine:null}]);
});

test('large replacement diff retains all original and proposed lines',()=>{
 const before=Array.from({length:600},(_,i)=>`Original ${i}`).join('\n');
 const after=Array.from({length:600},(_,i)=>`Replacement ${i}`).join('\n');
 const rows=revisionDiffLines(before,after);
 assert.equal(rows.filter(row=>row.kind!=='added').map(row=>row.text).join('\n'),before);
 assert.equal(rows.filter(row=>row.kind!=='removed').map(row=>row.text).join('\n'),after);
 assert.equal(rows.length,1200);
});

test('filtering a footnote reference retains its complete atomic group in source order',()=>{
 const {patches}=fixture(),before=structuredClone(patches);
 const groups=buildRevisionDiffGroups([...patches].reverse(),[patches[1]]);
 assert.deepEqual(groups.map(group=>group.map(patch=>patch.id)),[['reference','note']]);
 assert.deepEqual(patches,before,'Rendering must not mutate saved patches');
 assert.deepEqual(buildRevisionDiffGroups(patches,[]),[]);
});

test('diff context applies nearby proposals once and counts only earlier changes in new line offsets',()=>{
 const patch=(text,original,replacement,id)=>{const start=text.indexOf(original);return {...fixture().patches[0],id,patchGroupId:undefined,original,replacement,range:{startOffset:start,endOffset:start+original.length,startLine:text.slice(0,start).split('\n').length,endLine:text.slice(0,start+original.length).split('\n').length}};};
 const nearbyText='first\nprior\ntarget\nlast',nearby=patch(nearbyText,'prior','prior\ninserted','nearby'),target=patch(nearbyText,'target','TARGET','target');
 const nearbyContext=buildRevisionDiffContext(nearbyText,target,[nearby,target]);
 assert.equal(nearbyContext.before,nearbyText);assert.equal(nearbyContext.after,'first\nprior\ninserted\nTARGET\nlast');
 assert.equal(nearbyContext.newLine,nearbyContext.line,'A newline within context changes rows rather than the context starting line');
 const distantText='first\none\ntwo\nthree\nfour\ntarget\nlast',earlier=patch(distantText,'first','first\ninserted','earlier'),later=patch(distantText,'target','TARGET','later');
 const distantContext=buildRevisionDiffContext(distantText,later,[earlier,later]);
 assert.equal(distantContext.before,'three\nfour\ntarget\nlast');assert.equal(distantContext.after,'three\nfour\nTARGET\nlast');
 assert.equal(distantContext.newLine,distantContext.line+1,'Earlier changes outside context shift revised starting lines');
});

test('context expands across a patch crossing its edge without truncating replacements',()=>{
 const text='one\ntwo\nthree\nfour\ntarget\nlast',base=fixture().patches[0];
 const spanning={...base,id:'spanning',original:'one\ntwo\nthree',replacement:'restored\nheading',range:{...base.range,startOffset:0,endOffset:'one\ntwo\nthree'.length}};
 const start=text.indexOf('target'),target={...base,id:'target',original:'target',replacement:'TARGET',range:{...base.range,startOffset:start,endOffset:start+'target'.length}};
 const context=buildRevisionDiffContext(text,target,[spanning,target]);
 assert.equal(context.before,text);assert.equal(context.after,'restored\nheading\nfour\nTARGET\nlast');
 assert.equal(context.line,1);assert.equal(context.newLine,1);
 assert.deepEqual(new Set(context.patchIds),new Set(['spanning','target']));
});

test('diff keeps each linked change in the right margin without visual groups and conceals notes initially',async t=>{
 const revision=fixture(),decisions=[];
 const click=await mount(t,{revision,patches:[revision.patches[1]],disabled:false,onDecision:async(patch,decision)=>decisions.push({patchId:patch.id,decision}),onEdit:()=>{}});
 const changes=[...document.querySelectorAll('.revision-diff-change')];assert.equal(changes.length,2);
 assert.deepEqual(changes.map(change=>change.dataset.patchId),['reference','note']);
 assert.equal(document.querySelector('.revision-diff-hunk'),null);
 assert.equal(document.querySelector('.revision-diff-hunk-header'),null);
 assert.doesNotMatch(document.querySelector('.source-revision-diff').textContent,/Linked group/);
 assert.ok(document.querySelector('.is-removed'));assert.ok(document.querySelector('.is-added'));
 assert.ok(document.querySelector('.revision-diff-text'));
 assert.equal(document.querySelector('.revision-diff-lines code'),null,'Source prose retains its text markup');
 for(const change of changes){
  assert.ok(change.closest('.revision-diff-margin'),'Each change control belongs to its source row margin');
  assert.ok(change.querySelector('.revision-diff-category'));assert.ok(change.querySelector('.revision-diff-state'));
  for(const label of ['Accept','Reject','Edit'])assert.ok([...change.querySelectorAll('button')].some(button=>button.textContent===label));
  const notes=change.querySelector('.revision-diff-notes');assert.equal(notes.open,false);
  assert.equal(notes.querySelector('summary').getAttribute('aria-label'),'Change notes');
 }
 const notes=changes[1].querySelector('.revision-diff-notes');
 assert.ok(notes.querySelector('.revision-diff-notes-body').textContent.includes('Explanation for note'));
 const buttons=[...changes[0].querySelectorAll('button')];
 await click(buttons.find(button=>button.textContent==='Accept'));
 await click(buttons.find(button=>button.textContent==='Reject'));
 assert.deepEqual(decisions,[{patchId:'reference',decision:'accepted'},{patchId:'reference',decision:'rejected'}]);
});

test('nearby changes share their prose context once while retaining individual margin decisions',async t=>{
 const revision=fixture(),click=await mount(t,{revision,disabled:false,onDecision:async()=>{}});
 await click([...document.querySelectorAll('button')].find(button=>button.textContent==='Source'));
 const texts=[...document.querySelectorAll('.revision-diff-text')].map(cell=>cell.textContent.replaceAll('\u200b',''));
 for(const text of ['Heading','A claim1.','A claim[^1].','1 An explanatory note.','[^1]: An explanatory note.','Another passage.','Another corrected passage.']){
  assert.equal(texts.filter(value=>value===text).length,1,`The diff presents ${JSON.stringify(text)} once`);
 }
 assert.deepEqual([...document.querySelectorAll('.revision-diff-change')].map(change=>change.dataset.patchId),['reference','note','wording']);
});

test('decided changes remain inspectable and reversible',async t=>{
 const revision=fixture();revision.patches[0].decision=revision.patches[1].decision='accepted';revision.patches[2].decision='rejected';
 const decisions=[];const click=await mount(t,{revision,disabled:false,onDecision:async(patch,decision)=>decisions.push({patchId:patch.id,decision})});
 const accepted=document.querySelector('[data-decision="accepted"]'),rejected=document.querySelector('[data-decision="rejected"]');
 const compact=accepted.querySelector('.revision-diff-accepted');
 assert.equal(compact.open,false);assert.equal(compact.querySelector('summary').getAttribute('aria-label'),'Accepted');
 await click(compact.querySelector('summary'));assert.equal(compact.open,true);
 assert.equal([...accepted.querySelectorAll('button')].find(button=>button.textContent==='Accept').disabled,true);
 assert.equal([...rejected.querySelectorAll('button')].find(button=>button.textContent==='Reject').disabled,true);
 await click([...accepted.querySelectorAll('button')].find(button=>button.textContent==='Reject'));
 await click([...rejected.querySelectorAll('button')].find(button=>button.textContent==='Return to review'));
 assert.deepEqual(decisions,[{patchId:'reference',decision:'rejected'},{patchId:'wording',decision:'pending'}]);
});

test('active processing disables diff mutation controls',async t=>{
 await mount(t,{revision:fixture(),disabled:true,onDecision:async()=>assert.fail('Cannot mutate an active revision'),onEdit:()=>assert.fail('Cannot edit an active revision')});
 const controls=[...document.querySelectorAll('.revision-diff-change button')];assert.ok(controls.length>0);
 assert.ok(controls.every(button=>button.disabled));
});

test('split rows retain exact source order and align unequal insertions and deletions',()=>{
 const rows=revisionDiffLines('Same\nOld A\nOld B\nEnd','Same\nNew A\nNew B\nNew C\nEnd');
 const split=revisionSplitRows(rows);
 assert.deepEqual(split.map(row=>row.left?.text??null),['Same','Old A','Old B',null,'End']);
 assert.deepEqual(split.map(row=>row.right?.text??null),['Same','New A','New B','New C','End']);
 assert.equal(split[1].left.oldLine,2);assert.equal(split[3].right.newLine,4);
});

test('side-by-side toggle follows available width and preserves individual margin controls',async t=>{
 const revision=fixture(),click=await mount(t,{revision,disabled:false,onDecision:async()=>{}},{width:1000});
 const button=text=>[...document.querySelectorAll('button')].find(button=>button.textContent===text);
 await click(button('Side by side'));assert.ok(document.querySelector('.source-revision-diff.is-split'));
 assert.ok(document.querySelector('.revision-diff-side.is-removed'));assert.ok(document.querySelector('.revision-diff-side.is-added'));
 assert.equal(document.querySelectorAll('.revision-diff-change').length,3);
 for(const change of document.querySelectorAll('.revision-diff-change'))assert.ok(change.closest('.revision-diff-margin'));
 await click.resize(600);assert.equal(button('Side by side').disabled,true);assert.equal(document.querySelector('.is-split'),null);assert.equal(button('Unified').getAttribute('aria-pressed'),'true');
 await click.resize(1000);assert.ok(document.querySelector('.source-revision-diff.is-split'));
 await click(button('Unified'));assert.equal(document.querySelector('.is-split'),null);
});

test('rendered view formats body text and footnotes in either layout and source view retains raw markup',async t=>{
 const revision=fixture();revision.patches[0].replacement='**claim**[^1]';
 const click=await mount(t,{revision,disabled:false,onDecision:async()=>{}},{width:1000});
 const button=text=>[...document.querySelectorAll('button')].find(button=>button.textContent===text);
 assert.equal(button('Rendered').getAttribute('aria-pressed'),'true','Rendered is the initial display');assert.ok(document.querySelector('.source-revision-diff.is-rendered'));
 assert.equal(document.querySelector('.revision-diff-text strong').textContent,'claim');
 const reference=document.querySelector('.source-reader-footnote-reference a');assert.ok(reference);assert.ok(document.getElementById(reference.getAttribute('href').slice(1)));
 await click(button('Side by side'));assert.ok(document.querySelector('.is-split.is-rendered'));assert.ok(document.querySelector('.revision-diff-side.is-added strong'));
 await click(button('Source'));assert.equal(document.querySelector('.is-rendered'),null);assert.match(document.querySelector('.revision-diff-lines').textContent,/\*\*claim\*\*\[\^1\]/);
});
