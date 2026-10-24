import CSL from 'citeproc';
import {apaStyle,ieeeStyle,englishLocale} from './csl/assets.js';
import {bibliographyCreators,type BibliographicCreator} from './bibliography.js';
export interface CitationRecord {sourceId:string;citationKey:string;entryType:string;fields:Record<string,string>;creators?:BibliographicCreator[]}
import {blockSegments,type Block} from './domain.js';

/** Publication identity is separate from file/passage identity. Locators do not duplicate bibliography entries. */
export interface BibliographicReference {id:string;sourceId:string;locator?:string;label?:'page'|'chapter'|'section'}
export type ScholarlyCitationStyle='apa'|'ieee';
const types:Record<string,string>={article:'article-journal',book:'book',booklet:'pamphlet',inbook:'chapter',incollection:'chapter',inproceedings:'paper-conference',conference:'paper-conference',proceedings:'book',phdthesis:'thesis',mastersthesis:'thesis',report:'report',techreport:'report',online:'webpage',dataset:'dataset',software:'software'};
export function bibliographicCsl(record:CitationRecord):Record<string,unknown> {
 const f=record.fields,item:Record<string,unknown>={id:record.sourceId,type:types[record.entryType.toLowerCase()]??'document','citation-key':record.citationKey};
 const mappings:Record<string,string>={title:'title',subtitle:'subtitle',journal:'container-title',journaltitle:'container-title',booktitle:'container-title',publisher:'publisher',address:'publisher-place',location:'publisher-place',volume:'volume',number:'issue',pages:'page',edition:'edition',doi:'DOI',isbn:'ISBN',issn:'ISSN',url:'URL',series:'collection-title',abstract:'abstract',language:'language',origtitle:'original-title'};
 for(const [bib,csl] of Object.entries(mappings))if(f[bib])item[csl]=f[bib];
 for(const role of ['author','editor','translator']) {
  const creators=(record.creators??bibliographyCreators(record.fields)).filter(creator=>creator.role===role).map(({family,given,literal})=>literal?{literal}:{...(family?{family}:{}),...(given?{given}:{})});
  if(creators.length)item[role]=creators;
 }
 const date=f.date??f.year;
 if(date){const match=/^(-?\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);item.issued=match?{'date-parts':[[Number(match[1]),...(match[2]?[Number(match[2])]:[]),...(match[3]?[Number(match[3])]:[])]]}:{literal:date};}
 if(f.origdate)item['original-date']={literal:f.origdate};
 return item;
}
export function publicationCitations(references:BibliographicReference[]) {
 const entries=new Map<string,{number:number;sourceId:string;occurrences:BibliographicReference[]}>();
 for(const reference of references){const entry=entries.get(reference.sourceId);if(entry)entry.occurrences.push(reference);else entries.set(reference.sourceId,{number:entries.size+1,sourceId:reference.sourceId,occurrences:[reference]});}
 return entries;
}
export function noteBibliographicCitations(blocks:Block[]):BibliographicReference[] {
 return blocks.flatMap(block=>blockSegments(block).flatMap(segment=>segment.bibliographicReference?[segment.bibliographicReference]:[]));
}
/** A label is keyed by the saved occurrence and locator, independent of displayed text. */
export function bibliographicCitationKey(reference:BibliographicReference) {return JSON.stringify([reference.id,reference.sourceId,reference.locator??'',reference.label??'page']);}
function formatClusters(records:CitationRecord[],clusters:BibliographicReference[][],style:ScholarlyCitationStyle) {
 const byId=new Map(records.map(record=>[record.sourceId,bibliographicCsl(record)]));
 const unique=[...publicationCitations(clusters.flat()).keys()];
 if(unique.some(id=>!byId.has(id)))throw new Error('Bibliographic metadata is missing for a cited Source.');
 if(!unique.length)return {labels:[] as string[],bibliography:[] as string[]};
 const engine=new CSL.Engine({retrieveLocale:()=>englishLocale,retrieveItem:id=>byId.get(id)},style==='ieee'?ieeeStyle:apaStyle,'en-US');
 engine.setOutputFormat('text');
 const preceding:Array<[string,number]>=[],labels:string[]=[];
 clusters.forEach((references,index)=>{
  const citationID=`noema-citation-${index}`;
  const result=engine.processCitationCluster({citationID,properties:{noteIndex:0},citationItems:references.map(reference=>({id:reference.sourceId,...(reference.locator?{locator:reference.locator,label:reference.label??'page'}:{})}))},preceding,[]);
  // Later citations can disambiguate earlier ones. Apply every processor update.
  for(const [position,label] of result[1])labels[position]=label;
  preceding.push([citationID,0]);
 });
 const bibliography=engine.makeBibliography();
 return {labels,bibliography:bibliography?bibliography[1].map(line=>line.trim()):[]};
}
/** Full document processing preserves citation order, repeated locators and live disambiguation. Output is plain text. */
export function formatScholarlyDocument(records:CitationRecord[],references:BibliographicReference[],style:ScholarlyCitationStyle='apa') {
 const result=formatClusters(records,references.map(reference=>[reference]),style);
 return {labels:new Map(references.map((reference,index)=>[bibliographicCitationKey(reference),result.labels[index]??''])),bibliography:result.bibliography};
}
/** Copy a cluster with the same production processor used by the editor. */
export function formatScholarlyCitations(records:CitationRecord[],references:BibliographicReference[],style:ScholarlyCitationStyle='apa') {
 const result=formatClusters(records,references.length?[references]:[],style);
 return {citation:result.labels[0]??'',bibliography:result.bibliography};
}
export function citationKeyMarkup(key:string,mode:'latex'|'pandoc',locator='') {
 // Imported keys are retained losslessly, but control syntax is never interpolated.
 if(!/^[\p{L}\p{N}_:.+/-]+$/u.test(key))throw new Error('This citation key contains characters unsupported by citation markup. Edit the key or use formatted citation text.');
 if(mode==='latex'){const safe=locator.replace(/[\r\n]/g,' ').replace(/[\\{}\[\]]/g,'').replace(/[%#$&_]/g,character=>'\\'+character).replace(/[~^]/g,'');return locator?`\\cite[${safe}]{${key}}`:`\\cite{${key}}`;}
 return locator?`[@${key}, ${locator.replace(/[\[\]\r\n]/g,'')}]`:`[@${key}]`;
}
