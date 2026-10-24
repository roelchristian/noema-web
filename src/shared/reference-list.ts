import {normalizeDoi} from './bibliography.js';
import type {CitationRecord} from './bibliographic-citations.js';
export interface ExtractedReference {id:string;raw:string;startLine:number;endLine:number;doi?:string}
/** Conservative local extraction: only an explicitly headed bibliography, bounded to 500 references. No title/author facts are invented. */
export function extractReferenceList(text:string):ExtractedReference[] {
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 const heading=lines.findIndex(line=>/^\s*(?:#{1,6}\s*)?(?:\d+[.)]?\s+)?(?:references|bibliography|works cited|literature cited)\s*:?\s*$/i.test(line));
 if(heading<0)return [];
 const entries:ExtractedReference[]=[];let current:{raw:string;startLine:number;endLine:number}|undefined;
 const push=()=>{if(current&&current.raw.trim().length>=8){const raw=current.raw.trim();const found=raw.match(/10\.\d{4,9}\/[^\s<>"{}]+/i)?.[0]?.replace(/[.,;]+$/,'');entries.push({...current,id:`L${current.startLine}-${current.endLine}`,raw,...(found&&normalizeDoi(found)?{doi:normalizeDoi(found)}:{})});}current=undefined;};
 const numbered=lines.slice(heading+1,heading+50).some(line=>/^\s*(?:\[\d+\]|\d+[.)])\s+\S/.test(line));
 for(let i=heading+1;i<lines.length&&entries.length<500;i++) {
  const line=lines[i]!;
  if(/^\s*(?:#{1,6}\s*)?(?:appendi(?:x|ces)|acknowledg(?:e)?ments|supplementary material)\b/i.test(line)){push();break;}
  const start=numbered?/^\s*(?:\[\d+\]|\d+[.)])\s+\S/.test(line):!current||/^\S/.test(line)&&/[.(]\s*(?:1[4-9]\d{2}|20\d{2})[a-z]?[).,]/.test(line);
  if(!line.trim()){if(!numbered)push();continue;}
  if(start){push();current={raw:line.trim(),startLine:i+1,endLine:i+1};}
  else if(current){current.raw+='\n'+line.trim();current.endLine=i+1;}
  if(current&&current.raw.length>16000){push();break;}
 }
 if(entries.length<500)push();return entries;
}
/** DOI exactness makes a candidate, never permission to merge or create a relationship. */
export function referenceMatches(reference:ExtractedReference,records:CitationRecord[]) {
 return reference.doi?records.filter(record=>normalizeDoi(record.fields.doi??'')===reference.doi):[];
}
export function referenceProposalBibtex(reference:ExtractedReference,key:string,title:string) {
 if(!title.trim())throw new Error('Enter a verified title before proposing a Source.');
 const escape=(value:string)=>value.replace(/\\/g,'\\textbackslash{}').replace(/[{}]/g,'').replace(/\r?\n/g,' ');
 return `@misc{${key},\n  title = {${escape(title.trim())}},\n${reference.doi?`  doi = {${escape(reference.doi)}},\n`:''}  note = {Unverified extracted reference, lines ${reference.startLine}-${reference.endLine}: ${escape(reference.raw)}}\n}`;
}
