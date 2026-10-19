import {t as uiText} from '../i18n';
import {citationLocation} from '../../shared/citations';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {Entity, SourceFile, SourceReference} from '../../shared/domain';
import {sourceDocumentEntries,sourceNodeLabel,sourceNodeLocator,sourceReferenceLocator,type SourceDocument} from '../../shared/source-document';
import {request} from '../api';
import {Icon} from '../components/Icon';

export function citationLabel(reference:SourceReference) {return citationLocation(reference);}

export function semanticPassages(document:SourceDocument,reference:SourceReference) {
  return sourceDocumentEntries(document).filter(({node})=>node.text!==undefined||node.title).map(entry=>{
    const {node}=entry;
    const cited=reference.nodeId?entry.path.some(node=>node.id===reference.nodeId):reference.startOffset!==undefined&&reference.endOffset!==undefined?
      node.range.startOffset<reference.endOffset&&(node.text!==undefined?node.range.endOffset:node.range.startOffset+(node.title?.length??0))>reference.startOffset:
      node.range.startLine<=reference.endLine&&(node.text!==undefined?node.range.endLine:node.range.startLine)>=reference.startLine;
    return {...entry,cited};
  });
}

type Passage=ReturnType<typeof semanticPassages>[number];
type PassageRow=Passage&{inlineHeading?:Passage};
function semanticPassageRows(entries:Passage[]):PassageRow[] {
  const rows:PassageRow[]=[];
  const inlineKinds=new Set(['theorem','lemma','proposition','corollary','definition','proof','example','remark']);
  for(let index=0;index<entries.length;index++) {
    const heading=entries[index]!,body=entries[index+1];
    if(heading.node.title&&heading.node.text===undefined&&inlineKinds.has(heading.node.kind)&&body?.node.kind==='paragraph'&&body.path.at(-2)?.id===heading.node.id) {
      rows.push({...body,inlineHeading:heading});index++;
    }else rows.push(heading);
  }
  return rows;
}
function isCitedPassage(entry:PassageRow){return entry.cited||entry.inlineHeading?.cited;}

/** Preserve narrow saved excerpts when a legacy search passage sits inside a large node. */
export function SemanticPassageText({text,reference,cited}:{text:string;reference:SourceReference;cited:boolean}) {
  if(!cited)return <>{text}</>;
  const excerpt=reference.excerpt.replace(/\s+/g,' ').trim();
  const start=reference.nodeId?0:text.indexOf(excerpt);
  if(start<0||!excerpt)return <mark>{text}</mark>;
  const end=reference.nodeId?text.length:start+excerpt.length;
  const from=text.length>4000?Math.max(0,start-200):0;
  const to=text.length>4000?Math.min(text.length,end+200):text.length;
  return <>{from>0?'…':''}{text.slice(from,start)}<mark>{text.slice(start,end)}</mark>{text.slice(end,to)}{to<text.length?'…':''}</>;
}

export function SourceViewer({vaultId,reference,entities,onClose,onOpenEntity}: {vaultId:string;reference:SourceReference;entities:Entity[];onClose:()=>void;onOpenEntity:(id:string)=>void}) {
  const [loaded,setLoaded]=useState<{file:SourceFile;document?:SourceDocument;matches:boolean}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [before,setBefore]=useState(3),[after,setAfter]=useState(3);
  const panel=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
  const source=entities.find(entity=>entity.id===reference.sourceId);
  useEffect(()=>{
    const controller=new AbortController();setLoaded(null);setError('');
    void request<SourceFile & {textHash:string;document?:SourceDocument}>(`source-files/${encodeURIComponent(reference.fileId)}?fingerprint=1&context=1&sourceHash=${encodeURIComponent(reference.sourceHash)}`,'GET',undefined,vaultId,controller.signal).then(file=>{
      if(file.entity_id!==reference.sourceId)throw new Error('This file no longer belongs to the cited source.');
      const matches=file.status==='ready'&&file.admitted===1&&file.textHash===reference.sourceHash;
      if(!controller.signal.aborted)setLoaded({file,document:file.document,matches});
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));});
    return()=>controller.abort();
  },[vaultId,reference.fileId,reference.sourceId,reference.sourceHash,retry]);
  useEffect(()=>{close.current?.focus({preventScroll:true});},[]);
  const passages=useMemo(()=>loaded?.matches&&loaded.document&&!(reference.userLocator&&reference.startOffset===undefined)?semanticPassageRows(semanticPassages(loaded.document,reference)):[],[loaded,reference]);
  const firstCited=passages.findIndex(isCitedPassage),hasContext=firstCited>=0;
  const lastCited=passages.reduce((last,entry,index)=>isCitedPassage(entry)?index:last,-1);
  const first=Math.max(0,firstCited-before),last=Math.min(passages.length,lastCited+after+1);
  const appLocator=loaded?.matches&&loaded.document?sourceReferenceLocator(sourceDocumentEntries(loaded.document),reference):reference.appLocator;
  const contextLabel=hasContext?sourceNodeLabel(passages[firstCited]!.path):citationLabel(reference);
  useLayoutEffect(()=>{
    const target=body.current?.querySelector<HTMLElement>('[data-cited-node]'),container=panel.current;
    if(target&&container){
      const bounds=container.getBoundingClientRect(),position=target.getBoundingClientRect();
      const toolbar=container.querySelector('.panel-top')?.getBoundingClientRect().height??56;
      if(position.top<bounds.top+toolbar||position.top>bounds.bottom-80)container.scrollTop+=position.top-bounds.top-toolbar-48;
    }
  },[reference.id,loaded]);
  return <aside ref={panel} id="source-viewer" className="entity-panel entity-detail-panel source-viewer" aria-labelledby="source-viewer-title" tabIndex={-1}>
    <div className="panel-top entity-detail-toolbar"><div className="entity-toolbar-heading"><span className="entity-detail-icon"><Icon name="source"/></span><h2 id="source-viewer-title" className="entity-toolbar-title">{reference.sourceNumber?`[${reference.sourceNumber}] `:''}{source?.name??uiText("Source")}</h2></div><button ref={close} type="button" aria-label={uiText("Close source viewer")} title={uiText("Close source viewer")} onClick={onClose}><Icon name="close"/></button></div>
    <div ref={body} className="panel-body entity-detail-body">
      <div className="source-viewer-heading">
        <span className="source-viewer-location" title={contextLabel}>{citationLabel({...reference,contextLabel,appLocator})}</span>
        <button type="button" onClick={()=>onOpenEntity(reference.sourceId)}>{uiText("Source details")}<Icon name="chevron"/></button>
      </div>
      {!loaded&&!error&&<p className="source-viewer-status" role="status">{uiText("Loading surrounding context…")}</p>}
      {error&&<p className="source-viewer-status" role="alert">{error}{" " + uiText("Showing the saved passage.") + " "}<button type="button" onClick={()=>setRetry(value=>value+1)}>{uiText("Retry")}</button></p>}
      {loaded&&!loaded.matches&&<p className="source-viewer-status">{uiText("The source text has changed. Showing the saved passage excerpt.")}</p>}
      {loaded?.matches&&!hasContext&&<p className="source-viewer-status">{reference.userLocator&&reference.startOffset===undefined?uiText("This location was added manually. Showing the saved location label."):uiText("This passage’s semantic context is unavailable. Showing the saved excerpt.")}</p>}
      {hasContext&&first>0&&<button type="button" className="source-viewer-more" onClick={()=>setBefore(value=>value+5)}><Icon name="chevron"/>{uiText("Earlier context")}</button>}
      <div className="source-viewer-passages">{hasContext?passages.slice(first,last).map(({node,path,cited,inlineHeading})=><section key={node.id} className={'source-viewer-passage'+(node.text===undefined?' is-heading':'')+(cited||inlineHeading?.cited?' is-cited':'')} data-source-locator={sourceNodeLocator(path)} title={sourceNodeLocator(path)} data-cited-node={cited?node.id:inlineHeading?.cited?inlineHeading.node.id:undefined}>
        <div>{node.text===undefined&&node.appNumber&&<span className="source-viewer-node-address">{sourceNodeLocator(path)}</span>}{cited&&node.text!==undefined&&<span className="source-viewer-node-address">{sourceNodeLocator(path)}</span>}{inlineHeading&&<><strong className="source-viewer-inline-heading"><SemanticPassageText text={inlineHeading.node.title!} reference={reference} cited={inlineHeading.cited}/></strong>{' '}</>}<SemanticPassageText text={node.text??node.title??''} reference={reference} cited={cited}/></div>
      </section>):<div className="source-viewer-passage is-cited"><mark>{reference.excerpt}</mark></div>}</div>
      {hasContext&&last<passages.length&&<button type="button" className="source-viewer-more" onClick={()=>setAfter(value=>value+5)}>{uiText("More context")}<Icon name="chevron"/></button>}
      {loaded?.matches&&<p className="source-viewer-range">{loaded.file.name}</p>}
    </div>
  </aside>;
}
