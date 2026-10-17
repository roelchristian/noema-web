import type { EntityScan } from '../../shared/entity-scan';

export interface ReviewFeedback { ids: string[]; message: string; detail: string; complete: boolean }
export function entityReviewFeedback(scan: EntityScan, ids: string[], decision: 'accepted' | 'rejected'): ReviewFeedback | null {
  const changed=[...scan.suggestions,...(scan.subtypeSuggestions ?? [])].filter(suggestion=>ids.includes(suggestion.id)&&suggestion.status===decision);
  if(!changed.length) return null;
  const remaining=[...scan.suggestions,...(scan.subtypeSuggestions ?? [])].filter(suggestion=>suggestion.status==='pending').length;
  const subtypeReview=changed.every(item=>scan.subtypeSuggestions?.some(subtype=>subtype.id===item.id));
  const action=decision==='accepted'?(subtypeReview?'approved':'connected'):'rejected';
  const message=changed.length===1?`${changed[0]!.name} ${action}`:`${changed.length} ${subtypeReview?'subtypes':'entities'} ${action}`;
  return {ids:changed.map(suggestion=>suggestion.id),complete:remaining===0,
    message:remaining===0?'Review complete':message,
    detail:remaining===0?`${message}. All decisions saved.`:`${remaining} ${remaining===1?'suggestion':'suggestions'} left to review.`};
}
