import katex from 'katex';

/** Derived from frozen transcription, never a claim that it matches the PDF. */
export interface SourceMathAnnotation {
 start:number;end:number;source:string;display:boolean;syntax:'valid'|'invalid'|'not-checked';
 equationLabel:string|null;
 cases:{value:string;condition:string|null}[];
 decoratedIdentifiers:{source:string;base:string;decoration:string}[];
}
export interface SourceMathReviewIssue {kind:'syntax'|'unreadable'|'notation-review'|'unmarked-math'|'limit';start:number;end:number;reason:string}
export interface SourceMathAnnotations {version:1;offsets:'block-relative UTF-16, end-exclusive';formulas:SourceMathAnnotation[];review:SourceMathReviewIssue[];verified:false}
// Match reader syntax, skipping code and escaped currency. No text rewriting.
const expressions=/(`+)([\s\S]*?)\1|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;

/** Split only top-level alignment separators; nested arrays/text stay intact. */
function splitTopLevel(text:string,separator:'row'|'column'):string[] {
 const parts:string[]=[];let start=0,depth=0,environments=0;
 for(let i=0;i<text.length;i++){
  const environment=text.slice(i).match(/^\\(begin|end)\{[^}]+\}/);
  if(environment){environments+=environment[1]==='begin'?1:-1;i+=environment[0].length-1;continue;}
  if(text[i]==='%'){const newline=text.indexOf('\n',i);i=newline<0?text.length:newline;continue;}
  if(text[i]==='\\'){
   if(text[i+1]==='\\'&&separator==='row'&&depth===0&&environments===0){parts.push(text.slice(start,i));start=i+2;}
   i++;continue;
  }
  if(text[i]==='{')depth++;else if(text[i]==='}')depth--;
  if(text[i]==='&'&&separator==='column'&&depth===0&&environments===0){parts.push(text.slice(start,i));start=i+1;}
 }
 parts.push(text.slice(start));return parts;
}
function caseRows(source:string):{rows:SourceMathAnnotation['cases'];truncated:boolean} {
 const result:SourceMathAnnotation['cases']=[];
 const tokens=/\\(begin|end)\{([^}]+)\}/g;let start=-1,depth=0;
 for(const token of source.matchAll(tokens)){
  if(start<0){if(token[1]==='begin'&&['cases','dcases','rcases'].includes(token[2])){start=token.index!+token[0].length;depth=1;}continue;}
  depth+=token[1]==='begin'?1:-1;
  if(depth!==0)continue;
  for(const row of splitTopLevel(source.slice(start,token.index),'row')){
   const columns=splitTopLevel(row.replace(/^\s*\[[\d.]+(?:pt|em|ex)\]/,''),'column');
   if(columns[0]?.trim()){
    if(result.length>=128)return {rows:result,truncated:true};
    result.push({value:columns[0].trim(),condition:columns.length>1?columns.slice(1).join('&').trim():null});
   }
  }
  start=-1;
 }
 return {rows:result,truncated:false};
}
export function sourceMathAnnotations(text:string):SourceMathAnnotations {
 const formulas:SourceMathAnnotation[]=[],review:SourceMathReviewIssue[]=[],occupied:{start:number;end:number}[]=[];
 let reviewLimited=false;
 const addReview=(issue:SourceMathReviewIssue)=>{
  if(review.length<256){review.push(issue);return true;}
  if(!reviewLimited){review[255]={kind:'limit',start:issue.start,end:text.length,reason:'Additional review findings exceed the local annotation budget; source text is retained.'};reviewLimited=true;}
  return false;
 };
 for(const match of text.matchAll(expressions)){
  const start=match.index!,end=start+match[0].length;
  if(occupied.length>=4096){addReview({kind:'limit',start,end:text.length,reason:'Additional code or mathematical spans exceed the local scan budget; source text is retained.'});break;}
  occupied.push({start,end});
  if(match[1])continue;
  const source=(match[3]??match[4]??match[5]??match[6])!,display=match[3]!==undefined||match[4]!==undefined;
  if(formulas.length>=2048){addReview({kind:'limit',start,end:text.length,reason:'Additional mathematical spans exceed the local annotation budget; source text is retained.'});break;}
  let syntax:SourceMathAnnotation['syntax']='not-checked';
  if(source.length<=16000){try{katex.renderToString(source,{throwOnError:true,strict:'ignore',displayMode:display,maxExpand:1000});syntax='valid';}catch{syntax='invalid';addReview({kind:'syntax',start,end,reason:'LaTeX syntax requires review against the source page; syntax validation cannot establish source fidelity.'});}}
  else addReview({kind:'limit',start,end,reason:'This formula exceeds the local syntax-check budget; source text is retained.'});
  const decoratedIdentifiers:SourceMathAnnotation['decoratedIdentifiers']=[];
  if(source.length<=16000)for(const m of source.matchAll(/\\(bar|overline|hat|widehat|tilde|widetilde|vec)\s*\{([A-Za-z])\}|\b([A-Za-z])('{1,3})(?!')/g)){
   if(decoratedIdentifiers.length>=128){addReview({kind:'limit',start,end,reason:'Additional decorated identifiers exceed the local annotation budget; source text is retained.'});break;}
   decoratedIdentifiers.push({source:m[0],base:m[2]??m[3],decoration:m[1]??m[4]});
  }
  const parsedCases=source.length<=16000?caseRows(source):{rows:[],truncated:false};
  const cases=parsedCases.rows;
  if(parsedCases.truncated)addReview({kind:'limit',start,end,reason:'Additional piecewise rows exceed the local annotation budget; source text is retained.'});
  const equationLabel=source.length>16000?null:source.match(/\\tag\*?\{([^{}]{1,64})\}/)?.[1]??(display?text.slice(end).match(/^[ \t]*\((\d+[A-Za-z]?)\)(?=[ \t]*(?:\n|$))/)?.[1]??null:null);
  formulas.push({start,end,source,display,syntax,equationLabel,cases,decoratedIdentifiers});
  // A set declaration H paired with |bar H| deserves optical review, not an edit.
  for(const decorated of decoratedIdentifiers)if(new RegExp('\\\\\\{\\s*'+decorated.base+'(?=\\s|[|:])').test(source)&&source.includes('|'+decorated.source+'|')){addReview({kind:'notation-review',start,end,reason:`The set declaration uses ${decorated.base} while its cardinality uses ${decorated.source}; check the printed variable marks. This may be intentional.`});break;}
 }
 const outside=(start:number,end:number)=>{
  let low=0,high=occupied.length;
  while(low<high){const middle=(low+high)>>>1;if(occupied[middle]!.start<end)low=middle+1;else high=middle;}
  return low===0||occupied[low-1]!.end<=start;
 };
 for(const m of text.matchAll(/\[(?:unreadable|illegible|unclear)[^\]\n]{0,120}\]/gi))if(!addReview({kind:'unreadable',start:m.index!,end:m.index!+m[0].length,reason:'An explicit unreadable-symbol placeholder requires source-page review.'}))break;
 for(const m of text.matchAll(/\b[A-Za-z](?:_\{[^{}\n]{1,32}\}|\^\{[^{}\n]{1,32}\}|[≤≥∈⊂≠][A-Za-z0-9])/g))if(outside(m.index!,m.index!+m[0].length)&&!addReview({kind:'unmarked-math',start:m.index!,end:m.index!+m[0].length,reason:'Possible undelimited mathematical notation; inspect the original before adding markup.'}))break;
 return {version:1,offsets:'block-relative UTF-16, end-exclusive',formulas,review,verified:false};
}
