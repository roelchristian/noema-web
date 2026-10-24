import {createHash} from 'node:crypto';
import {exportBibliography,type BibliographicEntry} from '../../shared/bibliography.js';
import {DOMAINS} from '../../shared/domains.js';
import type {PropertyProposal} from '../../shared/property-provenance.js';
import {Store} from '../store.js';
import {isScholarlyDisciplineProposal,parseScholarlyDiscipline} from '../../shared/source-scholarly.js';
import {getPropertyProvenance} from './property-provenance.js';

export interface BibliographicExportRecord {
 sourceId:string;citationKey:string;entryType:string;fields:Record<string,string>;
 provenance:Record<string,{origin:string;at?:string}>;revision:number;rawImports?:string[];rawImportIds?:string[];
}
interface ScholarlyProperty {
 id:string;name:string;value:string|null;target_id:string|null;
 targetName:string|null;targetType:string|null;
}
interface ExportSynopsis {
 basis:'document-excerpts';text:string;method?:string;conclusions?:string;quote:string;
 suggestedDisciplines?:{domainId:string;quote:string}[];
}
const scholarlyName=(name:string|null)=>!!name&&(name==='ai scholarly synopsis'||name==='discusses concept'||name.startsWith('scholarly '));
function synopsis(value:string|null):ExportSynopsis|undefined {
 if(!value)return undefined;
 try {
  const parsed:unknown=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return undefined;
  const candidate=parsed as Partial<ExportSynopsis>;
  if(candidate.basis!=='document-excerpts'||typeof candidate.text!=='string'||typeof candidate.quote!=='string')return undefined;
  if(candidate.method!==undefined&&typeof candidate.method!=='string'||candidate.conclusions!==undefined&&typeof candidate.conclusions!=='string')return undefined;
  if(candidate.suggestedDisciplines!==undefined&&(!Array.isArray(candidate.suggestedDisciplines)||candidate.suggestedDisciplines.some(item=>!item||typeof item!=='object'||typeof item.domainId!=='string'||typeof item.quote!=='string')))return undefined;
  return candidate as ExportSynopsis;
 }catch{return undefined;}
}
/** Scholarly text is untrusted plain text, never executable TeX. */
function latexText(value:string):string {
 return value.replace(/[\\{}%&#_$~^]/gu,char=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[char]!));
}
function entry(record:BibliographicExportRecord):BibliographicEntry {
 // Canonical export never gains AI fields, even if a future provider writes one.
 const fields=Object.fromEntries(Object.entries(record.fields).filter(([name])=>record.provenance[name]?.origin!=='ai'));
 return {citationKey:record.citationKey,entryType:record.entryType,fields,creators:[],rawBibtex:''};
}

/** Local deterministic export. Call only after the owning service checks vault access. */
export function exportBibliographicBundle(store:Store,vault:string,records:readonly BibliographicExportRecord[],importBatches:readonly {id:string;raw:string}[]) {
 const ordered=[...records].sort((a,b)=>a.citationKey<b.citationKey?-1:a.citationKey>b.citationKey?1:0);
 const canonical=ordered.map(entry);
 const scholarly=ordered.map(record=>{
  const proposals=store.all<PropertyProposal>("SELECT * FROM property_proposals WHERE vault_id=? AND entity_id=? AND status IN ('accepted','rejected') ORDER BY created_at,id",vault,record.sourceId).filter(proposal=>scholarlyName(proposal.property_name));
  const properties=store.all<ScholarlyProperty>(`SELECT p.id,p.name,p.value,p.target_id,t.name AS targetName,t.type AS targetType FROM properties p JOIN entities e ON e.id=p.entity_id LEFT JOIN entities t ON t.id=p.target_id AND t.vault_id=e.vault_id AND t.archived_at IS NULL WHERE e.vault_id=? AND e.id=? ORDER BY p.name,p.id`,vault,record.sourceId).filter(property=>scholarlyName(property.name));
  const reviewedProperties=properties.flatMap(property=>{
   const accepted=proposals.filter(proposal=>proposal.status==='accepted'&&proposal.property_name===property.name&&proposal.value===property.value&&proposal.target_id===property.target_id);
   if(!accepted.length)return [];
   const provenance=getPropertyProvenance(store,vault,property.id);
   return [{...property,status:'accepted' as const,proposalIds:accepted.map(proposal=>proposal.id),provenance:provenance??null,synopsis:property.name==='ai scholarly synopsis'?synopsis(property.value)??null:null}];
  });
  const relationships=store.all<{id:string;label:string;targetId:string;targetName:string;targetType:string}>(`SELECT r.id,r.label,r.target_id AS targetId,t.name AS targetName,t.type AS targetType FROM relationships r JOIN entities s ON s.id=r.source_id JOIN entities t ON t.id=r.target_id WHERE s.id=? AND s.vault_id=? AND t.vault_id=? AND s.archived_at IS NULL AND t.archived_at IS NULL AND t.type IN ('source','creativework') ORDER BY r.label,r.target_id,r.id`,record.sourceId,vault,vault);
  const classifications=store.all<{domainId:string;origin:string}>('SELECT domain_id AS domainId,origin FROM entity_domains WHERE entity_id=? ORDER BY domain_id',record.sourceId).map(discipline=>{
   const evidence=proposals.filter(proposal=>{return proposal.status==='accepted'&&isScholarlyDisciplineProposal(proposal)&&parseScholarlyDiscipline(proposal.value)?.domainId===discipline.domainId;});
   return {...discipline,label:DOMAINS.find(domain=>domain.id===discipline.domainId)?.label??discipline.domainId,status:'accepted' as const,canonical:true,proposalIds:evidence.map(proposal=>proposal.id),provenance:evidence};
  });
  const suggestedClassifications=reviewedProperties.flatMap(property=>property.synopsis?.suggestedDisciplines?.map(discipline=>({...discipline,status:'suggested' as const,canonical:false,provenance:property.provenance,proposalIds:property.proposalIds}))??[]);
  return {sourceId:record.sourceId,reviewedProposals:proposals,acceptedProperties:reviewedProperties,classifications,suggestedClassifications,relationships};
 });
 const annotated=canonical.map((record,index)=>{
  const facts=scholarly[index]!;
  const synopses=facts.acceptedProperties.filter(property=>property.synopsis&&property.provenance?.origin==='ai'&&!property.provenance.stale).map(property=>property.synopsis!);
  if(!synopses.length&&!facts.classifications.length)return record;
  const fields={...record.fields};
  const annotation=synopses.map(item=>latexText(`[Noema AI synopsis; reviewed; based on document excerpts] ${item.text}${item.method?' Method: '+item.method:''}${item.conclusions?' Conclusions: '+item.conclusions:''}`)).join('\n\n');
  if(annotation)fields.annotation=[fields.annotation,annotation].filter(Boolean).join('\n\n');
  const keywords=facts.classifications.map(discipline=>latexText(discipline.label));
  if(keywords.length)fields.keywords=[fields.keywords,...new Set(keywords)].filter(Boolean).join(', ');
  return {...record,fields};
 });
 const available=new Map(importBatches.map(batch=>[batch.id,batch]));
 const referenced=new Set<string>();
 const sidecarRecords=ordered.map((record,index)=>{
  const {rawImports,rawImportIds,...facts}=record;
  const ids=(rawImportIds??rawImports??[]).map(value=>{
   if(available.has(value)){referenced.add(value);return value;}
   const id=createHash('sha256').update(value).digest('hex');
   available.set(id,{id,raw:value});referenced.add(id);return id;
  });
  return {...facts,rawImportIds:[...new Set(ids)],scholarly:scholarly[index]};
 });
 const batches=[...available.values()].filter(batch=>referenced.has(batch.id)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return {bibtex:exportBibliography(canonical,'bibtex'),biblatex:exportBibliography(canonical,'biblatex'),annotatedBiblatex:exportBibliography(annotated,'annotated'),sidecar:JSON.stringify({version:2,records:sidecarRecords,importBatches:batches},null,2)};
}
