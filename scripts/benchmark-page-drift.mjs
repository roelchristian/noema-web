// Deterministic local replay only: no network, provider calls, embeddings or raw-text logs.
// Run explicitly: node --import tsx scripts/benchmark-page-drift.mjs
import {readFileSync} from 'node:fs';
import {createClassificationBaseline,assessSemanticDrift,CLASSIFICATION_VERSION} from '../src/server/modules/page-semantic-drift.ts';
const corpus=JSON.parse(readFileSync(new URL('../test/fixtures/page-drift-corpus.json',import.meta.url),'utf8'));
const page=text=>({title:'Note',blocks:[{id:'body',type:'paragraph',checked:false,content:[{text}]}]});
let tp=0,fp=0,tn=0,fn=0,legacy=0,current=0;
const decisions=corpus.map(example=>{
 const baseline=createClassificationBaseline(page(example.before)),updated=page(example.after);
 if(example.heading)updated.blocks.push({id:'heading',type:'heading2',checked:false,content:[{text:example.heading}]});
 const decision=assessSemanticDrift({page:updated,baseline,currentDomainIds:[example.domain]});
 const before=decision.contentHash!==baseline.contentHash;if(before)legacy++;
 if(decision.needsClassification)current++;
 const expected=example.label==='drift';
 if(expected&&decision.needsClassification)tp++;else if(expected)fn++;else if(decision.needsClassification)fp++;else tn++;
 return {id:example.id,expected:example.label,legacyRequested:before,gateRequested:decision.needsClassification,reason:decision.reason};
});
console.log(JSON.stringify({policy:CLASSIFICATION_VERSION,mode:'deterministic replay; not a provider or billing benchmark',cases:corpus.length,before:{classificationRequests:legacy},after:{classificationRequests:current,avoided:legacy-current},quality:{truePositives:tp,falsePositives:fp,trueNegatives:tn,falseNegatives:fn,recall:tp+fn?tp/(tp+fn):null,falsePositiveRate:fp+tn?fp/(fp+tn):null},decisions},null,2));
