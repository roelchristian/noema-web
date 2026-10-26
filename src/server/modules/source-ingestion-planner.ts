import type {SourceIngestionDepth,SourceIngestionWindowPlan} from '../../shared/source-ingestion.js';
/** A budget heuristic, independent of provider input limits. Context pages never own output. */
export function planSourceIngestionWindows(input:{pageCount:number;depth:SourceIngestionDepth;maxOutputTokens:number;estimatedTokensPerPage?:number;maxPagesPerWindow?:number}):SourceIngestionWindowPlan[] {
 const {pageCount,depth,maxOutputTokens}=input;
 if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>100_000)throw new Error('Invalid PDF page count');
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1024)throw new Error('Insufficient document output budget');
 const estimated=input.estimatedTokensPerPage??(depth==='deep'?5000:3500);
 if(!Number.isFinite(estimated)||estimated<1)throw new Error('Invalid page token estimate');
 const capacity=Math.floor(maxOutputTokens*0.55/estimated);
 if(capacity<1)throw new Error('Output budget cannot accommodate one page');
 const size=Math.min(input.maxPagesPerWindow??(depth==='deep'?4:8),capacity);
 if(!Number.isSafeInteger(size)||size<1)throw new Error('Invalid page window size');
 const windows:SourceIngestionWindowPlan[]=[];
 for(let first=1;first<=pageCount;first+=size){const ownedPages=Array.from({length:Math.min(size,pageCount-first+1)},(_,i)=>first+i);windows.push({index:windows.length,ownedPages,contextPages:first>1?[first-1]:[],estimatedOutputTokens:Math.ceil(ownedPages.length*estimated/0.55)});}
 return windows;
}

/** Freeze compact, evidence-bound context; provider interpretation never becomes a citation fact. */
export function sourceIngestionContextManifest(input:{title?:string|null;language?:string|null;sections?:{page:number;title:string}[];conventions?:string[]}) {
 return Object.freeze({version:1,provisional:true,evidenceBound:true,title:(input.title??'').slice(0,512)||null,language:(input.language??'').slice(0,64)||null,sections:(input.sections??[]).filter(s=>Number.isSafeInteger(s.page)&&s.page>0).slice(0,64).map(s=>Object.freeze({page:s.page,title:s.title.slice(0,256)})),conventions:(input.conventions??[]).slice(0,12).map(s=>s.slice(0,256))});
}
