/** Local invalidation signal; contains stable IDs only and performs no remote lookup. */
const eventName='noema:bibliography-updated';
export function bibliographyChanged(vaultId:string,sourceId?:string) {
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(eventName,{detail:{vaultId,sourceId}}));
}
export function watchBibliography(vaultId:string,sourceIds:string[],refresh:()=>void) {
 if(typeof window==='undefined')return()=>{};
 const onChange=(event:Event)=>{const detail=(event as CustomEvent<{vaultId:string;sourceId?:string}>).detail;if(detail?.vaultId===vaultId&&(!detail.sourceId||sourceIds.includes(detail.sourceId)))refresh();};
 window.addEventListener(eventName,onChange);return()=>window.removeEventListener(eventName,onChange);
}
