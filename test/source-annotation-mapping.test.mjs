import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSourceAnnotationMapper,mapSourceAnnotationRange} from '../src/shared/source-annotation-mapping.ts';

const range=(text,quote)=>({startOffset:text.indexOf(quote),endOffset:text.indexOf(quote)+quote.length});
const patch=(text,quote,replacement,decision='accepted')=>({range:range(text,quote),original:quote,replacement,decision});

test('annotations shift through page breaks and earlier accepted changes',()=>{
 const original='Heading\n\nThe quoted passage continues\nonto another page.\nTail';
 const patches=[patch(original,'Heading','A longer heading'),patch(original,'continues\nonto','continues\n\n\f\nonto')];
 const revised='A longer heading\n\nThe quoted passage continues\n\n\f\nonto another page.\nTail';
 const selected=range(original,'quoted passage continues\nonto another page.');
 const projected=mapSourceAnnotationRange(selected,original,revised,patches);
 assert.deepEqual(projected,range(revised,'quoted passage continues\n\n\f\nonto another page.'));
 assert.deepEqual(createSourceAnnotationMapper(original,revised,patches,true)(projected),selected);
});

test('notes retain precise word positions within paragraph patches with multiple OCR fixes',()=>{
 const original='The qu0ted passage is here and the w0rd remains.';
 const revised='The quoted passage is here and the word remains.';
 const patches=[patch(original,original,revised)];
 const mapper=createSourceAnnotationMapper(original,revised,patches);
 assert.deepEqual(mapper(range(original,'qu0ted passage')),range(revised,'quoted passage'));
 assert.deepEqual(mapper(range(original,'is here')),range(revised,'is here'));
 assert.deepEqual(mapper(range(original,'w0rd')),range(revised,'word'));
});

test('selection boundaries exclude adjacent insertions but include inserted text inside a passage',()=>{
 const original='alpha beta gamma',revised='alpha NEW beta gamma END';
 const patches=[{range:{startOffset:6,endOffset:6},original:'',replacement:'NEW ',decision:'accepted'},{range:{startOffset:16,endOffset:16},original:'',replacement:' END',decision:'accepted'}];
 const mapper=createSourceAnnotationMapper(original,revised,patches);
 assert.deepEqual(mapper(range(original,'beta gamma')),range(revised,'beta gamma'));
 assert.deepEqual(mapper(range(original,'alpha beta')),range(revised,'alpha NEW beta'));
 assert.deepEqual(createSourceAnnotationMapper(original,revised,patches,true)(range(revised,'NEW ')),null,'A revision-only insertion has no canonical text');
});

test('deleted passages remain unresolved instead of moving to neighbouring text',()=>{
 const original='alpha removed omega',revised='alpha  omega';
 const mapper=createSourceAnnotationMapper(original,revised,[patch(original,'removed','')]);
 assert.equal(mapper(range(original,'removed')),null);
 assert.deepEqual(mapper(range(original,'removed omega')),range(revised,' omega'));
});

test('fallback identifies a unique passage despite whitespace, page breaks and OCR dehyphenation',()=>{
 const original='Before\nAn inter-\nnational passage.\nAfter';
 const revised='New introduction\nBefore\nAn international\n\f\npassage.\nAfter';
 const projected=mapSourceAnnotationRange(range(original,'An inter-\nnational passage.'),original,revised);
 assert.deepEqual(projected,range(revised,'An international\n\f\npassage.'));
});

test('fallback rejects ambiguous repeated passages and resolves a uniquely contextual occurrence',()=>{
 const original='First repeated phrase after.\nSecond repeated phrase end.';
 const revised='Introduction\n'+original;
 const selected={startOffset:original.lastIndexOf('repeated phrase'),endOffset:original.lastIndexOf('repeated phrase')+15};
 assert.deepEqual(mapSourceAnnotationRange(selected,original,revised),{startOffset:selected.startOffset+13,endOffset:selected.endOffset+13});
 assert.equal(mapSourceAnnotationRange({startOffset:0,endOffset:6},'repeat','repeat and repeat'),null);
});

test('unverified, overlapping and pending patches cannot manufacture annotation positions',()=>{
 const original='Original passage',revised='Different passage';
 assert.equal(mapSourceAnnotationRange(range(original,'Original'),original,revised,[patch(original,'Original','Invented')]),null);
 assert.equal(mapSourceAnnotationRange(range(original,'Original'),original,revised,[patch(original,'Original','Different','pending')]),null);
 const accepted=patch(original,'Original','Different');
 assert.equal(mapSourceAnnotationRange(range(original,'Original'),original,revised,[accepted,accepted]),null);
});

test('UTF-16 coordinates, user replacements, and invalid ranges are handled consistently',()=>{
 const original='😀 A bad word',revised='😀 A corrected word',change={...patch(original,'bad','proposed'),userReplacement:'corrected'};
 assert.deepEqual(mapSourceAnnotationRange(range(original,'bad'),original,revised,[change]),range(revised,'corrected'));
 assert.deepEqual(mapSourceAnnotationRange(range(original,'😀'),original,revised,[change]),range(revised,'😀'));
 for(const selected of [{startOffset:-1,endOffset:2},{startOffset:0,endOffset:999},{startOffset:2,endOffset:2},{startOffset:0.1,endOffset:2}])assert.equal(mapSourceAnnotationRange(selected,original,revised,[change]),null);
});
