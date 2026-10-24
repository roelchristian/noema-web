import {watchBibliography} from './bibliography-events';
import {useCallback,useEffect,useMemo,useState} from 'react';
import type {Block} from '../../shared/domain';
import {formatScholarlyDocument,noteBibliographicCitations,type BibliographicReference,type CitationRecord,type ScholarlyCitationStyle} from '../../shared/bibliographic-citations';
import {request} from '../api';
export interface BibliographicPresentation {labels:Map<string,string>;bibliography:string[];style:ScholarlyCitationStyle;setStyle:(style:ScholarlyCitationStyle)=>void;error:string;loading:boolean;retry:()=>void;count:number}
function storedStyle(identity:string):ScholarlyCitationStyle {try{return window.localStorage.getItem('noema:bibliography-style:'+identity)==='ieee'?'ieee':'apa';}catch{return 'apa';}}
export function useBibliographicPresentation(blocks:Block[],vaultId:string,pageId:string):BibliographicPresentation {
 const identity=vaultId+'/'+pageId;
 const [preference,setPreference]=useState(()=>({identity,style:storedStyle(identity)}));
 const style=preference.identity===identity?preference.style:storedStyle(identity);
 const setStyle=useCallback((style:ScholarlyCitationStyle)=>{setPreference({identity,style});try{window.localStorage.setItem('noema:bibliography-style:'+identity,style);}catch{/* Formatting remains usable when browser storage is unavailable. */}},[identity]);
 const signature=JSON.stringify(noteBibliographicCitations(blocks));
 const references=useMemo(()=>JSON.parse(signature) as BibliographicReference[],[signature]);
 const sourceIds=JSON.stringify([...new Set(references.map(reference=>reference.sourceId))].sort());
 const query=identity+'/'+sourceIds;
 const [loaded,setLoaded]=useState<{query:string;records:CitationRecord[];error:string}|null>(null),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const abort=new AbortController();setLoaded(null);
  const ids=JSON.parse(sourceIds) as string[];
  if(!ids.length){setLoaded({query,records:[],error:''});return()=>abort.abort();}
  void Promise.all(ids.map(id=>request<CitationRecord|null>(`bibliography/${encodeURIComponent(id)}`,'GET',undefined,vaultId,abort.signal))).then(values=>{
   if(abort.signal.aborted)return;
   if(values.some(value=>!value)){setLoaded({query,records:[],error:'A cited Source has no bibliographic record. Add its facts in Source Details.'});return;}
   setLoaded({query,records:values.filter((value):value is CitationRecord=>!!value),error:''});
  }).catch(error=>{if(!abort.signal.aborted)setLoaded({query,records:[],error:error instanceof Error?error.message:'Could not load bibliographic metadata.'});});
  return()=>abort.abort();
 },[query,sourceIds,vaultId,attempt]);
 useEffect(()=>watchBibliography(vaultId,JSON.parse(sourceIds) as string[],()=>setAttempt(value=>value+1)),[vaultId,sourceIds]);
 const current=loaded?.query===query?loaded:null;
 const rendered=useMemo(()=>{
  if(!current||current.error)return {labels:new Map<string,string>(),bibliography:[],error:current?.error??''};
  try{return {...formatScholarlyDocument(current.records,references,style),error:''};}catch(error){return {labels:new Map<string,string>(),bibliography:[],error:error instanceof Error?error.message:'Could not format citations.'};}
 },[current,references,style]);
 const retry=useCallback(()=>setAttempt(value=>value+1),[]);
 return useMemo(()=>({...rendered,style,setStyle,loading:!current,retry,count:references.length}),[rendered,style,setStyle,current,retry,references.length]);
}
