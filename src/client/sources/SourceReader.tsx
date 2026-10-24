import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {SourceReadingContinuity} from './SourceReadingContinuity';
import {t as uiText} from '../i18n';
import {SourceEvidence} from './SourceEvidence';
import {SourceReprocessing} from './SourceReprocessing';
import {SourceReadingNoteMarkers} from './SourceReadingNoteMarkers';
import {SourceReadingNavigation} from './SourceReadingNavigation';
import {SourceReadingTools} from './SourceReadingTools';
import type {ReadingNoteAnchor,SourceHighlight} from '../../shared/source-reading';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,useCallback} from 'react';
import {entityMentionName,type Entity,type EntityDetail,type Page,type SourceFile,type SourceReference} from '../../shared/domain';
import {projectPageText} from '../../shared/page-text';
import {citationLocation} from '../../shared/citations';
import {sourceNodeLabel,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {randomUUID} from '../../shared/uuid';
import {request} from '../api';
import {Icon} from '../components/Icon';
import {SourceReaderInline} from './SourceReaderText';
import {SourceDocumentView,sourceViewEntries,editorialSnapshotHasRawRanges,passageAnchor,type SourceViewEntry,type ReaderAnnotations} from './SourceDocumentView';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing';

type LoadedFile=SourceFile&{textHash:string;document?:SourceDocument};
type Entry=SourceViewEntry;
interface Props {
  vaultId:string;source:Entity;entities:Entity[];onOpenEntity:(id:string)=>void;inspectorOpen?:boolean;onToggleInspector?:()=>void;refreshKey?:number;onActiveAttachmentChange?:(fileId:string)=>void;
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

interface ReaderDisplay {annotations:ReaderAnnotations;structureLabels:boolean;editorialIndicators:boolean;typography:'sans'|'serif';width:'comfortable'|'wide'}
const defaultDisplay:ReaderDisplay={annotations:'contextual',structureLabels:false,editorialIndicators:false,typography:'sans',width:'comfortable'};
function savedDisplay():ReaderDisplay {
 try {const value=JSON.parse(localStorage.getItem('noema:source-reader-display')??'{}');return {annotations:['clean','contextual','always'].includes(value.annotations)?value.annotations:'contextual',structureLabels:value.structureLabels===true,editorialIndicators:value.editorialIndicators===true,typography:value.typography==='serif'?'serif':'sans',width:value.width==='wide'?'wide':'comfortable'};}catch{return defaultDisplay;}
}
/** Reading and citation state is deliberately separate from the editable page lifecycle. */
export function SourceReader({vaultId,source,entities,inspectorOpen=false,onToggleInspector,refreshKey,onActiveAttachmentChange,onCreatePageFromSource,onError,onAddPassage,onAnnotate,onReadingNoteCreated,onOpenReadingNote,onRemoveReadingNote}:Props) {
  const destination=useContext(ReviewDestination);
  const [display,setDisplay]=useState<ReaderDisplay>(savedDisplay);
  const [reviewOpen,setReviewOpen]=useState(false);
  function updateDisplay(value:Partial<ReaderDisplay>){setDisplay(current=>{const next={...current,...value};try{localStorage.setItem('noema:source-reader-display',JSON.stringify(next));}catch{/* Keep preferences for this session. */}return next;});}
  const reviewFile=destination?.originId===source.id?destination.fileId:undefined;
  const [files,setFiles]=useState<SourceFile[]|null>(null),[fileId,setFileId]=useState('');
  const [loaded,setLoaded]=useState<LoadedFile|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [selected,setSelected]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const article=useRef<HTMLElement>(null);
  const [reprocessed,setReprocessed]=useState(false),[comparisonPage,setComparisonPage]=useState<number|null>(null);
  const [readingRevision,setReadingRevision]=useState<SourceReprocessingRevision|null>(null);
  const position=useRef<{node?:string;page?:string;top:number}|null>(null);
  const onReadingRevision=useCallback((revision:SourceReprocessingRevision|null)=>{
    const root=article.current,edge=(document.querySelector('.topbar')?.getBoundingClientRect().bottom??0)+24;
    const passage=root&&Array.from(root.querySelectorAll<HTMLElement>('[data-source-node]')).find(item=>item.getBoundingClientRect().bottom>edge);
    if(passage)position.current={node:passage.dataset.canonicalNode,page:passage.dataset.sourcePage,top:passage.getBoundingClientRect().top};
    setReadingRevision(revision);
  },[]);
  useEffect(()=>setComparisonPage(null),[vaultId,fileId]);
  useEffect(()=>{setReprocessed(false);setReadingRevision(null);position.current=null;},[fileId,vaultId,source.id]);
  function showOriginal(nodeId?:string,focus=true){if(nodeId){position.current=null;setReadingRevision(null);}else onReadingRevision(null);setReprocessed(false);if(nodeId){setSelected(nodeId);requestAnimationFrame(()=>{const element=document.getElementById(passageAnchor(fileId,nodeId));window.dispatchEvent(new Event('noema:before-reading-jump'));element?.scrollIntoView({block:'center'});if(focus)element?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});});}}
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
        setFileId(current=>attachments.some(file=>file.id===current)?current:reviewFile&&attachments.some(file=>file.id===reviewFile)?reviewFile:(attachments.find(file=>file.status==='ready'&&file.admitted===1)??attachments[0])?.id??'');
        if(attachments.some(file=>file.status==='queued'||file.status==='processing'||file.status==='ready'&&['pending','running'].includes(file.enrichment_status)))timer=setTimeout(()=>void refresh(),2000);
      }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    }
    void refresh();
    return()=>{controller.abort();clearTimeout(timer);};
  },[vaultId,source.id,source.updated_at,source.sourceStatus,refreshKey,retry,reviewFile]);
  const attachment=files?.find(file=>file.id===fileId);
  useEffect(()=>{
    const controller=new AbortController();
    if(!attachment||attachment.status!=='ready'||attachment.admitted!==1){setLoaded(null);setSelected(null);setCopied(false);return()=>controller.abort();}
    setError('');
    void request<LoadedFile>('source-files/'+encodeURIComponent(attachment.id)+'?fingerprint=1&context=1','GET',undefined,vaultId,controller.signal).then(file=>{
      if(file.entity_id!==source.id)throw new Error('This attachment no longer belongs to the source.');
      if(!controller.signal.aborted)setLoaded(file);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>controller.abort();
  },[vaultId,source.id,attachment?.id,attachment?.status,attachment?.admitted,attachment?.enrichment_status,attachment?.structural_nodes,attachment?.page_start_lines,attachment?.generated_name,attachment?.language,attachment?.text,retry]);
  // A metadata refresh preserves the selection; a text revision invalidates it.
  useEffect(()=>{setSelected(null);setCopied(false);},[loaded?.id,loaded?.textHash]);
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
  const entries=useMemo(()=>loaded?sourceViewEntries(loaded.text,loaded.document):[],[loaded]);
  const [metadataEvidence,setMetadataEvidence]=useState<{fileId:string;start:number;end:number;excerpt:string}|null>(null);
  useEffect(()=>{const reveal=(event:Event)=>{const detail=(event as CustomEvent<{vaultId:string;sourceId:string;fileId:string;start:number;end:number;excerpt:string}>).detail;if(detail?.vaultId!==vaultId||detail.sourceId!==source.id||!files?.some(file=>file.id===detail.fileId))return;setMetadataEvidence(detail);setFileId(detail.fileId);onReadingRevision(null);setReprocessed(false);};window.addEventListener('noema:source-metadata-evidence',reveal);return()=>window.removeEventListener('noema:source-metadata-evidence',reveal);},[vaultId,source.id,files,onReadingRevision]);
  useEffect(()=>{if(!metadataEvidence||loaded?.id!==metadataEvidence.fileId)return;const evidence=metadataEvidence;setMetadataEvidence(null);const start=loaded.text.indexOf(evidence.excerpt);if(!evidence.excerpt||start<0||loaded.text.indexOf(evidence.excerpt,start+1)>=0){setError('This evidence passage has changed or is ambiguous. Reload metadata before navigating.');return;}const overlapping=entries.filter(entry=>entry.node.range.startOffset<=start&&entry.node.range.endOffset>start).sort((a,b)=>(a.node.range.endOffset-a.node.range.startOffset)-(b.node.range.endOffset-b.node.range.startOffset));const smallest=overlapping[0],matches=smallest?overlapping.filter(entry=>entry.node.range.endOffset-entry.node.range.startOffset===smallest.node.range.endOffset-smallest.node.range.startOffset):[];if(matches.length!==1){setError('This evidence has no unique passage mapping in the reader. Its excerpt remains available in Metadata.');return;}setSelected(matches[0].node.id);requestAnimationFrame(()=>{const target=document.getElementById(passageAnchor(loaded.id,matches[0].node.id));target?.scrollIntoView({block:'center'});target?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});});},[metadataEvidence,loaded,entries]);
  // Fail closed: an incomplete/stale response may never replace the reading text.
  const ambiguousEditorialRanges=useMemo(()=>!!readingRevision&&!editorialSnapshotHasRawRanges(readingRevision.reprocessed.text,readingRevision.reprocessed.document),[readingRevision]);
  const editorial=!ambiguousEditorialRanges&&readingRevision&&loaded&&readingRevision.fileId===loaded.id&&readingRevision.original.text===loaded.text&&!readingRevision.stale&&readingRevision.status==='completed'&&readingRevision.report.chunksCompleted>=readingRevision.report.chunksTotal?readingRevision:null;
  const viewText=editorial?.reprocessed.text??loaded?.text??'',viewDocument=editorial?.reprocessed.document??loaded?.document;
  const viewEntries=useMemo(()=>editorial?sourceViewEntries(editorial.reprocessed.text,editorial.reprocessed.document,true):entries,[editorial,entries]);
  function canonicalNode(nodeId:string){
    if(!editorial)return nodeId;
    if(editorial.original.text!==loaded?.text)return undefined;
    const links=editorial.nodeLinks?.filter(link=>link.reprocessedNodeIds.includes(nodeId))??[];
    // A unique recorded semantic link identifies an original passage, never an
    // equivalent rewritten offset. The citation quotes that original passage.
    return links.length===1&&entries.some(entry=>entry.node.id===links[0].originalNodeId)?links[0].originalNodeId:undefined;
  }
  useLayoutEffect(()=>{
    const saved=position.current,root=article.current;if(!saved||!root)return;position.current=null;
    const passages=Array.from(root.querySelectorAll<HTMLElement>('[data-source-node]'));
    const linked=saved.node?passages.filter(item=>item.dataset.canonicalNode===saved.node):[];
    const target=linked.length===1?linked[0]:saved.page?passages.find(item=>item.dataset.sourcePage===saved.page):undefined;
    if(target)window.scrollBy({top:target.getBoundingClientRect().top-saved.top,behavior:'instant'});
  },[editorial?.id,editorial?.updatedAt]);
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
  return <section className={'source-reader'+(inspectorOpen?' has-inspector':'')+(reviewOpen?' has-review-drawer':'')} data-reader-width={display.width} data-reader-typography={display.typography} aria-label={uiText("Source reading view")}>
    <header className="source-workspace-header"><span className="source-workspace-eyebrow"><Icon name="source"/>{uiText("Source")}{attachment&&<span className="source-reader-format">{attachment.format.toUpperCase()}</span>}</span><h1 className="page-heading source-workspace-title"><SourceReaderInline text={source.name}/></h1></header>
    <div className="source-reader-toolbar">
      <span className="source-reader-mode" title={uiText("Reading · Read-only")}><Icon name="lock"/>{uiText("Read-only")}</span>
      {files&&files.length>1&&<label className="source-reader-file-label">{uiText("Attachment") + " "}<select aria-label={uiText("Read source attachment")} value={fileId} onChange={event=>{setLoaded(null);setSelected(null);setFileId(event.target.value);setError('');}}>{files.map(file=><option key={file.id} value={file.id}>{file.generated_name||file.name}</option>)}</select></label>}
      <details className="source-reader-display"><summary aria-label={uiText('Display')} title={uiText('Display')}><Icon name="sliders"/><span className="sr-only">{uiText('Display')}</span></summary><div className="source-reader-display-panel">
        <label>{uiText('Reader annotations')}<select aria-label={uiText('Reader annotations')} value={display.annotations} onChange={event=>updateDisplay({annotations:event.target.value as ReaderAnnotations})}><option value="clean">{uiText('Clean reading')}</option><option value="contextual">{uiText('Contextual')}</option><option value="always">{uiText('Always show passage references')}</option></select></label>
        <label><input type="checkbox" checked={display.structureLabels} onChange={event=>updateDisplay({structureLabels:event.target.checked})}/>{uiText('Show Noema section and block labels')}</label>
        <label><input type="checkbox" checked={display.editorialIndicators} onChange={event=>updateDisplay({editorialIndicators:event.target.checked})}/>{uiText('Show editorial change indicators')}</label>
        <label>{uiText('Typography')}<select aria-label={uiText('Reader typography')} value={display.typography} onChange={event=>updateDisplay({typography:event.target.value as ReaderDisplay['typography']})}><option value="sans">{uiText('Sans serif')}</option><option value="serif">{uiText('Serif')}</option></select></label>
        <label>{uiText('Reading width')}<select aria-label={uiText('Reading width')} value={display.width} onChange={event=>updateDisplay({width:event.target.value as ReaderDisplay['width']})}><option value="comfortable">{uiText('Comfortable')}</option><option value="wide">{uiText('Wide')}</option></select></label>
        <div className="source-reader-display-presets"><button type="button" onClick={()=>updateDisplay(defaultDisplay)}>{uiText('Reading preset')}</button><button type="button" onClick={()=>updateDisplay({annotations:'always',structureLabels:true,editorialIndicators:true})}>{uiText('Inspection preset')}</button></div>
      </div></details>
      {onToggleInspector&&<button type="button" className="source-reader-icon-action" aria-label={uiText('Info')} title={uiText('Source information')} aria-expanded={inspectorOpen} onClick={onToggleInspector}><Icon name="info"/></button>}
      {attachment?.admitted===1&&<a className="source-reader-icon-action" aria-label={uiText("Download")} title={uiText("Download")} href={'/api/source-files/'+encodeURIComponent(attachment.id)+'/download?vault='+encodeURIComponent(vaultId)} download><Icon name="download"/></a>}
      {loaded?.text.trim()&&<button className="button small" type="button" aria-label={uiText("Create note from source")} title={uiText("Create note from source")} onClick={()=>onCreatePageFromSource(source)}><Icon name="compose"/>{uiText("Create note")}</button>}
    </div>
    {error&&<p className="source-reader-status dialog-error" role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>{uiText("Retry")}</button></p>}
    {!files&&!error&&<p className="source-reader-status" role="status">{uiText("Loading source…")}</p>}
    {files?.length===0&&<p className="source-reader-status">{uiText("This source has no attached document. Its metadata and connections are available in the inspector.")}</p>}
    {attachment&&attachment.status!=='ready'&&<p className="source-reader-status" role="status">{attachment.status==='failed'?attachment.error||uiText("Source processing failed. Use the inspector to retry."):uiText("Preparing this source for reading… {value0}%",{value0: attachment.progress})}</p>}
    {attachment?.status==='ready'&&attachment.admitted!==1&&<p className="source-reader-status">{uiText("This attachment is unavailable for reading.")}</p>}
    {attachment?.status==='ready'&&attachment.admitted===1&&!loaded&&!error&&<p className="source-reader-status" role="status">{uiText("Loading document text…")}</p>}
    {loaded?.format==='pdf'&&<SourceEvidence vaultId={vaultId} fileId={loaded.id} pageCount={loaded.pages??0} page={comparisonPage} onPage={setComparisonPage}/>}
    {loaded&&<SourceReprocessing key={`${vaultId}:${loaded.id}`} sourceId={source.id} vaultId={vaultId} fileId={loaded.id} canonicalVersion={JSON.stringify([loaded.textHash,loaded.structural_nodes,loaded.page_start_lines,loaded.generated_name,loaded.language,loaded.name,loaded.enrichment_status])} onCompare={loaded.format==='pdf'?setComparisonPage:undefined} visible={reprocessed||destination?.category==='editorial'&&reviewFile===loaded.id} onShow={()=>setReprocessed(true)} onOriginal={showOriginal} onReadingRevision={onReadingRevision} onReviewOpenChange={setReviewOpen}/>}
    {loaded&&<div className="source-reader-layout">
      <div className="source-reader-content">
        {reference&&<aside className="source-reader-selection" aria-label={uiText("Selected passage")}><div className="source-reader-selection-heading"><strong>{uiText(editorial?"Selected original passage":"Selected passage")}</strong><button type="button" aria-label={uiText("Clear selected passage")} onClick={()=>setSelected(null)}><Icon name="close"/></button></div><small>{citationLocation(reference)}</small><blockquote>{reference.excerpt}</blockquote><div className="source-reader-selection-actions"><button className="button small" type="button" onClick={()=>void copyCitation()}>{copied?uiText("Copied"):uiText("Copy citation")}</button><button className="button small" type="button" onClick={()=>onAddPassage(reference)}>{uiText("Add to page")}</button><button className="button small" type="button" onClick={()=>onAnnotate(reference)}>{uiText("Annotate")}</button></div><span role="status" className="sr-only">{copied?uiText("Citation copied"):''}</span></aside>}
        {ambiguousEditorialRanges&&<p className="source-reader-editorial-notice" role="status">{uiText('This older editorial revision has unverified text coordinates. Original processed text is shown to preserve the complete document.')}</p>}
        {editorial&&<p className="source-reader-editorial-notice">{uiText('Editorial presentation. Citation actions quote the linked original passage. Highlights, bookmarks and reading notes are available in Original processed until offset mappings are verified.')}</p>}
        {!editorial&&<SourceReadingContinuity key={`continuity:${loaded.id}:${loaded.textHash}`} file={loaded} article={article} selectedOffset={selectedEntry?.node.range.startOffset}/>}
        {!editorial&&<SourceReadingTools key={`tools:${loaded.id}:${loaded.textHash}`} file={loaded} article={article} highlights={highlights} onHighlight={highlight=>setHighlights(items=>[...items.filter(item=>item.id!==highlight.id),highlight])} onHighlightRemoved={id=>setHighlights(items=>items.filter(item=>item.id!==id))} onNoteCreated={readingNoteCreated}/>}
        <SourceDocumentView article={article} fileId={loaded.id} name={source.name} text={viewText} entries={viewEntries} selected={selected} annotations={display.annotations} structureLabels={display.structureLabels} highlights={editorial?[]:highlights} canonicalNode={canonicalNode} onSelect={selectPassage} changeForNode={display.editorialIndicators&&editorial?nodeId=>{
          const originalId=canonicalNode(nodeId),patch=originalId?editorial.patches.find(patch=>patch.nodeIds.includes(originalId)):undefined;
          return patch?{id:patch.id,label:uiText('Review correction: ')+patch.category}:undefined;
        }:undefined} onReview={patchId=>window.dispatchEvent(new CustomEvent('noema:review-source-patch',{detail:{fileId:loaded.id,revisionId:readingRevision?.id,patchId}}))}>
          {!editorial&&<SourceReadingNoteMarkers article={article} notes={readingNotes} onOpen={onOpenReadingNote} onRemove={onRemoveReadingNote}/>}
        </SourceDocumentView>
        <SourceReadingNavigation article={article} text={viewText} document={viewDocument}/>
      </div>
    </div>}
  </section>;
}
