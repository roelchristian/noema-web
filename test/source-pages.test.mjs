import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SourcePageDraft} from '../src/server/modules/source-pages.ts';

const source='A group has an identity.\nEvery element has an inverse.\nThe operation is associative.\n';
const block=(citations,extra={})=>({type:'block',blockType:'paragraph',basis:'source',text:'The source describes group axioms.',citations,...extra});
function draftFor(records) {
 const events=[],draft=new SourcePageDraft(event=>events.push(event),source);
 for(const record of [{type:'title',title:'Group axioms'},...records])draft.feed(JSON.stringify(record)+'\n');
 draft.finish();
 return {draft,events,text:draft.blocks.map(block=>block.content.map(span=>span.text).join('')).join('\n')};
}
test('source references use single-line and range markers, with whitespace-normalized quotes',()=>{
 const {text}=draftFor([block([{startLine:1,endLine:1,quote:'A group has an identity.'},{startLine:2,endLine:3,quote:'inverse.\nThe operation'}])]);
 assert.match(text,/\[L: 1\]/);assert.match(text,/\[L: 2-3\]/);assert.ok(!text.includes('[??]'));
});
test('an unmatched quote stays in the streamed draft with an uncertainty marker, without a false line reference',()=>{
 const {text,events}=draftFor([block([{startLine:1,endLine:1,quote:'Every group is cyclic.'}])]);
 assert.match(text,/“Every group is cyclic\.”/);assert.match(text,/\[\?\?\]/);assert.ok(!text.includes('[L:'));
 assert.equal(events.filter(event=>event.type==='block').length,1);
});
test('missing, malformed, empty and out-of-range citations are marked rather than aborting generation',()=>{
 for(const citations of [undefined,[],{},[null],[{startLine:0,endLine:1}],[{startLine:3,endLine:2}],[{startLine:1,endLine:99}],[{startLine:4,endLine:4}]]) {
  const {text}=draftFor([block(citations)]);
  assert.match(text,/\[\?\?\]/);assert.ok(!text.includes('[L:'));
 }
});
test('mixed citations keep valid references and flag the uncertain evidence',()=>{
 const {text}=draftFor([block([{startLine:1,endLine:1},{startLine:99,endLine:99}])]);
 assert.match(text,/\[L: 1\]/);assert.match(text,/\[\?\?\]/);
});
test('each uncertainty marker stays with its disputed quote before other citations',()=>{
 const {text}=draftFor([block([{startLine:1,endLine:1,quote:'Every group is cyclic.'},{startLine:2,endLine:2,quote:'Every element has an inverse.'}])]);
 assert.match(text,/“Every group is cyclic\.” \[\?\?\] “Every element has an inverse\.” \[L: 2\]$/);
});
test('citation anchors place markers directly after the relevant claim',()=>{
 const {text}=draftFor([block([{startLine:1,endLine:1,anchor:'identity'},{startLine:99,endLine:99,anchor:'cyclic'}],{text:'Groups have an identity but are not necessarily cyclic. Other discussion follows.'})]);
 assert.equal(text,'Groups have an identity [L: 1] but are not necessarily cyclic [??]. Other discussion follows.');
});
test('quotes already present in the text are marked inline without duplication',()=>{
 const {text}=draftFor([block([{startLine:1,endLine:1,quote:'Every group is cyclic.'}],{text:'It claims Every group is cyclic. More discussion follows.'})]);
 assert.equal(text,'It claims Every group is cyclic. [??] More discussion follows.');
});
test('ambiguous or absent anchors fall back to the citation position',()=>{
 for(const anchor of ['Groups','Not present']) {
  const {text}=draftFor([block([{startLine:99,endLine:99,anchor}],{text:'Groups have identities. Groups have inverses.'})]);
  assert.equal(text,'Groups have identities. Groups have inverses. [??]');
 }
});
test('standalone quote blocks get line markers only when the text matches',()=>{
 const matched=draftFor([block([{startLine:1,endLine:1}],{blockType:'quote',text:'A group has an identity.'})]);
 assert.match(matched.text,/\[L: 1\]/);assert.ok(!matched.text.includes('[??]'));
 const unmatched=draftFor([block([{startLine:1,endLine:1}],{blockType:'quote',text:'Every group is cyclic.'})]);
 assert.match(unmatched.text,/\[\?\?\]/);assert.ok(!unmatched.text.includes('[L:'));
});
test('math remains literal and review markers are emitted in a separate paragraph',()=>{
 const {draft}=draftFor([block([{startLine:99,endLine:99}],{blockType:'math',text:'x^3=1'})]);
 assert.equal(draft.blocks[0].content[0].text,'x^3=1');
 assert.equal(draft.blocks[1].type,'paragraph');assert.equal(draft.blocks[1].content[0].text,' [??]');
});
test('invalid record structure and drafts without source exposition still fail',()=>{
 assert.throws(()=>draftFor([block([],{blockType:'invented'})]),/invalid page block/);
 assert.throws(()=>draftFor([block([],{basis:'context'})]),/source evidence/);
});
test('a stray section sign after a complete streamed draft does not discard the draft',()=>{
 const events=[],draft=new SourcePageDraft(event=>events.push(event),source);
 const output=[JSON.stringify({type:'title',title:'Group axioms'}),JSON.stringify(block([{startLine:1,endLine:1}])),'§ ',''].join('\n');
 // Replay character-by-character to exercise provider chunk boundaries too.
 for(const character of output)draft.feed(character);
 draft.finish();
 assert.equal(draft.title,'Group axioms');assert.equal(draft.blocks.length,2);
 assert.match(draft.blocks[0].content.map(span=>span.text).join(''),/\[L: 1\]/);
 assert.match(draft.blocks[1].content[0].text,/\[\?\?\].*left out/);
 assert.deepEqual(events.filter(event=>event.type==='block').map(event=>event.block),draft.blocks);
});
test('unreadable records between valid blocks are flagged without losing later blocks',()=>{
 const draft=new SourcePageDraft(()=>{},source);
 draft.feed(JSON.stringify({type:'title',title:'Group axioms'})+'\n');
 draft.feed(JSON.stringify(block([{startLine:1,endLine:1}]))+'\n');
 draft.feed('{"type":"block","text":broken}\n');
 draft.feed(JSON.stringify(block([{startLine:2,endLine:2}],{text:'Every element has an inverse.'})));
 draft.finish();
 assert.equal(draft.blocks.length,3);assert.equal(draft.blocks[1].content[0].text,'Every element has an inverse.');
 assert.match(draft.blocks[2].content[0].text,/\[\?\?\]/);
});
test('unreadable output alone cannot become a reviewable draft',()=>{
 const draft=new SourcePageDraft(()=>{},source);
 draft.feed(JSON.stringify({type:'title',title:'Group axioms'})+'\n§\n{"type":');
 assert.throws(()=>draft.finish(),/complete page/);assert.equal(draft.blocks.length,0);
});


test('explicit output language rejects mismatched or missing language before streaming a title',()=>{
 for(const language of ['es',undefined]) {
  const events=[],draft=new SourcePageDraft(event=>events.push(event),'Una biografía española.',undefined,'English');
  assert.throws(()=>draft.feed(JSON.stringify({type:'title',title:'Una biografía',language})+'\n'),/selected output language/);
  assert.deepEqual(events,[]);
 }
 const events=[],draft=new SourcePageDraft(event=>events.push(event),'Una biografía española.',undefined,'English');
 draft.feed(JSON.stringify({type:'title',title:'A biography',language:'en-US'})+'\n');
 assert.equal(events[0].title,'A biography');
 const matching=new SourcePageDraft(()=>{},'Una biografía española.');
 assert.doesNotThrow(()=>matching.feed(JSON.stringify({type:'title',title:'Una biografía',language:'es'})+'\n'));
});
