import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findSurfaces,searchSurfaces,replaceMatches} from '../src/client/editor/document-find.ts';
const block=(id,content)=>({id,type:'paragraph',checked:false,content});
const options=(query,more={})=>({query,regex:false,caseSensitive:false,wholeWord:false,replacement:'X',...more});
const search=(blocks,q,more={},entities=[])=>{const surfaces=findSurfaces(blocks,entities);return {surfaces,...searchSurfaces(surfaces,options(q,more))};};
test('literal, case, Unicode word boundaries, regex invalid and zero-width',()=>{
 const blocks=[block('b',[{text:'café Café caféine A.b Aab 😀'}])];
 assert.equal(search(blocks,'café').matches.length,3);
 assert.equal(search(blocks,'café',{wholeWord:true}).matches.length,2);
 assert.equal(search(blocks,'Café',{caseSensitive:true}).matches.length,1);
 assert.equal(search(blocks,'A.b').matches.length,1);
 assert.equal(search(blocks,'A.b',{regex:true}).matches.length,2);
 assert.equal(search(blocks,'😀').matches.length,1);
 assert.match(search(blocks,'[',{regex:true}).error,/Invalid/);
 const zero=search(blocks,'(?:)',{regex:true});assert.equal(zero.matches.length,0);assert.equal(zero.zeroWidth,true);
});
test('repeated replacements across styled runs preserve suffix styles and do not mutate cached surfaces',()=>{
 const blocks=[block('b',[{text:'ab',bold:true},{text:'c abc ',italic:true},{text:'abc',underline:true}])];
 const {surfaces,matches}=search(blocks,'abc');const before=JSON.stringify(surfaces);
 const result=replaceMatches(blocks,surfaces,matches);
 assert.equal(result.replaced,3);assert.equal(result.blocks[0].content.map(s=>s.text).join(''),'X X X');
 assert.equal(result.blocks[0].content[0].bold,true);assert.equal(result.blocks[0].content.at(-1).underline,true);
 assert.equal(JSON.stringify(surfaces),before);assert.equal(blocks[0].content[0].text,'ab');
});
test('table cell addresses, unsaved content, source/identity/math protected; plain link labels preserve URL',()=>{
 const entity={id:'e',name:'Canonical',aliases:['Alias'],type:'person'};
 const untouched=block('other',[{text:'unchanged'}]);
 const blocks=[block('b',[{entityId:'e',mentionText:'Alias'},{text:' target ',href:'https://example.com'},{text:'target',math:true},{text:'target',sourceReference:{id:'ref'}}]),{id:'table',type:'table',checked:false,content:[],rows:[[[{text:'target'}],[{text:'target'}]]]},untouched];
 const {surfaces,matches}=search(blocks,'target',{},[entity]);assert.equal(matches.length,5);assert.equal(matches.filter(m=>m.protected).length,2);
 const r=replaceMatches(blocks,surfaces,matches);assert.equal(r.replaced,3);assert.equal(r.skipped,2);assert.equal(r.blocks[0].content[0].entityId,'e');assert.ok(r.blocks[0].content.some(s=>s.href==='https://example.com'&&s.text==='X'));
 assert.equal(r.blocks[1].rows[0][1][0].text,'X');assert.equal(r.blocks[2],untouched);
 assert.equal(surfaces[0].spans[0].entityId,'e');assert.equal(search(blocks,'Alias',{},[entity]).matches[0].protected,true);
});
test('mixed links skipped, captures explicit, and cap never becomes silent Replace all',()=>{
 const blocks=[block('b',[{text:'abc',href:'https://example.com'},{text:'abc'}])];
 const r=search(blocks,'ca');assert.equal(r.matches[0].protected,true);assert.equal(replaceMatches(blocks,r.surfaces,r.matches).skipped,1);
 const c=search([block('c',[{text:'cat-42'}])],'(?<word>cat)-(\\d+)',{regex:true,replacement:'$2 $<word> $$ $& $99'});
 assert.equal(c.matches[0].replacement,'42 cat $ cat-42 $99');
 const capped=search([block('long',[{text:'a'.repeat(3000)}])],'a');assert.equal(capped.matches.length,2000);assert.equal(capped.truncated,true);
});
test('surface cache isolates unchanged blocks and entity name updates invalidate projection',()=>{
 const a=block('a',[{text:'abc'}]),b=block('b',[{entityId:'e'}]);const entities=[{id:'e',name:'First'}];
 const first=findSurfaces([a,b],entities);const second=findSurfaces([a,block('c',[{text:'new'}])],entities);assert.equal(first[0],second[0]);
 assert.equal(findSurfaces([b],[{id:'e',name:'Renamed'}])[0].text,'Renamed');
});
test('protected atoms with empty display, wiki links, and identity labels do not corrupt adjacent replacements',()=>{
 const blocks=[block('b',[{text:'abc '},{entityId:'e'},{text:' abc [[Other|visible]] abc'}])];
 const entities=[{id:'e',name:'Entity',mentionCase:'lowercase'}];const r=search(blocks,'abc',{},entities);
 assert.equal(r.surfaces[0].text,'abc entity abc [[Other|visible]] abc');
 const plan=replaceMatches(blocks,r.surfaces,r.matches);assert.equal(plan.replaced,3);assert.equal(plan.blocks[0].content.find(s=>s.entityId)?.entityId,'e');
 assert.equal(plan.blocks[0].content.map(s=>s.text??s.entityId).join(''),'X e X [[Other|visible]] X');
 const wiki=search(blocks,'visible',{},entities);assert.equal(wiki.matches[0].protected,true);
 const empty=[block('z',[{text:'ab'},{text:'',sourceReference:{id:'c'}},{text:'cd'}])];
 assert.equal(search(empty,'bc').matches[0].protected,true);
 const freeze=search(blocks,'Entity',{},entities);assert.equal(replaceMatches(blocks,freeze.surfaces,freeze.matches).blocks[0],blocks[0]);
});
test('stale segment addresses are rejected and identical replacement preserves styling',()=>{
 const blocks=[block('a',[{text:'ab',bold:true},{text:'c',italic:true}])];const r=search(blocks,'abc',{replacement:'abc'});
 assert.equal(replaceMatches(blocks,r.surfaces,r.matches).blocks[0],blocks[0]);
 const edited=[block('a',[{text:'new unsaved text'}])];const plan=replaceMatches(edited,r.surfaces,r.matches);assert.equal(plan.replaced,0);assert.equal(plan.skipped,1);assert.equal(plan.blocks[0],edited[0]);
});
