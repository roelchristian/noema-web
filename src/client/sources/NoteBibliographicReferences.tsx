import {useEffect,useMemo,useState} from 'react';
import type {Block} from '../../shared/domain';
import type {CitationRecord} from '../../shared/bibliographic-citations';
import {formatScholarlyCitations,noteBibliographicCitations,type ScholarlyCitationStyle} from '../../shared/bibliographic-citations';
import {request} from '../api';
export function NoteBibliographicReferences({blocks,vaultId}:{blocks:Block[];vaultId:string}) {
 const references=useMemo(()=>noteBibliographicCitations(blocks),[blocks]);
 const ids=[...new Set(references.map(reference=>reference.sourceId))].sort().join(',');
 const [records,setRecords]=useState<CitationRecord[]>([]),[style,setStyle]=useState<ScholarlyCitationStyle>('apa'),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setRecords([]);setError('');if(!ids)return()=>controller.abort();void Promise.all(ids.split(',').map(id=>request<CitationRecord|null>(`bibliography/${encodeURIComponent(id)}`,'GET',undefined,vaultId,controller.signal))).then(records=>{if(!controller.signal.aborted){if(records.some(record=>!record)){setError('A cited Source has no bibliographic record. Add its facts in Source Details.');return;}setRecords(records.filter((record):record is CitationRecord=>!!record));}}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));});return()=>controller.abort();},[ids,vaultId,retry]);
 const rendered=useMemo(()=>{if(!records.length)return null;try{return {value:formatScholarlyCitations(records,references,style),error:''};}catch(error){return {value:null,error:error instanceof Error?error.message:'Could not format bibliography.'};}},[records,references,style]);
 if(!references.length)return null;
 return <section className="note-references" aria-label="Bibliographic references"><header className="note-references-heading"><h2>Bibliography</h2><select aria-label="Bibliography style" value={style} onChange={event=>setStyle(event.target.value as ScholarlyCitationStyle)}><option value="apa">APA 7</option><option value="ieee">IEEE</option></select></header>{error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>:rendered?.error?<p role="alert">{rendered.error}</p>:rendered?.value?<ol>{rendered.value.bibliography.map((entry,index)=><li key={index}>{entry}</li>)}</ol>:<p role="status">Loading bibliographic references…</p>}</section>;
}
