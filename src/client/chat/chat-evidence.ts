import type {ChatEvidence} from '../../shared/chat';

const kindLabels={source:'Imported source · original extraction',own_note:'Your note',entity_fact:'Recorded entity fact',entity_overview:'Entity overview'};
export function chatEvidenceLabel(evidence:ChatEvidence):string {
 return evidence.kind==='own_note'&&evidence.origin==='ai_generated'?'AI-generated secondary note':evidence.kind==='own_note'&&evidence.origin==='mixed'?'Note with AI-generated text':kindLabels[evidence.kind];
}
export function sameChatEvidence(left:ChatEvidence|null,right:ChatEvidence):boolean {
 return !!left&&left.id===right.id&&left.fingerprint===right.fingerprint;
}
export interface ChatEvidenceGroup {key:string;title:string;kind:'source'|'note'|'entity';items:ChatEvidence[]}
export function groupChatEvidence(evidence:ChatEvidence[]):ChatEvidenceGroup[] {
 const groups=new Map<string,ChatEvidenceGroup>();
 for(const item of evidence){
  const kind=item.kind==='source'?'source':item.kind==='own_note'?'note':'entity',key=kind+':'+item.objectId;
  let group=groups.get(key);
  if(!group){group={key,title:item.title,kind,items:[]};groups.set(key,group);}
  group.items.push(item);
 }
 return [...groups.values()];
}
export function clampEvidenceWidth(width:number,workspaceWidth:number):number {
 return Math.round(Math.max(260,Math.min(width,Math.min(640,Math.max(260,workspaceWidth-340)))));
}
