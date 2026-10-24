import {request} from '../api';
import type {MetadataBatchInput,MetadataBatchResult,MetadataReviewInput,SourceMetadataPolicy,SourceMetadataSnapshot} from '../../shared/source-metadata';
import {bibliographyChanged} from './bibliography-events';
const path=(id:string)=>`entities/${encodeURIComponent(id)}/source-metadata`;
function changed<T>(promise:Promise<T>,vault:string,id:string){return promise.then(value=>{bibliographyChanged(vault,id);return value;});}
export const sourceMetadataAPI={
 snapshot:(vault:string,id:string,runId?:string,signal?:AbortSignal)=>request<SourceMetadataSnapshot>(path(id)+(runId?'?runId='+encodeURIComponent(runId):''),'GET',undefined,vault,signal),
 review:(vault:string,id:string,body:MetadataReviewInput)=>changed(request<SourceMetadataSnapshot>(path(id)+'/review','POST',body,vault),vault,id),
 batch:(vault:string,id:string,body:MetadataBatchInput)=>changed(request<MetadataBatchResult>(path(id)+'/batch','POST',body,vault),vault,id),
 save:(vault:string,id:string,body:{fieldKey:string;value:string;fingerprint:string;preserveAuthoredValues?:boolean})=>changed(request<SourceMetadataSnapshot>(path(id)+'/field','PUT',body,vault),vault,id),
 policy:(vault:string,id:string,policy:SourceMetadataPolicy)=>request<SourceMetadataSnapshot>(path(id)+'/policy','PUT',{policy},vault),
};
