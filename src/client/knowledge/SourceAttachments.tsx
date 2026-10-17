import { useEffect, useRef, useState } from 'react';
import type { SourceFile } from '../../shared/domain';
import { request, uploadSourceFile } from '../api';

export function SourceAttachments({vaultId, entityId, initial=[], onChange, onBusy, disabled=false}: {vaultId:string;entityId?:string;disabled?:boolean;initial?:SourceFile[];onChange?:(files:SourceFile[])=>void;onBusy?:(busy:boolean)=>void}) {
  const [files,setFiles]=useState(initial),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [action,setAction]=useState('');
  const mounted=useRef(true),filesRef=useRef(files);
  filesRef.current=files;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  function change(next:SourceFile[]){if(!mounted.current)return;setFiles(next);filesRef.current=next;onChange?.(next);}
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {
        const pending=filesRef.current.filter(f=>f.status==='queued'||f.status==='processing');
        if(pending.length){const updated=await Promise.all(pending.map(f=>request<SourceFile>('source-files/'+f.id,'GET',undefined,vaultId,controller.signal)));if(mounted.current){setError('');change(filesRef.current.map(file=>updated.find(f=>f.id===file.id)??file));}}
      }catch(e){if(!controller.signal.aborted&&mounted.current)setError('Unable to refresh extraction status. Reconnecting…');}
      if(!controller.signal.aborted)timer=setTimeout(poll,1500);
    }
    timer=setTimeout(poll,500);return()=>{controller.abort();clearTimeout(timer);};
  },[vaultId,entityId]);
  async function upload(selected:FileList|null){
    if(!selected?.length)return;
    const chosen=Array.from(selected);
    if(chosen.some(file=>! /\.(txt|md|pdf)$/i.test(file.name))){setError('Choose TXT, MD, or PDF files.');return;}
    if(chosen.some(file=>!file.size||file.size>50*1024*1024)){setError('Choose nonempty files of 50 MB or smaller.');return;}
    if(!entityId&&filesRef.current.length+chosen.length>20){setError('Attach up to 20 files when creating a source.');return;}
    setBusy(true);onBusy?.(true);setError('');
    try {
      for(const file of chosen){setMessage('Saving '+file.name+' to vault…');const added=await uploadSourceFile(vaultId,file,entityId);change([...filesRef.current,added]);}
      setMessage('Original files saved. Text extraction runs on this device.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{if(mounted.current){setBusy(false);onBusy?.(false);}}
  }
  async function act(file:SourceFile,kind:'retry'|'remove'){
    setAction(file.id);onBusy?.(true);setError('');
    try {
      if(kind==='retry'){const updated=await request<SourceFile>('source-files/'+file.id+'/retry','POST',undefined,vaultId);change(filesRef.current.map(f=>f.id===file.id?updated:f));}
      else {await request('source-files/'+file.id,'DELETE',undefined,vaultId);change(filesRef.current.filter(f=>f.id!==file.id));}
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{if(mounted.current){setAction('');onBusy?.(false);}}
  }
  return <section className="source-attachments" aria-busy={busy}><h3>Attached sources</h3>
    <p className="section-hint">Attach at least one file. TXT, MD, or PDF · up to 50 MB each. Originals and extracted text stay in this vault. PDF OCR runs locally on macOS.</p>
    {!files.length&&<p className="source-empty">{entityId?'This source needs an attachment. Add the original file to complete it.':'Choose the original files for this source.'}</p>}
    <label className="source-upload">{busy?'Saving files…':files.length?'Attach more files':'Choose source files'}<input type="file" multiple accept=".txt,.md,.pdf" aria-label="Attach source files" disabled={disabled||busy||!!action} onChange={event=>{void upload(event.target.files);event.target.value='';}}/></label>
    {message&&<p className="section-hint" role="status">{message}</p>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="source-file-list">{files.map(file=><article key={file.id} className="source-file"><strong>{file.name}</strong><small>{(file.size/1024).toFixed(1)} KB · {file.id.split('.').at(-1)?.toUpperCase()}</small>
      <p role="status" className={'source-status '+file.status}>{file.status==='queued'?'Waiting for local extraction…':file.status==='processing'?`Extracting text on this device… ${file.progress}%${file.pages?` · ${file.pages} pages`:''}`:file.status==='ready'?`Text ready${file.pages?` · ${file.pages} pages`:''}${file.ocr_pages?` · ${file.ocr_pages} OCR pages`:''}`:'Extraction failed — original saved'}</p>
      {file.status==='processing'&&<progress value={file.progress} max={100} aria-label={'Extracting '+file.name}/>}
      {file.error&&<p className="dialog-error">{file.error}</p>}
      <div className="source-actions"><a href={`/api/source-files/${file.id}/download?vault=${encodeURIComponent(vaultId)}`} download>Download original</a>
        {file.status==='failed'&&<button type="button" className="button small" disabled={disabled||busy||!!action} onClick={()=>void act(file,'retry')}>{action===file.id?'Retrying…':'Retry extraction'}</button>}
        <button type="button" className="button small" disabled={disabled||busy||!!action||file.status==='processing'||(!!entityId&&files.length<=1)} title={entityId&&files.length<=1?'Attach a replacement before removing the last file':undefined} onClick={()=>void act(file,'remove')}>{action===file.id?'Working…':'Remove'}</button>
      </div>
      {file.status==='ready'&&<details><summary>Read extracted text</summary><pre className="source-text">{file.text}</pre></details>}
    </article>)}</div>
  </section>;
}
