import {SourceReadingNoteMarkers} from './SourceReadingNoteMarkers';
import {SourceReadingNavigation} from './SourceReadingNavigation';
import {SourceReadingTools} from './SourceReadingTools';
import type {ReadingNoteAnchor,SourceHighlight} from '../../shared/source-reading';
import {useEffect,useMemo,useRef,useState} from 'react';
import {entityMentionName,type Entity,type EntityDetail,type Page,type SourceFile,type SourceReference} from '../../shared/domain';
import {projectPageText} from '../../shared/page-text';
import {citationLocation} from '../../shared/citations';
import {sourceDocumentEntries,sourceNodeLabel,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {randomUUID} from '../../shared/uuid';
import {request} from '../api';
import {Icon} from '../components/Icon';
import {SourceReaderInline,SourceReaderText} from './SourceReaderText';

type LoadedFile=SourceFile&{textHash:string;document?:SourceDocument};
type Entry=ReturnType<typeof sourceDocumentEntries>[number];
interface Props {
  vaultId:string;source:Entity;entities:Entity[];onOpenEntity:(id:string)=>void;inspectorOpen?:boolean;refreshKey?:number;onActiveAttachmentChange?:(fileId:string)=>void;
  onCreatePageFromSource:(source:Entity)=>void;onError:(message:string)=>void;
  onAddPassage:(reference:SourceReference)=>void;onAnnotate:(reference:SourceReference)=>void;onReadingNoteCreated:(page:Page)=>void;onOpenReadingNote:(id:string)=>void;onRemoveReadingNote:(note:ReadingNoteAnchor)=>void;
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
export function SourceReader({vaultId,source,entities,inspectorOpen=false,refreshKey,onActiveAttachmentChange,onCreatePageFromSource,onError,onAddPassage,onAnnotate,onReadingNoteCreated,onOpenReadingNote,onRemoveReadingNote}:Props) {
  const [files,setFiles]=useState<SourceFile[]|null>(null),[fileId,setFileId]=useState('');
  const [loaded,setLoaded]=useState<LoadedFile|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [selected,setSelected]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const article=useRef<HTMLElement>(null);
  const [highlights,setHighlights]=useState<SourceHighlight[]>([]);
  const [readingNotes,setReadingNotes]=useState<ReadingNoteAnchor[]>([]);
  const copyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(copyTimer.current),[]);
  useEffect(()=>{onActiveAttachmentChange?.(fileId);},[fileId,onActiveAttachmentChange]);
  useEffect(()=>{setFiles(null);setFileId('');setError('');setLoaded(null);setSelected(null);},[vaultId,source.id,retry]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
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
  },[vaultId,source.id,source.updated_at,source.sourceStatus,refreshKey,retry]);
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
  useEffect(()=>{
    setHighlights([]);if(!loaded)return;
    const controller=new AbortController();
    void request<SourceHighlight[]>(`source-files/${encodeURIComponent(loaded.id)}/highlights`,'GET',undefined,vaultId,controller.signal).then(items=>{if(!controller.signal.aborted)setHighlights(items.filter(item=>item.sourceHash===loaded.textHash));}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>controller.abort();
  },[loaded?.id,loaded?.textHash,vaultId]);
  useEffect(()=>{
    setReadingNotes([]);if(!loaded)return;
    const controller=new AbortController();
    void request<ReadingNoteAnchor[]>(`source-files/${encodeURIComponent(loaded.id)}/reading-notes`,'GET',undefined,vaultId,controller.signal).then(items=>{
      if(!controller.signal.aborted)setReadingNotes(current=>[...items.filter(item=>item.sourceHash===loaded.textHash),...current.filter(item=>!items.some(saved=>saved.pageId===item.pageId))]);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>controller.abort();
  },[loaded?.id,loaded?.textHash,vaultId]);
  function readingNoteCreated(page:Page){
    const note=page.readingNote;
    if(note&&note.fileId===loaded?.id&&note.sourceHash===loaded.textHash)setReadingNotes(items=>[...items.filter(item=>item.pageId!==page.id),{pageId:page.id,title:page.title,text:projectPageText(page.blocks,id=>entityMentionName(entities.find(entity=>entity.id===id))).text,sourceHash:note.sourceHash,startOffset:note.startOffset,endOffset:note.endOffset}]);
    onReadingNoteCreated(page);
  }
  const entries=useMemo(()=>{
    if(!loaded?.document)return [];
    // The structural view normalizes line endings and joins prose lines. Anchor
    // selections to the original versioned text, rather than that presentation.
    const raw=loaded.text,offsets:number[]=[];
    if(raw.includes('\r'))for(let index=0;index<raw.length;index++){offsets.push(index);if(raw[index]==='\r'&&raw[index+1]==='\n')index++;}
    const offset=(value:number)=>offsets.length?(offsets[value]??raw.length):value;
    return sourceDocumentEntries(loaded.document).filter(({node})=>node.text!==undefined||node.title).map(entry=>{
      const start=offset(entry.node.range.startOffset),end=offset(entry.node.range.endOffset);
      const titleAt=entry.node.title?raw.indexOf(entry.node.title,start):-1;
      const firstLineEnd=Math.min(end,raw.indexOf('\n',start)<0?raw.length:raw.indexOf('\n',start));
      const exactTitle=titleAt>=start&&titleAt<firstLineEnd;
      const rawHeading=raw.slice(start,firstLineEnd).trimEnd(),prefix=rawHeading.match(/^\s*#{1,6}\s+/)?.[0].length??0;
      const headingStart=exactTitle?titleAt:start+prefix;
      return {...entry,node:{...entry.node,range:{...entry.node.range,startOffset:entry.node.text!==undefined?start:headingStart,endOffset:end},...(entry.node.text!==undefined?{text:raw.slice(start,end)}:{title:exactTitle?entry.node.title:rawHeading.slice(prefix)})}};
    });
  },[loaded]);
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
  return <section className={'source-reader'+(inspectorOpen?' has-inspector':'')} aria-label="Source reading view">
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
        <SourceReadingTools key={`tools:${loaded.id}:${loaded.textHash}`} file={loaded} article={article} highlights={highlights} onHighlight={highlight=>setHighlights(items=>[...items.filter(item=>item.id!==highlight.id),highlight])} onHighlightRemoved={id=>setHighlights(items=>items.filter(item=>item.id!==id))} onNoteCreated={readingNoteCreated}/>
        <article ref={article} className="source-reader-document" aria-label={source.name}>
          {entries.length?entries.map(({node,path})=>{
            const Heading=(node.kind==='chapter'||node.level===1?'h2':node.kind==='subsection'||(node.level??0)>2?'h4':'h3');
            const locator=sourceNodeLocator(path)??`L${node.range.startLine}–${node.range.endLine}`;
            return <section key={node.id} id={passageAnchor(loaded.id,node.id)} className={'source-reader-passage'+(node.text===undefined?' is-heading':'')+(node.id===selected?' is-selected':'')} data-source-node={node.id}>
              <button type="button" className="source-reader-node-address" title={'Select passage '+locator} aria-label={'Select passage '+locator} aria-pressed={node.id===selected} onClick={()=>selectPassage(node.id)}>{locator}</button>
              {node.text===undefined?<Heading><SourceReaderInline text={node.title??''} startOffset={node.range.startOffset} highlights={highlights}/></Heading>:<SourceReaderText text={node.text} kind={node.kind} startOffset={node.range.startOffset} highlights={highlights}/>}
            </section>;
          }):loaded.text.trim()?<SourceReaderText text={loaded.text} startOffset={0} highlights={highlights}/>:<p className="source-reader-status">No readable text was extracted from this attachment.</p>}
          <SourceReadingNoteMarkers article={article} notes={readingNotes} onOpen={onOpenReadingNote} onRemove={onRemoveReadingNote}/>
        </article>
        <SourceReadingNavigation key={`navigation:${loaded.id}:${loaded.textHash}`} article={article} text={loaded.text} document={loaded.document}/>
      </div>
    </div>}
  </section>;
}
