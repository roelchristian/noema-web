import {useEffect,useRef,useState} from 'react';
import type {SourceReadingRevision} from '../../shared/source-reprocessing';
import {sharedRequest} from '../state/scoped-request-cache';

export function eligibleReadingVersion(item:{status:string;stale:boolean;report:{chunksCompleted:number;chunksTotal:number}}){return item.status==='completed'&&item.report.chunksCompleted>=item.report.chunksTotal&&!item.stale;}
/** Reading preference restoration has no dependency on editorial comparison detail. */
export function useSourceReadingVersion({vaultId,fileId,savedChoice,reload,canonicalVersion,onReadingRevision,onError}:{vaultId:string;fileId:string;savedChoice?:string;reload:number;canonicalVersion?:string;onReadingRevision?:(revision:SourceReadingRevision|null)=>void;onError:(message:string)=>void}){
 const readingKey=`noema:source-reading:${vaultId}:${fileId}`;
 const [currentReadingId,setCurrentReadingId]=useState(()=>{try{return localStorage.getItem(readingKey)??'';}catch{return '';}});
 const [readingChoice,setReadingChoice]=useState(()=>savedChoice??(currentReadingId||'original'));
 const requestedReadingId=readingChoice==='original'?'':readingChoice;
 const callbacks=useRef({onReadingRevision,onError});callbacks.current={onReadingRevision,onError};
 const readingRequest=useRef(0),readingSnapshot=useRef<SourceReadingRevision|null>(null);
 function publishReading(value:SourceReadingRevision|null){readingSnapshot.current=value;callbacks.current.onReadingRevision?.(value);}
 useEffect(()=>{
  const requestId=++readingRequest.current;
  if(!requestedReadingId){publishReading(null);return;}
  const controller=new AbortController();
  void sharedRequest<SourceReadingRevision>(vaultId,`source-files/${encodeURIComponent(fileId)}/reprocessing/${encodeURIComponent(requestedReadingId)}/reading`,JSON.stringify([canonicalVersion,reload]),controller.signal).then(value=>{
   if(controller.signal.aborted||readingRequest.current!==requestId)return;
   if(value.id===requestedReadingId&&value.fileId===fileId&&eligibleReadingVersion(value))publishReading(value);
   else {publishReading(null);setReadingChoice('original');callbacks.current.onError('This revision is incomplete or no longer matches the canonical source. Original processed text is shown.');}
  }).catch(cause=>{if(!controller.signal.aborted&&readingRequest.current===requestId){publishReading(null);setReadingChoice('original');callbacks.current.onError(String(cause));}});
  return()=>controller.abort();
 },[fileId,vaultId,requestedReadingId,reload,canonicalVersion]);
 return {readingKey,currentReadingId,setCurrentReadingId,readingChoice,setReadingChoice,requestedReadingId,readingRequest,readingSnapshot,publishReading};
}
