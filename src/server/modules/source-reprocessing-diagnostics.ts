import katex from 'katex';

/** Canonical blocks own their separating newlines. Models often trim their output;
 * concatenating those trimmed blocks must never join prose, headings or note definitions. */
export function preserveReconstructionSeparators(original:string,replacement:string):string {
 if(!replacement.trim())return replacement;
 const suffix=original.match(/[ \t]*(?:\r\n|\r|\n)[ \t\r\n]*$/)?.[0];
 if(!suffix)return replacement;
 const ending=replacement.match(/[ \t\r\n]*$/)![0];
 const lines=(value:string)=>(value.match(/\r\n|\r|\n/g)??[]).length;
 return lines(ending)<lines(suffix)?replacement.slice(0,replacement.length-ending.length)+suffix:replacement;
}

/** Markers must remain standalone so Markdown never exposes them as prose. */
export function pageBoundaryDiagnostics(original:string,edited:string):string[] {
 const markers=(value:string)=>value.match(/<!--\s*Page\s+\d+\s*-->/gi)??[];
 const messages:string[]=[];
 if(JSON.stringify(markers(original))!==JSON.stringify(markers(edited)))messages.push('Physical page markers differ from the canonical snapshot.');
 for(const match of edited.matchAll(/<!--\s*Page\s+\d+\s*-->/gi)) {
  const before=edited.slice(0,match.index).split(/\r\n?|\n/).at(-1)??'';
  const after=edited.slice(match.index!+match[0].length).split(/\r\n?|\n/)[0]??'';
  if(before.trim()||after.trim())messages.push(`Physical page marker ${match[0]} must remain on its own line.`);
 }
 return messages;
}

/** Local editorial checks are diagnostics, not proof of textual or mathematical fidelity. */
export function editorialDiagnostics(originalText:string,editedText:string):string[] {
  const messages:string[]=[];
  // Mask code without moving line/offset coordinates used in diagnostic locations.
  const mask=(text:string)=>text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*(?:\n|$)/gm,value=>value.replace(/[^\r\n]/g,' '))
    .replace(/(`+)([^\n]*?)\1/g,value=>' '.repeat(value.length));
  const text=mask(editedText),original=mask(originalText);
  const line=(at:number)=>text.slice(0,at).split('\n').length;
  const definitions=new Map<string,number[]>(),references=new Map<string,number>();
  for(const match of text.matchAll(/^[ \t]*\[\^([^\]\n]+)\]:/gm)){
    const locations=definitions.get(match[1]!)??[];locations.push(line(match.index!));definitions.set(match[1]!,locations);
  }
  for(const match of text.matchAll(/(?<!\\)\[\^([^\]\n]+)\](?!:)/g))if(!references.has(match[1]!))references.set(match[1]!,line(match.index!));
  for(const [label,at] of references)if(!definitions.has(label))messages.push(`Footnote ${label} is referenced at revision line ${at} but has no definition. Review its linkage.`);
  for(const [label,locations] of definitions){
    if(locations.length>1)messages.push(`Footnote ${label} has ${locations.length} definitions (revision lines ${locations.slice(0,8).join(', ')}). Repeated printed labels need page-qualified IDs.`);
    if(!references.has(label))messages.push(`Footnote ${label} at revision line ${locations[0]} has no recognized reference. Check the printed marker before editing.`);
  }
  const formulas=/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;
  let formulaCount=0,invalid=0;
  for(const match of text.matchAll(formulas)){
    formulaCount++;
    if(formulaCount>2000){messages.push('Math syntax checking stopped after 2,000 formulas; remaining notation needs review.');break;}
    try{katex.renderToString(match[1]??match[2]??match[3]??match[4]??'',{throwOnError:true,strict:'error',trust:false,maxExpand:1000,displayMode:match[1]!==undefined||match[2]!==undefined});}
    catch{invalid++;if(invalid<=20)messages.push(`Math notation at revision line ${line(match.index!)} could not be rendered safely by KaTeX. Review its syntax and source.`);}
  }
  if(invalid>20)messages.push(`${invalid-20} additional formulas have rendering errors.`);
  if((text.match(/(?<!\\)\$\$/g)?.length??0)%2)messages.push('A display-math delimiter is unpaired. Review $$ blocks.');
  if((text.match(/(?<!\\)\\\[/g)?.length??0)!==(text.match(/(?<!\\)\\\]/g)?.length??0))messages.push('Display-math brackets are unbalanced. Review \\[ and \\] pairs.');
  messages.push(...pageBoundaryDiagnostics(originalText,editedText));
  if(/\uFFFD/.test(text))messages.push('Unicode replacement characters remain in the revision; the source may contain unresolved OCR or decoding damage.');
  if(!messages.length)messages.push('Local checks found no unresolved footnote links, checked math syntax errors, or changed page markers. Meaning and transcription accuracy still require editorial review.');
  return messages.length>60?[...messages.slice(0,60),`${messages.length-60} additional local diagnostics omitted.`]:messages;
}

/** Preserve invisible page separators when an otherwise valid edit removes their
 * surrounding whitespace. Marker text, numbering and order remain immutable. */
export function preservePageMarkerSeparators(text:string,start:number,end:number,replacement:string):string {
 const proposed=text.slice(0,start)+replacement+text.slice(end);
 const pattern=/<!--\s*Page\s+\d+\s*-->/gi;
 if(JSON.stringify(text.match(pattern)??[])!==JSON.stringify(proposed.match(pattern)??[]))return replacement;
 const positions=new Set<number>(),limit=start+replacement.length;
 for(const match of proposed.matchAll(pattern)){
  const from=match.index!,to=from+match[0].length;
  if(proposed.slice(0,from).split(/\r\n?|\n/).at(-1)?.trim()&&from>=start&&from<=limit)positions.add(from-start);
  if(proposed.slice(to).split(/\r\n?|\n/)[0]?.trim()&&to>=start&&to<=limit)positions.add(to-start);
 }
 for(const at of [...positions].sort((a,b)=>b-a))replacement=replacement.slice(0,at)+'\n'+replacement.slice(at);
 return replacement;
}
