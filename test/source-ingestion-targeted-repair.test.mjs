import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceIngestionTargetedRepairPrompt,validateSourceIngestionTargetedRepairs,SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA} from '../src/server/modules/source-ingestion-targeted-repair.ts';
const block=(id,page,text)=>({id,page,text,order:0,kind:'paragraph',headingLevel:null,continues:null,table:null,uncertainty:'Unclear ligature',location:null});
const doc=()=>({schemaVersion:1,metadata:{title:null,language:null,synopsis:null,contributors:[],bibliographic:[]},pages:[{number:1,printedLabel:null,role:'owned',state:'content',unresolved:[]}],blocks:[block('b',1,'The ofﬁce 😀.')],relations:[],repairs:[]});
const repair=()=>({blockId:'b',start:4,end:9,original:'ofﬁce',replacement:'office',category:'typography',reason:'Visible ligature'});
test('targeted schema accepts no baseline transcription or proof fields',()=>{assert.deepEqual(Object.keys(SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA.properties),['repairs']);assert.equal(SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA.additionalProperties,false);assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[],text:'new baseline'},doc()),/only repairs/);});
test('targeted repair remains an exact sparse candidate with no automatic verification',()=>{assert.deepEqual(validateSourceIngestionTargetedRepairs({repairs:[repair()]},doc()),[repair()]);assert.deepEqual(validateSourceIngestionTargetedRepairs({repairs:[]},doc()),[]);assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[{...repair(),original:'invented'}]},doc()),/exact UTF-16/);});
test('targeted repair cannot overlap candidates or fabricate confidence/native proof',()=>{const d=doc();d.repairs=[repair()];assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[repair()]},d),/overlaps/);assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[{...repair(),proof:'AppleVision'}]},doc()),/unexpected field/);});
test('Light and clean Balanced avoid an obligatory extra model request',()=>{assert.throws(()=>sourceIngestionTargetedRepairPrompt(doc(),{ownedPages:[1],depth:'light'}),/Light/);const clean=doc();clean.blocks[0].uncertainty=null;assert.throws(()=>sourceIngestionTargetedRepairPrompt(clean,{ownedPages:[1],depth:'balanced'}),/No localized/);});
test('selective prompt is bounded and includes only owned finding snippets',()=>{const d=doc();d.blocks[0].text='x'.repeat(100_000);d.blocks.push({...block('other',2,'Private other page'),uncertainty:null});const prompt=sourceIngestionTargetedRepairPrompt(d,{ownedPages:[1],contextPages:[2],pageMap:[1,2],depth:'balanced'});assert.ok(prompt.length<10_000);assert.equal(prompt.includes('Private other page'),false);assert.ok(prompt.includes('snippetEnd'));assert.ok(prompt.includes('untrusted data'));});
test('Deep can selectively inspect a difficult structured block without uncertainty claim',()=>{const d=doc();d.blocks[0].kind='equation';d.blocks[0].uncertainty=null;assert.ok(sourceIngestionTargetedRepairPrompt(d,{ownedPages:[1],depth:'deep'}).includes('equation'));});

test('targeted suggestions outside submitted snippets or owned pages are rejected',()=>{const d=doc();d.blocks[0].text='x'.repeat(5000);assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[{...repair(),start:4500,end:4501,original:'x'}]},d,{ownedPages:[1],depth:'balanced'}),/outside supplied/);assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[repair()]},doc(),{ownedPages:[2],depth:'balanced'}),/outside supplied/);});

const quoted=overrides=>({blockId:'b',original:'ofﬁce',prefix:'The ',suffix:' 😀.',replacement:'office',category:'ocr',reason:'The printed letters differ from the transcription.',...overrides});
test('fresh wire protocol requests quotations and adjacent anchors, never model offsets',()=>{
 const item=SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA.properties.repairs.items;
 assert.deepEqual(item.required,['blockId','original','prefix','suffix','replacement','category','reason']);
 assert.equal(item.properties.start,undefined);assert.equal(item.properties.end,undefined);
 assert.ok(item.properties.category.enum.includes('math'));assert.equal(item.properties.category.enum.includes('source-error'),false);
 const prompt=sourceIngestionTargetedRepairPrompt(doc(),{ownedPages:[1],depth:'balanced'});
 assert.match(prompt,/Do not calculate character offsets/);assert.match(prompt,/editorial mathematical correction is not a transcription repair/);
});
test('anchored quotes resolve decoded UTF-16 offsets after emoji, JSON escapes and combining marks',()=>{
 const d=doc();d.blocks[0].text='😀 e\u0301 $\\bar{H}$ then H.';
 const c=quoted({original:'$\\bar{H}$',prefix:'😀 e\u0301 ',suffix:' then H.',replacement:'$\\widehat{H}$',category:'math'});
 const decoded=JSON.parse(JSON.stringify({repairs:[c]}));
 const [r]=validateSourceIngestionTargetedRepairs(decoded,d,{ownedPages:[1],depth:'balanced'});
 assert.equal(r.start,6);assert.equal(r.end,15);assert.equal(d.blocks[0].text.slice(r.start,r.end),r.original);
 assert.equal('prefix' in r,false);assert.equal('suffix' in r,false);
});
test('repeated quotes need exact adjacent context that identifies a unique occurrence',()=>{
 const d=doc();d.blocks[0].text='H then H then H.';
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'H',prefix:'',suffix:'',replacement:'$H$'})]},d),/unique exact/);
 const [r]=validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'H',prefix:'H then ',suffix:' then H.',replacement:'$H$'})]},d);
 assert.equal(r.start,7);assert.equal(r.end,8);
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'H',prefix:'wrong ',suffix:'',replacement:'$H$'})]},d),/unique exact/);
});
test('anchors cannot select repeated text solely because the other occurrence was truncated',()=>{
 const d=doc();d.blocks[0].text='H then '+ 'x'.repeat(4100)+' H then ';
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'H',prefix:'',suffix:' then ',replacement:'$H$'})]},d),/unique exact/);
});
test('quotes and their anchors must fit the submitted scope, including truncated block ends',()=>{
 const d=doc();d.blocks[0].text='x'.repeat(3999)+'H tail';
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'H',prefix:'x',suffix:' tail',replacement:'$H$'})]},d),/outside supplied/);
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted()]},doc(),{ownedPages:[2],depth:'balanced'}),/outside supplied/);
 const long=doc();long.blocks[0].text='x'.repeat(3999)+'😀H';
 const prompt=sourceIngestionTargetedRepairPrompt(long,{ownedPages:[1],depth:'balanced'});
 const scope=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
 assert.equal(scope.evidence[0].snippetEnd,3999);assert.equal(scope.evidence[0].truncated,true);
 assert.equal(scope.evidence[0].text.endsWith('\ud83d'),false);
});
test('malformed Unicode, oversized anchors, mixed offset/anchor fields and unsupported categories fail closed',()=>{
 for(const c of [quoted({prefix:'x'.repeat(121)}),quoted({replacement:'\ud83d'}),quoted({original:'\ude00',prefix:'',suffix:''}),quoted({category:'source-error'})])assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[c]},doc()));
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[{...quoted(),start:4,end:9}]},doc()),/unexpected field/);
 const d=doc();d.repairs=[repair()];assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted()]},d),/overlaps/);
});
test('anchor matching does not normalize decomposed source Unicode',()=>{
 const d=doc();d.blocks[0].text='e\u0301';
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'é',prefix:'',suffix:'',replacement:'e'})]},d),/unique exact/);
});
test('overlapping combined quote and anchors remain ambiguous',()=>{
 const d=doc();d.blocks[0].text='aaaa';
 assert.throws(()=>validateSourceIngestionTargetedRepairs({repairs:[quoted({original:'a',prefix:'a',suffix:'a',replacement:'b'})]},d),/unique exact/);
});
test('visual panel instructions preserve the final-line scope JSON and do not claim fallback crops',()=>{
 const visualEvidence={version:1,algorithm:'pdfjs-context-crop-v1',pageMap:[1],ownedPages:[1],crops:[{physicalPage:1,blockId:'b',rect:{x:.1,y:.2,width:.3,height:.1},accuracy:'approximate'}],fallback:'none'};
 const prompt=sourceIngestionTargetedRepairPrompt(doc(),{ownedPages:[1],depth:'balanced',visualEvidence});
 assert.match(prompt,/full source-page context on the left/);assert.match(prompt,/not additional source content/);
 assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)).visualEvidence,visualEvidence);
 const fallback=sourceIngestionTargetedRepairPrompt(doc(),{ownedPages:[1],depth:'balanced',visualEvidence:{...visualEvidence,crops:[],fallback:'render-unavailable'}});
 assert.equal(fallback.includes('full source-page context on the left'),false);assert.equal(JSON.parse(fallback.slice(fallback.lastIndexOf('\n')+1)).visualEvidence.fallback,'render-unavailable');
});
