import type {ChatEvidence,ChatResult,ChatScope} from '../../shared/chat';

export function chatResearchPrompts(scope:ChatScope):string[] {
 if(scope.kind==='source')return ['What is the central argument of this source?','Find a passage that qualifies the main argument.','Which claims in this source remain uncertain?'];
 if(scope.kind==='page')return ['Summarise the argument recorded in this note.','What questions does this note leave open?','Find the evidence supporting this note’s main claim.'];
 if(scope.kind==='folder')return ['Compare the main arguments in this folder.','What recurring themes appear in this folder?','Where do the sources in this folder disagree?'];
 if(scope.kind==='entity')return ['What is recorded about this subject?','Which connections are supported by evidence?','What remains uncertain about this subject?'];
 return ['Compare two arguments in my sources.','Find a passage that challenges a recorded claim.','What connections are supported by my notes?'];
}
export function ChatResearchPrompts({scope,onChoose}:{scope:ChatScope;onChoose:(question:string)=>void}) {
 return <div className="chat-research-prompts" aria-label="Research starting questions">{chatResearchPrompts(scope).map(question=><button type="button" key={question} onClick={()=>onChoose(question)}>{question}</button>)}</div>;
}
export function chatEvidenceCoverage(evidence:ChatEvidence[]) {
 return {passages:evidence.length,sources:new Set(evidence.filter(item=>item.kind==='source').map(item=>item.objectId)).size,notes:new Set(evidence.filter(item=>item.kind==='own_note').map(item=>item.objectId)).size,entities:new Set(evidence.filter(item=>item.kind==='entity_fact'||item.kind==='entity_overview').map(item=>item.objectId)).size};
}
export function ChatResponseDetails({diagnostics,evidence,usage}:{diagnostics:ChatResult['diagnostics'];evidence:ChatEvidence[];usage?:ChatResult['usage']}) {
 const coverage=chatEvidenceCoverage(evidence);
 return <details className="chat-usage"><summary>Response details</summary>
  <p className="chat-provider-note">{diagnostics.depth==='deep'?'Thorough':'Standard'} search · {diagnostics.passes} retrieval {diagnostics.passes===1?'pass':'passes'} · {diagnostics.evidenceCount} retrieved evidence {diagnostics.evidenceCount===1?'item':'items'}. Thorough searches more widely; neither depth guarantees exhaustive coverage.</p>
  <p className="chat-provider-note">Answer references: {coverage.passages} evidence {coverage.passages===1?'item':'items'} from {coverage.sources} {coverage.sources===1?'source':'sources'}, {coverage.notes} {coverage.notes===1?'note':'notes'}, and {coverage.entities} structured {coverage.entities===1?'entity':'entities'}.</p>
  {usage&&<p className="chat-provider-note" data-chat-usage>Answer usage: {usage.inputTokens??'unknown'} input tokens · {usage.outputTokens??'unknown'} output tokens · {usage.estimatedCost==null?'Cost unavailable':'Estimated $'+usage.estimatedCost.toFixed(5)}. Retrieval usage appears separately in AI activity.</p>}
 </details>;
}
