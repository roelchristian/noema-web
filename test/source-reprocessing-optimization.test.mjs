import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessingOptimization,assertFrozenOptimizationPlan} from '../src/server/modules/source-reprocessing-optimization.ts';
const text='Clean prose.\n\fMathematical $$x$$ and damaged � text.';
const document={physical:{pages:[{number:1,range:{startOffset:0,endOffset:13}},{number:2,range:{startOffset:13,endOffset:text.length}}]}};
const policy={optIn:false,evaluationId:null,consent:{stageRouting:false,selectiveEvidence:false,externalTransmission:false},additionalRequestBudget:0,routes:{verify:{model:'gpt-6-astra',reasoningEffort:'high'}}};
const base={baseHash:'canonical',stage:'verify',selectedModel:{model:'gpt-5-mini',reasoningEffort:'low'},policy,capabilities:{stageRouting:true,selectiveEvidence:true,supportedModels:['gpt-5-mini','gpt-6-astra']},text,document};
test('optimization defaults preserve the selected model and authorize no extra requests or evidence',()=>{
 const plan=planReprocessingOptimization(base);assert.equal(plan.enabled,false);assert.deepEqual(plan.model,base.selectedModel);assert.deepEqual(plan.evidenceDemands,[]);assert.equal(plan.additionalRequestBudget,0);assert.equal(plan.externalTransmissionAllowed,false);
});
test('routing requires every opt-in, evaluation, consent and capability gate',()=>{
 const opted={...policy,optIn:true,evaluationId:'synthetic-evaluation-v1',consent:{...policy.consent,stageRouting:true}};
 assert.equal(planReprocessingOptimization({...base,policy:opted}).model.model,'gpt-6-astra');
 for(const changed of [{...opted,optIn:false},{...opted,evaluationId:null},{...opted,consent:{...opted.consent,stageRouting:false}}])assert.equal(planReprocessingOptimization({...base,policy:changed}).model.model,'gpt-5-mini');
 assert.equal(planReprocessingOptimization({...base,policy:opted,capabilities:{...base.capabilities,supportedModels:['gpt-5-mini']}}).model.model,'gpt-5-mini');
 assert.equal(planReprocessingOptimization({...base,policy:opted,capabilities:{...base.capabilities,stageRouting:false}}).model.model,'gpt-5-mini');
});
test('selective demands are bounded canonical physical pages and never imply transmission consent',()=>{
 const opted={...policy,optIn:true,evaluationId:'synthetic-evaluation-v1',consent:{...policy.consent,selectiveEvidence:true},additionalRequestBudget:1,maxEvidencePages:1};
 const plan=planReprocessingOptimization({...base,policy:opted});assert.equal(plan.evidenceDemands.length,1);assert.equal(plan.evidenceDemands[0].pageNumber,2);assert.equal(plan.externalTransmissionAllowed,false);assert.equal(plan.additionalRequestBudget,1);
 assert.equal(planReprocessingOptimization({...base,policy:{...opted,consent:{...opted.consent,externalTransmission:true}}}).externalTransmissionAllowed,true);
 assert.deepEqual(planReprocessingOptimization({...base,policy:{...opted,maxEvidencePages:0}}).evidenceDemands,[]);
 assert.equal(planReprocessingOptimization({...base,policy:{...opted,consent:{...opted.consent,selectiveEvidence:false}}}).evidenceDemands.length,0);
});
test('plan hashes freeze route, evidence demands, consent and additional request budget',()=>{
 const plan=planReprocessingOptimization(base);assert.doesNotThrow(()=>assertFrozenOptimizationPlan(plan,plan.hash,'canonical'));
 assert.throws(()=>assertFrozenOptimizationPlan({...plan,additionalRequestBudget:1},plan.hash,'canonical'),/changed/);
 assert.throws(()=>assertFrozenOptimizationPlan(plan,plan.hash,'new-source'),/changed/);
 assert.throws(()=>planReprocessingOptimization({...base,policy:{...policy,additionalRequestBudget:-1}}),/budget/);
});

test('invalid reasoning capabilities and malformed Unicode page ranges fail closed',()=>{
 const opted={...policy,optIn:true,evaluationId:'fixture',consent:{...policy.consent,stageRouting:true,selectiveEvidence:true},routes:{verify:{model:'gpt-6-astra',reasoningEffort:'invalid'}}};
 assert.equal(planReprocessingOptimization({...base,policy:opted}).modelRoutingEnabled,false);
 for(const range of [{startOffset:0.5,endOffset:text.length},{startOffset:0,endOffset:Infinity}])assert.throws(()=>planReprocessingOptimization({...base,policy:opted,document:{physical:{pages:[{number:1,range}]}}}),/canonical snapshot/);
 assert.throws(()=>planReprocessingOptimization({...base,text:'a😀b',policy:opted,document:{physical:{pages:[{number:1,range:{startOffset:0,endOffset:2}}]}}}),/canonical snapshot/);
 const plan=planReprocessingOptimization(base);assert.doesNotThrow(()=>assertFrozenOptimizationPlan(plan,plan.hash,'canonical',{text,document}));
 assert.throws(()=>assertFrozenOptimizationPlan(plan,plan.hash,'canonical',{text:text+'changed',document}),/changed/);
});
