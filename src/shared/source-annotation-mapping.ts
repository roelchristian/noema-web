import type {SourceEditorialPatch} from './source-reprocessing.js';

export interface SourceAnnotationRange {startOffset:number;endOffset:number}
type AnnotationPatch=Pick<SourceEditorialPatch,'range'|'original'|'replacement'|'userReplacement'|'decision'>;
interface Edit {start:number;end:number;replacement:string}

function validRange(range:SourceAnnotationRange,length:number) {
 return Number.isSafeInteger(range.startOffset)&&Number.isSafeInteger(range.endOffset)&&range.startOffset>=0&&range.endOffset>range.startOffset&&range.endOffset<=length;
}

/** Refine a verified replacement so notes within an otherwise unchanged paragraph
 * keep their precise spans. Work is bounded even for document-sized patches. */
function refineEdit(original:string,replacement:string,offset:number):Edit[] {
 let prefix=0,suffix=0;
 while(prefix<original.length&&prefix<replacement.length&&original[prefix]===replacement[prefix])prefix++;
 while(suffix<original.length-prefix&&suffix<replacement.length-prefix&&original[original.length-1-suffix]===replacement[replacement.length-1-suffix])suffix++;
 const before=original.slice(prefix,original.length-suffix),after=replacement.slice(prefix,replacement.length-suffix),start=offset+prefix;
 if(!before&&!after)return [];
 if(!before||!after||before.length*after.length>250000)return [{start,end:start+before.length,replacement:after}];
 const width=after.length+1,table=new Uint32Array((before.length+1)*width);
 for(let i=before.length-1;i>=0;i--)for(let j=after.length-1;j>=0;j--)table[i*width+j]=before[i]===after[j]?table[(i+1)*width+j+1]!+1:Math.max(table[(i+1)*width+j]!,table[i*width+j+1]!);
 const edits:Edit[]=[];let i=0,j=0,edit:Edit|undefined;
 const flush=()=>{if(edit){edits.push(edit);edit=undefined;}};
 while(i<before.length||j<after.length){
  if(i<before.length&&j<after.length&&before[i]===after[j]){flush();i++;j++;continue;}
  edit??={start:start+i,end:start+i,replacement:''};
  if(j<after.length&&(i===before.length||table[i*width+j+1]!>=table[(i+1)*width+j]!)){edit.replacement+=after[j++];}
  else {i++;edit.end=start+i;}
 }
 flush();return edits;
}

function verifiedEdits(original:string,revised:string,patches:readonly AnnotationPatch[]):Edit[]|null {
 const accepted=patches.filter(patch=>patch.decision==='accepted').slice().sort((a,b)=>a.range.startOffset-b.range.startOffset);
 let cursor=0,result='';const edits:Edit[]=[];
 for(const patch of accepted){
  const {startOffset:start,endOffset:end}=patch.range,replacement=patch.userReplacement??patch.replacement;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<cursor||end<start||end>original.length||original.slice(start,end)!==patch.original)return null;
  result+=original.slice(cursor,start)+replacement;cursor=end;
  edits.push(...refineEdit(patch.original,replacement,start));
 }
 return result+original.slice(cursor)===revised?edits:null;
}

function normalize(text:string) {
 let value='';const starts:number[]=[],ends:number[]=[];
 for(let i=0;i<text.length;){
  // OCR line wrapping and physical page breaks do not change a passage's identity.
  if(text[i]==='-'&&/\s/.test(text[i+1]??'')&&/\p{L}/u.test(text[i-1]??'')){
   const wrap=/^-\s*\n\s*/.exec(text.slice(i));if(wrap&&/\p{L}/u.test(text[i+wrap[0].length]??'')){i+=wrap[0].length;continue;}
  }
  const start=i;let char=text[i++]!;
  if(/\s/u.test(char)){while(i<text.length&&/\s/u.test(text[i]!))i++;char=' ';}
  if(char==='\u00ad')continue;
  const normalized=char.normalize('NFKC');
  value+=normalized;for(let k=0;k<normalized.length;k++){starts.push(start);ends.push(i);}
 }
 return {value,starts,ends};
}

/** Without a verified edit history only uniquely identified quotes with context
 * may move. Repeated passages never use nearest-offset guessing. */
function quoteMapper(original:string,revised:string) {
 const target=normalize(revised);
 return (range:SourceAnnotationRange):SourceAnnotationRange|null=>{
  const quote=normalize(original.slice(range.startOffset,range.endOffset)).value.trim();
  if(!quote)return null;
  const matches:number[]=[];let at=target.value.indexOf(quote);
  while(at>=0){matches.push(at);if(matches.length>1000)return null;at=target.value.indexOf(quote,at+1);}
  if(matches.length>1){
   const prefix=normalize(original.slice(Math.max(0,range.startOffset-80),range.startOffset)).value;
   const suffix=normalize(original.slice(range.endOffset,range.endOffset+80)).value;
   const contextual=matches.filter(index=>(!prefix||target.value.slice(Math.max(0,index-prefix.length),index)===prefix)&&(!suffix||target.value.slice(index+quote.length,index+quote.length+suffix.length)===suffix));
   if(contextual.length!==1)return null;
   matches.splice(0,matches.length,contextual[0]!);
  }
  if(matches.length!==1)return null;
  const index=matches[0]!;return {startOffset:target.starts[index]!,endOffset:target.ends[index+quote.length-1]!};
 };
}

/** Builds a reusable projection. Stored annotations remain anchored to their
 * original snapshot; reverse projection allows edits made in a revision to be
 * stored against canonical text without corrupting citation coordinates. */
export function createSourceAnnotationMapper(originalText:string,revisedText:string,patches:readonly AnnotationPatch[]=[],reverse=false):(range:SourceAnnotationRange)=>SourceAnnotationRange|null {
 let edits=verifiedEdits(originalText,revisedText,patches);
 if(reverse){
  if(edits){let shift=0;edits=edits.map(edit=>{const start=edit.start+shift,result={start,end:start+edit.replacement.length,replacement:originalText.slice(edit.start,edit.end)};shift+=edit.replacement.length-(edit.end-edit.start);return result;});}
  [originalText,revisedText]=[revisedText,originalText];
 }
 let quoteFallback:ReturnType<typeof quoteMapper>|undefined;
 const fallback=(range:SourceAnnotationRange)=>(quoteFallback??=quoteMapper(originalText,revisedText))(range);
 return range=>{
  if(!validRange(range,originalText.length))return null;
  if(originalText===revisedText)return {...range};
  if(!edits)return fallback(range);
  const boundary=(position:number,endBoundary:boolean)=>{
   let shift=0;
   for(const edit of edits){
    if(position<edit.start||(position===edit.start&&endBoundary))break;
    if(position>=edit.end){shift+=edit.replacement.length-(edit.end-edit.start);continue;}
    return edit.start+shift+(endBoundary?edit.replacement.length:0);
   }
   return position+shift;
  };
  // A partial selection inside a very large wholesale replacement has no
  // trustworthy position unless its quote can still be uniquely identified.
  if(edits.some(edit=>edit.end-edit.start>256&&edit.start<range.endOffset&&edit.end>range.startOffset&&(range.startOffset>edit.start||range.endOffset<edit.end)))return fallback(range);
  const result={startOffset:boundary(range.startOffset,false),endOffset:boundary(range.endOffset,true)};
  return validRange(result,revisedText.length)?result:null;
 };
}

export function mapSourceAnnotationRange(range:SourceAnnotationRange,originalText:string,revisedText:string,patches:readonly AnnotationPatch[]=[]) {
 return createSourceAnnotationMapper(originalText,revisedText,patches)(range);
}
