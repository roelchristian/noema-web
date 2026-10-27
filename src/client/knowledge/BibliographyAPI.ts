import {bibliographyChanged} from '../sources/bibliography-events';
import {request} from '../api';
export interface BibliographyLegacyConflict {field:string;proposedValue:string;property:{id:string;name:string;value:string|null;target_id:string|null;targetName?:string};fingerprint:string}
export interface BibliographyPropertyApproval {propertyId:string;fingerprint:string}
export interface BibliographyRecord {sourceId:string;citationKey:string;entryType:string;fields:Record<string,string>;revision:number;provenance:Record<string,unknown>;rawImports:unknown[];legacyConflicts?:BibliographyLegacyConflict[]}
export interface BibliographyPreview {batchId:string;entries:{index:number;entry:{citationKey:string;entryType:string;fields:Record<string,string>};matches:{sourceId:string;title:string;reason:string;revision?:number;propertyConflicts?:BibliographyLegacyConflict[];conflicts?:{field:string;current:string;incoming:string;currentOrigin?:string}[]}[];conflicts:string[]}[];warnings:string[]}
export interface BibliographyDecision {index:number;action:'create'|'skip'|'merge';sourceId?:string;revision?:number;fields?:Record<string,'current'|'incoming'>;reviewedProperties?:BibliographyPropertyApproval[]}
export interface BibliographyVerification {proposalId:string;fields:Record<string,string>;provider:string;revision:number;reviewedProperties?:BibliographyPropertyApproval[]}
export interface BibliographySourcePreview {sourceId:string;batchId:string;revision:number;entry:{citationKey:string;entryType:string;fields:Record<string,string>};conflicts:{field:string;current:string;incoming:string;currentOrigin?:string}[];propertyConflicts:BibliographyLegacyConflict[];warnings:string[]}
export interface BibliographySourceImport {raw:string;batchId:string;revision:number;fields?:Record<string,'current'|'incoming'>;reviewedProperties?:BibliographyPropertyApproval[]}
function changed<T>(promise:Promise<T>,vault:string,id?:string):Promise<T> {return promise.then(value=>{bibliographyChanged(vault,id);return value;});}
export const bibliographyAPI={
 sourcePreview:(vault:string,id:string,raw:string,signal?:AbortSignal)=>request<BibliographySourcePreview>('bibliography/'+encodeURIComponent(id)+'/import-preview','POST',{raw},vault,signal),
 sourceImport:(vault:string,id:string,body:BibliographySourceImport)=>changed(request<BibliographyRecord>('bibliography/'+encodeURIComponent(id)+'/import','POST',body,vault),vault,id),
 sourceExport:(vault:string,id:string,signal?:AbortSignal)=>request<{bibtex:string;biblatex:string;annotated:string;sidecar:unknown}>('bibliography/'+encodeURIComponent(id)+'/export','GET',undefined,vault,signal),
 preview:(vault:string,raw:string,signal?:AbortSignal)=>request<BibliographyPreview>('bibliography/preview','POST',{raw},vault,signal),
 import:(vault:string,raw:string,decisions:BibliographyDecision[])=>changed(request<{sourceIds:string[];created:number;updated:number;skipped:number}>('bibliography/import','POST',{raw,decisions},vault),vault),
 record:(vault:string,id:string,signal?:AbortSignal)=>request<BibliographyRecord|null>('bibliography/'+encodeURIComponent(id),'GET',undefined,vault,signal),
 reconcilePreview:(vault:string,id:string,body:{revision:number;fields:Record<string,string>},signal?:AbortSignal)=>request<{conflicts:BibliographyLegacyConflict[]}>('bibliography/'+encodeURIComponent(id)+'/reconcile-preview','POST',body,vault,signal),
 save:(vault:string,id:string,body:{revision:number;citationKey:string;entryType:string;fields:Record<string,string>;reviewedProperties?:BibliographyPropertyApproval[]})=>changed(request<BibliographyRecord>('bibliography/'+encodeURIComponent(id),'PUT',body,vault),vault,id),
 verify:(vault:string,id:string,signal?:AbortSignal)=>request<BibliographyVerification>('bibliography/'+encodeURIComponent(id)+'/verify','POST',{consent:true},vault,signal),
 accept:(vault:string,id:string,body:BibliographyVerification)=>changed(request<BibliographyRecord>('bibliography/'+encodeURIComponent(id)+'/accept-verification','POST',body,vault),vault,id),
 candidates:(vault:string,id:string,signal?:AbortSignal)=>request<{fileId:string;name:string;reason:string}[]>('bibliography/'+encodeURIComponent(id)+'/pdf-candidates','GET',undefined,vault,signal),
 attach:(vault:string,id:string,fileId:string,revision:number)=>request('bibliography/'+encodeURIComponent(id)+'/attach','POST',{fileId,revision},vault),
 export:(vault:string)=>request<{bibtex:string;biblatex:string;annotated:string;sidecar:unknown}>('bibliography/export','GET',undefined,vault),
};
export function saveBibliographyFile(name:string,content:string) {const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
