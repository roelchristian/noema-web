import {parse, parseVerbatim} from '@retorquere/bibtex-parser';

/** Bibliographic facts belong to a Source; documents and scholarly proposals stay separate. */
export interface BibliographicCreator {
 role:string; family?:string; given?:string; literal?:string; prefix?:string; suffix?:string;
}
export interface FieldProvenance {
 origin:'manual'|'bibtex'|'crossref'|'datacite'|'pdf'|'ai';
 evidence?:string; verifiedAt?:string; at?:string;
}
export interface BibliographicEntry {
 citationKey:string;
 entryType:string;
 fields:Record<string,string>;
 creators:BibliographicCreator[];
 /** Exact complete imported source, including comments, macros and preambles. Never rewritten. */
 rawBibtex:string;
}
export interface BibliographicRecord extends BibliographicEntry {
 sourceId:string;
 revision:number;
 provenance:Record<string,FieldProvenance>;
}
export interface BibliographyParseResult {
 entries:BibliographicEntry[];
 rawBibtex:string;
 warnings:string[];
}
const creatorRoles=['author','editor','translator','bookauthor','commentator','collaborator'] as const;

/** Keep date strings and unknown fields verbatim; use normalized parsing only for ordered names. */
export function parseBibliography(rawBibtex:string):BibliographyParseResult {
 if(rawBibtex.length>5_000_000)throw new Error('Bibliography exceeds the 5 MB import limit.');
 const verbatim=parseVerbatim(rawBibtex);
 // Syntax errors can omit entries. Refuse partial imports rather than silently losing records.
 if(verbatim.errors.length)throw new Error(verbatim.errors.map(error=>error.error).join('; '));
 if(verbatim.entries.length>10_000)throw new Error('Bibliography exceeds the 10,000 entry import limit.');
 const normalized=parse(rawBibtex,{sentenceCase:false,caseProtection:false});
 const warnings=normalized.errors.map(error=>error.error);
 const byKey=new Map(verbatim.entries.map(entry=>[entry.key,entry]));
 const normalizedByKey=new Map(normalized.entries.map(entry=>[entry.key,entry]));
 const resolvedFields=new Map<string,Record<string,string>>();
 if(byKey.size!==verbatim.entries.length)throw new Error('Duplicate citation keys require review; give each entry a unique key before importing.');
 const resolved=(key:string,trail=new Set<string>()):Record<string,string>=>{
  const entry=byKey.get(key);
  if(!entry)return {};
  if(trail.has(key))throw new Error(`Circular cross-reference requires review: ${key}`);
  if(trail.size>100)throw new Error('Cross-reference chain exceeds 100 entries and requires review.');
  const cached=resolvedFields.get(key);
  if(cached)return {...cached};
  const fields={...entry.fields};
  if(fields.crossref){
   if(!byKey.has(fields.crossref))warnings.push(`Unresolved cross-reference: ${fields.crossref}`);
   else {
    resolved(fields.crossref,new Set([...trail,key]));
    // The parser defines BibLaTeX inheritance (book title -> booktitle, etc.).
    // Copy the corresponding verbatim value, avoiding normalized dates or TeX loss.
    const inherited=normalizedByKey.get(key)?.crossref??{};
    for(const [name,reference] of Object.entries(inherited)){
     const parent=resolved(reference.parent,new Set([...trail,key]));
     if(fields[name]===undefined&&parent[reference.field]!==undefined)fields[name]=parent[reference.field];
    }
   }
  }
  resolvedFields.set(key,fields);
  return fields;
 };
 const entries=verbatim.entries.map(entry=>{
  if(!isCitationKey(entry.key))throw new Error(`Invalid citation key: ${entry.key}`);
  const creators:BibliographicCreator[]=[];
  const names=normalizedByKey.get(entry.key)?.fields;
  for(const role of creatorRoles){
   const values=names?.[role];
   if(Array.isArray(values))for(const person of values){
    if(typeof person==='string')continue;
    creators.push({role,...(person.name?{literal:person.name}:{family:person.lastName??'',given:person.firstName??'',...(person.prefix?{prefix:person.prefix}:{}),...(person.suffix?{suffix:person.suffix}:{})})});
   }
  }
  return {citationKey:entry.key,entryType:entry.type,fields:resolved(entry.key),creators,rawBibtex};
 });
 return {entries,rawBibtex,warnings:[...new Set(warnings)]};
}
export function isCitationKey(value:string):boolean {
 return value.length>0&&value.length<=200&&!/[\s,{}()\\#%"=]/u.test(value);
}
export function normalizeDoi(value:string|undefined):string|undefined {
 if(!value)return undefined;
 const doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase();
 return /^10\.\d{4,9}\/[^\s<>"{}]+$/u.test(doi)&&doi.length<=2048?doi:undefined;
}
/** Parse ordered names after a manual edit without changing the bibliographic fields. */
export function bibliographyCreators(fields:Record<string,string>):BibliographicCreator[] {
 const names:Record<string,string>={};
 for(const role of creatorRoles)if(fields[role])names[role]=fields[role];
 if(!Object.keys(names).length)return [];
 const raw=exportBibliography([{citationKey:'names',entryType:'misc',fields:names,creators:[],rawBibtex:''}]);
 return parseBibliography(raw).entries[0]?.creators??[];
}
export function bibliographyTitle(entry:BibliographicEntry):string {return entry.fields.title||entry.citationKey;}
export function bibliographyAuthors(entry:BibliographicEntry):string {
 return entry.creators.filter(creator=>creator.role==='author').map(creator=>creator.literal||[creator.given,creator.prefix,creator.family,creator.suffix].filter(Boolean).join(' ')).join('; ')||entry.fields.author||'';
}
function safeValue(value:string):string {
 // Edited fields must not be able to close a field and inject another entry.
 let depth=0;
 for(let index=0;index<value.length;index++){
  if(value[index]==='\\'){if(index===value.length-1)throw new Error('Trailing backslash in bibliography field.');index++;continue;}
  if(value[index]==='{')depth++;
  if(value[index]==='}'&&--depth<0)throw new Error('Unbalanced braces in bibliography field.');
 }
 if(depth!==0)throw new Error('Unbalanced braces in bibliography field.');
 return value;
}
/** Deterministic portable export. All imported fields survive; no AI text is invented or inserted. */
export function exportBibliography(entries:readonly BibliographicEntry[],mode:'bibtex'|'biblatex'|'annotated'='bibtex'):string {
 void mode; // Both formats accept preserved fields; format-specific destructive conversion is avoided.
 return [...entries].sort((left,right)=>left.citationKey<right.citationKey?-1:left.citationKey>right.citationKey?1:0).map(entry=>{
  if(!isCitationKey(entry.citationKey)||!/^[-a-zA-Z0-9_]+$/u.test(entry.entryType))throw new Error('Invalid bibliography identity.');
  const fields=Object.entries(entry.fields).sort(([left],[right])=>left<right?-1:left>right?1:0).map(([name,value])=>{
   if(!/^[-a-zA-Z0-9_:.]+$/u.test(name))throw new Error('Invalid bibliography field name.');
   return `  ${name} = {${safeValue(value)}}`;
  });
  return `@${entry.entryType}{${entry.citationKey}${fields.length?',\n'+fields.join(',\n'):''}\n}`;
 }).join('\n\n')+(entries.length?'\n':'');
}
/** Raw originals are a separate archival export: never substitute regenerated BibTeX for this evidence. */
export function exportOriginalBibliography(entries:readonly BibliographicEntry[]):string {
 return [...new Set(entries.map(entry=>entry.rawBibtex).filter(Boolean))].join('\n');
}
export function exportBibliographySidecar(records:readonly BibliographicRecord[]):string {
 return JSON.stringify({version:1,records:[...records].sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0)},null,2)+'\n';
}
