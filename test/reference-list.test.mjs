import test from 'node:test';
import assert from 'node:assert/strict';
import {extractReferenceList,referenceMatches,referenceProposalBibtex} from '../src/shared/reference-list.ts';
import {parseBibliography} from '../src/shared/bibliography.ts';
test('reference extraction requires a heading, preserves lines, joins numbered continuations and stops at appendix',()=>{
 assert.deepEqual(extractReferenceList('Jones (2020). Example. 10.1000/example'),[]);
 const text='Introduction\nReferences\n[1] Doe (2020). Example.\n  https://doi.org/10.1000/example\n\n[2] Roe (2021). Other.\nAppendix A\nPrivate content';
 const refs=extractReferenceList(text);assert.equal(refs.length,2);assert.equal(refs[0].startLine,3);assert.equal(refs[0].endLine,4);assert.equal(refs[0].doi,'10.1000/example');assert.doesNotMatch(refs[1].raw,/Private/);
 assert.deepEqual(referenceMatches(refs[0],[{sourceId:'x',fields:{doi:'https://doi.org/10.1000/EXAMPLE'}}]).map(record=>record.sourceId),['x']);
 const raw=referenceProposalBibtex(refs[0],'ref-123','Verified title');const parsed=parseBibliography(raw);assert.equal(parsed.entries[0].fields.title,'Verified title');assert.match(parsed.entries[0].fields.note,/Unverified extracted reference/);assert.throws(()=>referenceProposalBibtex(refs[0],'ref-123',''),/verified title/);
});
test('unnumbered references stay conservative and repeated extraction is deterministic',()=>{
 const text='Works Cited\nDoe, Jane. (2020). First.\n  Test Press.\n\nRoe, John. (2021). Second.';
 assert.deepEqual(extractReferenceList(text),extractReferenceList(text));assert.equal(extractReferenceList(text).length,2);
});

test('reference review ignores stale extraction on Source switches and resets reviewed proposals',async t=>{
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {setupDOM}=await import('./helpers/dom.mjs');const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const {BibliographyReferences}=await import('../src/client/knowledge/BibliographyReferences.tsx');let complete;
 t.mock.method(globalThis,'fetch',async()=>new Promise(resolve=>{complete=resolve;}));
 const entity=id=>({id,type:'source',vault_id:'vault',relationships:[],attachments:[{id:'file-'+id,status:'ready',text:'References\n[1] Doe (2020). Synthetic reference.'}]});
 const render=id=>act(async()=>root.render(createElement(BibliographyReferences,{vaultId:'vault',entity:entity(id),onUpdated:async()=>{}})));
 const click=text=>act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent===text).click());
 await render('a');await click('Review document reference list');const first=complete;await render('b');await act(async()=>first(Response.json([])));assert.equal(document.querySelector('blockquote'),null);
 await click('Review document reference list');await act(async()=>complete(Response.json([])));await click('Review missing Source');assert.ok(document.querySelector('[aria-label="Verified reference title"]'));
 await render('c');assert.equal(document.querySelector('[aria-label="Verified reference title"]'),null);assert.equal(document.querySelector('blockquote'),null);
});
