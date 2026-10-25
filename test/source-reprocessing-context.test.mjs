import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingChunks} from '../src/server/modules/source-reprocessing-planner.ts';
import {createSynthesisInput,parseDocumentSynthesis,assertFrozenSynthesis,selectVerificationContext,planContextSections,auditDocumentConsistency,parseReconstructionUncertainty} from '../src/server/modules/source-reprocessing-context.ts';
import {createSynthesisReviewInput,resolveReviewedSynthesis} from '../src/server/modules/source-reprocessing-synthesis-review.ts';
const document={physical:{pages:[]}};
const fixture=(text='Chapter I\nAmbiguous nomen.\n\nChapter II\nA nomen is a name.😀')=>{
 const chunks=planReprocessingChunks(text,document,100);
 const firstPasses=chunks.map(chunk=>({chunkIndex:chunk.index,requestHash:`request-${chunk.index}`,result:JSON.stringify({blocks:chunk.blocks.map(({id,text})=>({id,text})),diagnostics:[],unresolved:false})}));
 return {text,chunks,firstPasses,input:createSynthesisInput({revisionId:'revision',baseHash:'base',text,chunks,firstPasses,title:'Scholarly fixture'})};
};
const observation=(block)=>({kind:'uncertainty',reading:'The reading nomen is uncertain.',alternatives:['nomen','nomcn'],evidence:[{blockId:block.id,quote:'nomen'}],resolutionNeed:'Inspect the original page.'});
test('summary evidence review separates a proposed extraction repair from exact canonical quotations',()=>{
 const {input,chunks,text}=fixture('A discussion of Austronesian lan- guages and nomen.');
 const block=input.blocks[0],valid=observation(block),mismatch={...valid,reading:'A discussion of Austronesian languages.',evidence:[{blockId:block.id,quote:'Austronesian languages'}]};
 const original=JSON.stringify({observations:[valid,mismatch]});
 assert.throws(()=>parseDocumentSynthesis(input,original),/quote its canonical block exactly/);
 const pending=createSynthesisReviewInput(input,original);assert.equal(pending.baseline.observations.length,1);assert.equal(pending.baseline.rejectedObservations[0].index,1);
 assert.ok(pending.request.includes('lan- guages'));assert.deepEqual(pending.baseline.observations[0].evidence,parseDocumentSynthesis(input,JSON.stringify({observations:[valid]})).observations[0].evidence);
 const corrected={...mismatch,evidence:[{blockId:block.id,quote:'Austronesian lan- guages'}]};
 const review=JSON.stringify({reviews:[{index:1,classification:'extraction_fix',explanation:'The quote used a proposed dehyphenation. The original still contains lan- guages.',observation:corrected}]});
 const register=resolveReviewedSynthesis(input,original,review);assert.equal(register.observations.length,2);assert.equal(register.rejectedObservations.length,0);assert.equal(register.evidenceReview.assessments[0].accepted,true);
 const ref=register.observations[1].evidence[0];assert.equal(text.slice(ref.start,ref.end),ref.quote);assert.doesNotThrow(()=>assertFrozenSynthesis(register,input));
 assert.equal(selectVerificationContext(register,chunks[0],text).documentContext.global.observationsAreIndependentEvidence,false);
 const stillWrong=resolveReviewedSynthesis(input,original,JSON.stringify({reviews:[{index:1,classification:'extraction_fix',explanation:'Claims an extraction fix but repeats the wrong quote.',observation:mismatch}]}));
 assert.equal(stillWrong.observations.length,1);assert.equal(stillWrong.rejectedObservations.length,1);assert.equal(stillWrong.evidenceReview.assessments[0].accepted,false);
 assert.throws(()=>resolveReviewedSynthesis(input,original,'{"reviews":[]}'),/every mismatched/);
 assert.throws(()=>parseDocumentSynthesis(input,'not JSON',{isolateInvalidObservations:true}),/expected JSON/);
});
test('synthesis preserves competing readings, immutable constituent hashes and canonical evidence',()=>{
 const {input}=fixture();const register=parseDocumentSynthesis(input,JSON.stringify({observations:[observation(input.blocks[0])]}));
 assert.deepEqual(register.observations[0].alternatives,['nomen','nomcn']);assert.equal(register.constituentHashes.length,1);assert.equal(register.missingChunkIndexes.length,0);
 assert.doesNotThrow(()=>assertFrozenSynthesis(register,input));
 assert.throws(()=>assertFrozenSynthesis({...register,observations:[]},input),/Frozen document context/);
 assert.throws(()=>parseDocumentSynthesis(input,JSON.stringify({observations:[{...observation(input.blocks[0]),evidence:[{blockId:input.blocks[0].id,quote:'invented source fact'}]}]})),/quote its canonical block/);
 assert.throws(()=>parseDocumentSynthesis(input,JSON.stringify({observations:[{...observation(input.blocks[0]),evidence:[]}]})),/evidence is required/);
});
test('incomplete synthesis reports coverage and rejects references into failed chunks',()=>{
 const {text,chunks,firstPasses}=fixture('Chapter I\n'+'a'.repeat(150)+'\n\nChapter II\nAmbiguous nomen.');
 const input=createSynthesisInput({revisionId:'revision',baseHash:'base',text,chunks,firstPasses:firstPasses.slice(0,1)});
 assert.equal(input.missingChunkIndexes.length,chunks.length-1);
 const block=input.blocks.find(block=>block.text.includes('nomen'));
 assert.throws(()=>parseDocumentSynthesis(input,JSON.stringify({observations:[observation(block)]})),/completed coverage/);
 const register=parseDocumentSynthesis(input,'{"observations":[]}');
 assert.equal(selectVerificationContext(register,chunks[0],text).documentContext.global.coverage,'incomplete');
});
test('changed first-pass outputs invalidate frozen context even when configuration is unchanged',()=>{
 const {input,text,chunks,firstPasses}=fixture(),register=parseDocumentSynthesis(input,'{"observations":[]}');
 const changed=createSynthesisInput({revisionId:'revision',baseHash:'base',text,chunks,title:'Scholarly fixture',firstPasses:firstPasses.map(pass=>({...pass,result:pass.result+' '}))});
 assert.throws(()=>assertFrozenSynthesis(register,changed),/Frozen document context/);
});
test('semantic context spans editorial chunks without widening edit authority; adjacency remains Unicode safe',()=>{
 const {input,text,chunks}=fixture('Chapter I\n'+('a😀'.repeat(120))+'\n\nChapter II\nA definition.');
 const sections=planContextSections(text,chunks);assert.equal(sections.length,2);assert.ok(sections[0].chunkIndexes.length>1);
 const register=parseDocumentSynthesis(input,'{"observations":[]}');
 for(const chunk of chunks){const context=selectVerificationContext(register,chunk,text);assert.equal(context.adjacentContext.editable,false);for(const side of ['before','after']){const value=context.adjacentContext[side];assert.equal(value.text,text.slice(value.start,value.end));assert.equal(value.text.isWellFormed(),true);assert.ok(value.text.length<=1000);}assert.ok(context.documentContext.section.every(section=>section.start<chunk.end&&section.end>chunk.start));}
});
test('long document input and retrieved context have explicit budgets',()=>{
 const text=('Chapter I\n'+('Long prose 😀. '.repeat(560))).repeat(20),chunks=planReprocessingChunks(text,document);
 const input=createSynthesisInput({revisionId:'revision',baseHash:'base',text,chunks,firstPasses:chunks.map(chunk=>({chunkIndex:chunk.index,requestHash:'request',result:JSON.stringify({blocks:chunk.blocks,diagnostics:[]})}))});
 assert.ok(input.request.length<=64000);assert.equal(input.constituentHashes.length,chunks.length);
 const block=input.blocks[0],observations=Array.from({length:128},()=>({kind:'pattern',reading:'Long prose '+'.'.repeat(800),alternatives:[],evidence:[{blockId:block.id,quote:'Long prose'}]}));
 const register=parseDocumentSynthesis(input,JSON.stringify({observations}));
 const context=selectVerificationContext(register,chunks[0],text);assert.ok(context.documentContext.retrieved.length<=16);assert.ok(JSON.stringify(context.documentContext.retrieved).length<=9017);
});
test('document audit finds new cross-chunk dependencies and preserves preexisting source uncertainty',()=>{
 assert.deepEqual(auditDocumentConsistency('word[^1]\n\n[^1]: note','word[^1]\n\n[^1]: note'),[]);
 assert.equal(auditDocumentConsistency('word[^1]\n\n[^1]: note','word[^1]').filter(item=>item.kind==='missing-reference').length,1);
 assert.equal(auditDocumentConsistency('word[^missing]','word[^missing]').length,0);
 assert.equal(auditDocumentConsistency('x','x\n[^1]: note\n[^1]: duplicate')[0].kind,'duplicate-definition');
 assert.equal(auditDocumentConsistency('x\f','x')[0].kind,'page-markers');
});

test('structured reconstruction uncertainty retains evidence and rejects invented readings locations',()=>{
 const {chunks,input}=fixture(),chunk=chunks[0],block=chunk.blocks[0];
 const uncertainties=[{blockId:block.id,nature:'blurred word',readings:['nomen','nomcn'],evidence:[{blockId:block.id,quote:'nomen'}],resolutionNeed:'Original-page comparison'}];
 const values=parseReconstructionUncertainty(chunk,{uncertainties});assert.deepEqual(values[0].readings,['nomen','nomcn']);assert.equal(values[0].evidence[0].start,block.text.indexOf('nomen'));
 assert.deepEqual(parseReconstructionUncertainty(chunk,{}),[]);
 assert.throws(()=>parseReconstructionUncertainty(chunk,{uncertainties:[{...uncertainties[0],blockId:'invented'}]}),/invalid uncertainty block/);
 assert.throws(()=>parseReconstructionUncertainty(chunk,{uncertainties:[{...uncertainties[0],evidence:[{blockId:block.id,quote:'invented'}]}]}),/quote a canonical block/);
 const request=createSynthesisInput({revisionId:'revision',baseHash:'base',text:chunk.blocks.map(value=>value.text).join(''),chunks,firstPasses:[{chunkIndex:0,requestHash:'r',result:JSON.stringify({blocks:chunk.blocks.map(value=>({id:value.id,text:value.text.replace('nomen','nomcn')})),uncertainties})}]}).request;
 const parsed=JSON.parse(request);assert.equal(parsed.findings[0].uncertainties[0].readings[1],'nomcn');assert.ok(parsed.findings[0].candidates[0].text.includes('nomcn'));
});

test('final deterministic audit flags major content loss and newly duplicated passages',()=>{
 const paragraph='A scholarly passage whose careful preservation matters. '.repeat(3);
 assert.equal(auditDocumentConsistency(paragraph+' Additional source content.','short')[0].kind,'content-loss');
 assert.ok(auditDocumentConsistency(paragraph,paragraph+'\n\n'+paragraph).some(item=>item.kind==='duplicate-content'));
 assert.ok(!auditDocumentConsistency(paragraph+'\n\n'+paragraph,paragraph+'\n\n'+paragraph).some(item=>item.kind==='duplicate-content'));
 assert.equal(auditDocumentConsistency('<!-- Page 1 -->\nsource','source')[0].kind,'page-markers');
});
