import {useEffect,useMemo,useRef,useState} from 'react';
import type {Entity,EntityDetail,SourceFile,SourceReference} from '../../shared/domain';
import {citationLocation} from '../../shared/citations';
import {sourceDocumentEntries,sourceNodeLabel,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {randomUUID} from '../../shared/uuid';
import {request} from '../api';
import {Icon} from '../components/Icon';
import {SourceReaderInline,SourceReaderText} from './SourceReaderText';

type LoadedFile=SourceFile&{textHash:string;document?:SourceDocument};
type Entry=ReturnType<typeof sourceDocumentEntries>[number];
interface Props {
  vaultId:string;source:Entity;entities:Entity[];onOpenEntity:(id:string)=>void;
  onCreatePageFromSource:(source:Entity)=>void;onError:(message:string)=>void;
  onAddPassage:(reference:SourceReference)=>void;onAnnotate:(reference:SourceReference)=>void;
}
function passageReference(file:LoadedFile,entry:Entry):SourceReference {
  const {node,path}=entry;
  const endOffset=node.text!==undefined?node.range.endOffset:node.range.startOffset+(node.title?.length??0);
  return {id:randomUUID(),sourceId:file.entity_id!,fileId:file.id,sourceHash:file.textHash,nodeId:node.id,
    startOffset:node.range.startOffset,endOffset,startLine:node.range.startLine,endLine:node.text!==undefined?node.range.endLine:node.range.startLine,
    ...(node.range.startPage?{startPage:node.range.startPage,endPage:node.text!==undefined?node.range.endPage??node.range.startPage:node.range.startPage}:{}),
    excerpt:node.text??node.title??file.text.slice(node.range.startOffset,endOffset),contextLabel:sourceNodeLabel(path),appLocator:sourceNodeLocator(path)};
}
function passageAnchor(fileId:string,nodeId:string){return `source-passage-${encodeURIComponent(fileId)}-${encodeURIComponent(nodeId)}`;}

/** Reading and citation state is deliberately separate from the editable page lifecycle. */
export function SourceReader({vaultId,source,onCreatePageFromSource,onError,onAddPassage,onAnnotate}:Props) {
  const [files,setFiles]=useState<SourceFile[]|null>(null),[fileId,setFileId]=useState('');
  const [loaded,setLoaded]=useState<LoadedFile|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [selected,setSelected]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const copyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(copyTimer.current),[]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    setFiles(null);setFileId('');setError('');setLoaded(null);setSelected(null);
    async function refresh() {
      try {
        const detail=await request<EntityDetail>('entities/'+encodeURIComponent(source.id),'GET',undefined,vaultId,controller.signal);
        if(controller.signal.aborted)return;
        const attachments=detail.attachments??[];
        setFiles(attachments);
        setFileId(current=>attachments.some(file=>file.id===current)?current:(attachments.find(file=>file.status==='ready'&&file.admitted===1)??attachments[0])?.id??'');
        if(attachments.some(file=>file.status==='queued'||file.status==='processing'))timer=setTimeout(()=>void refresh(),2000);
      }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    }
    void refresh();
    return()=>{controller.abort();clearTimeout(timer);};
  },[vaultId,source.id,retry]);
  const attachment=files?.find(file=>file.id===fileId);
  useEffect(()=>{
    const controller=new AbortController();setLoaded(null);setSelected(null);setCopied(false);
    if(!attachment||attachment.status!=='ready'||attachment.admitted!==1)return()=>controller.abort();
    setError('');
    void request<LoadedFile>('source-files/'+encodeURIComponent(attachment.id)+'?fingerprint=1&context=1','GET',undefined,vaultId,controller.signal).then(file=>{
      if(file.entity_id!==source.id)throw new Error('This attachment no longer belongs to the source.');
      if(!controller.signal.aborted)setLoaded(file);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>controller.abort();
  },[vaultId,source.id,attachment?.id,attachment?.status,attachment?.admitted,retry]);
  const entries=useMemo(()=>loaded?.document?sourceDocumentEntries(loaded.document).filter(({node})=>node.text!==undefined||node.title):[],[loaded]);
  const selectedEntry=entries.find(({node})=>node.id===selected);
  const reference=useMemo(()=>loaded&&selectedEntry?passageReference(loaded,selectedEntry):null,[loaded,selectedEntry]);
  function selectPassage(nodeId:string){setSelected(nodeId);setCopied(false);}
  async function copyCitation() {
    if(!reference)return;
    try {
      await navigator.clipboard.writeText(`“${reference.excerpt}”\n— ${source.name}, ${citationLocation(reference)} (${loaded?.name})`);
      setCopied(true);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(false),2500);
    }catch{onError('Unable to copy the citation. Clipboard access may be unavailable.');}
  }
  return <section className="source-reader" aria-label="Source reading view">
    <header className="source-workspace-header"><span className="source-workspace-eyebrow">{source.subtypes.length?source.subtypes.join(' · '):'Source'}</span><h1 className="page-heading source-workspace-title"><SourceReaderInline text={source.name}/></h1></header>
    <div className="source-reader-toolbar">
      <span className="source-reader-mode"><Icon name="source"/>Reading · Read-only</span>
      {files&&files.length>1&&<label className="source-reader-file-label">Attachment <select aria-label="Read source attachment" value={fileId} onChange={event=>{setFileId(event.target.value);setError('');}}>{files.map(file=><option key={file.id} value={file.id}>{file.generated_name||file.name}</option>)}</select></label>}
      {attachment&&<span className="source-reader-format">{attachment.format.toUpperCase()}</span>}
      {attachment?.admitted===1&&<a className="button small" href={'/api/source-files/'+encodeURIComponent(attachment.id)+'/download?vault='+encodeURIComponent(vaultId)} download><Icon name="download"/>Download</a>}
      {loaded?.text.trim()&&<button className="button small" type="button" onClick={()=>onCreatePageFromSource(source)}>Create note from source</button>}
    </div>
    {error&&<p className="source-reader-status dialog-error" role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
    {!files&&!error&&<p className="source-reader-status" role="status">Loading source…</p>}
    {files?.length===0&&<p className="source-reader-status">This source has no attached document. Its metadata and connections are available in the inspector.</p>}
    {attachment&&attachment.status!=='ready'&&<p className="source-reader-status" role="status">{attachment.status==='failed'?attachment.error||'Source processing failed. Use the inspector to retry.':`Preparing this source for reading… ${attachment.progress}%`}</p>}
    {attachment?.status==='ready'&&attachment.admitted!==1&&<p className="source-reader-status">This attachment is unavailable for reading.</p>}
    {attachment?.status==='ready'&&attachment.admitted===1&&!loaded&&!error&&<p className="source-reader-status" role="status">Loading document text…</p>}
    {loaded&&<div className="source-reader-layout">
      <div className="source-reader-content">
        {reference&&<aside className="source-reader-selection" aria-label="Selected passage"><div className="source-reader-selection-heading"><strong>Selected passage</strong><button type="button" aria-label="Clear selected passage" onClick={()=>setSelected(null)}><Icon name="close"/></button></div><small>{citationLocation(reference)}</small><blockquote>{reference.excerpt}</blockquote><div className="source-reader-selection-actions"><button className="button small" type="button" onClick={()=>void copyCitation()}>{copied?'Copied':'Copy citation'}</button><button className="button small" type="button" onClick={()=>onAddPassage(reference)}>Add to page</button><button className="button small" type="button" onClick={()=>onAnnotate(reference)}>Annotate</button></div><span role="status" className="sr-only">{copied?'Citation copied':''}</span></aside>}
        <article className="source-reader-document" aria-label={source.name}>
          {entries.length?entries.map(({node,path})=>{
            const Heading=(node.kind==='chapter'||node.level===1?'h2':node.kind==='subsection'||(node.level??0)>2?'h4':'h3');
            const locator=sourceNodeLocator(path)??`L${node.range.startLine}–${node.range.endLine}`;
            return <section key={node.id} id={passageAnchor(loaded.id,node.id)} className={'source-reader-passage'+(node.text===undefined?' is-heading':'')+(node.id===selected?' is-selected':'')} data-source-node={node.id}>
              <button type="button" className="source-reader-node-address" title={'Select passage '+locator} aria-label={'Select passage '+locator} aria-pressed={node.id===selected} onClick={()=>selectPassage(node.id)}>{locator}</button>
              {node.text===undefined?<Heading><SourceReaderInline text={node.title??''}/></Heading>:<SourceReaderText text={node.text} kind={node.kind}/>}
            </section>;
          }):loaded.text.trim()?<SourceReaderText text={loaded.text}/>:<p className="source-reader-status">No readable text was extracted from this attachment.</p>}
        </article>
      </div>
    </div>}
  </section>;
}
