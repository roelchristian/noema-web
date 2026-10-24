import {request} from '../api';
export interface BibliographyRecord {sourceId:string;citationKey:string;entryType:string;fields:Record<string,string>;revision:number;provenance:Record<string,unknown>;rawImports:unknown[]}
export interface BibliographyPreview {batchId:string;entries:{index:number;entry:{citationKey:string;entryType:string;fields:Record<string,string>};matches:{sourceId:string;title:string;reason:string;revision?:number}[];conflicts:string[]}[];warnings:string[]}
export interface BibliographyDecision {index:number;action:'create'|'skip'|'merge';sourceId?:string;revision?:number}
export interface BibliographyVerification {proposalId:string;fields:Record<string,string>;provider:string;revision:number}
export const bibliographyAPI={
 preview:(vault:string,raw:string,signal?:AbortSignal)=>request<BibliographyPreview>('bibliography/preview','POST',{raw},vault,signal),
 import:(vault:string,raw:string,decisions:BibliographyDecision[])=>request<{sourceIds:string[];created:number;updated:number;skipped:number}>('bibliography/import','POST',{raw,decisions},vault),
 record:(vault:string,id:string,signal?:AbortSignal)=>request<BibliographyRecord|null>('bibliography/'+encodeURIComponent(id),'GET',undefined,vault,signal),
 save:(vault:string,id:string,body:{revision:number;citationKey:string;entryType:string;fields:Record<string,string>})=>request<BibliographyRecord>('bibliography/'+encodeURIComponent(id),'PUT',body,vault),
 verify:(vault:string,id:string,signal?:AbortSignal)=>request<BibliographyVerification>('bibliography/'+encodeURIComponent(id)+'/verify','POST',{consent:true},vault,signal),
 accept:(vault:string,id:string,body:BibliographyVerification)=>request<BibliographyRecord>('bibliography/'+encodeURIComponent(id)+'/accept-verification','POST',body,vault),
 candidates:(vault:string,id:string,signal?:AbortSignal)=>request<{fileId:string;name:string;reason:string}[]>('bibliography/'+encodeURIComponent(id)+'/pdf-candidates','GET',undefined,vault,signal),
 attach:(vault:string,id:string,fileId:string,revision:number)=>request('bibliography/'+encodeURIComponent(id)+'/attach','POST',{fileId,revision},vault),
 export:(vault:string)=>request<{bibtex:string;biblatex:string;sidecar:unknown}>('bibliography/export','GET',undefined,vault),
};
export function saveBibliographyFile(name:string,content:string) {const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
