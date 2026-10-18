export interface SourceProcessingProgress {
 phase:'math';
 completed:number;
 total:number;
 startedAt:number;
 updatedAt:number;
 estimatedRemainingSeconds?:number;
}
/** Round estimates generously; never imply second-level precision. */
export function sourceDuration(seconds:number) {
 if(seconds<60)return 'under a minute';
 const minutes=Math.ceil(seconds/60);
 return minutes===1?'about a minute':`about ${minutes} minutes`;
}
