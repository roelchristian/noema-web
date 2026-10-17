import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Block,Entity,Page} from '../../shared/domain';
import type {SourcePageEvent,SourcePageReview} from '../../shared/source-page';
import {randomUUID} from '../../shared/uuid';
import {createPageFromSource,request as apiRequest} from '../api';
import {Modal} from '../components/Modal';
import {Icon} from '../components/Icon';
import {ReadOnlyPageBlocks} from '../editor/ReadOnlyPageBlocks';

type Phase='loading'|'idle'|'generating'|'review'|'accepting'|'rejecting'|'completed'|'failed'|'stopped';
export function CreatePageFromSourceDialog({vaultId,source,onClose,onCreated,onOpenPage,onSettings}:{vaultId:string;source:Entity;onClose:()=>void;onCreated:(page:Page)=>void;onOpenPage:(id:string)=>Promise<void>;onSettings:()=>void}) {
  const [focus,setFocus]=useState(''),[title,setTitle]=useState(''),[blocks,setBlocks]=useState<Block[]>([]),[phase,setPhase]=useState<Phase>('loading'),[error,setError]=useState(''),[draft,setDraft]=useState<SourcePageReview|null>(null),[page,setPage]=useState<Page|null>(null),[opening,setOpening]=useState(false);
  const request=useRef<AbortController|null>(null),generation=useRef({id:randomUUID(),focus:''}),preview=useRef<HTMLDivElement>(null),follow=useRef(true),active=useRef(true);
  const running=phase==='generating',mutating=phase==='accepting'||phase==='rejecting',busy=running||mutating||phase==='loading'||opening;
  const route=`entities/${encodeURIComponent(source.id)}/create-page`;
  function review(value:SourcePageReview){generation.current={id:value.id,focus:value.focus};setDraft(value);setFocus(value.focus);setTitle(value.title);setBlocks(value.blocks);setPhase('review');}
  useEffect(()=>{
    active.current=true;const controller=new AbortController();request.current=controller;
    void apiRequest<{draft:SourcePageReview|null}>(route,'GET',undefined,vaultId,controller.signal).then(result=>{if(active.current&&!controller.signal.aborted){if(result.draft)review(result.draft);else setPhase('idle');}}).catch(error=>{if(active.current&&!controller.signal.aborted){setPhase('failed');setError(error instanceof Error?error.message:'Could not check for an existing draft.');}});
    return()=>{active.current=false;controller.abort();request.current?.abort();};
  },[vaultId,source.id]);
  useEffect(()=>{if(follow.current&&preview.current)preview.current.scrollTop=preview.current.scrollHeight;},[blocks.length,phase]);
  function close(){if(mutating||opening)return;request.current?.abort();onClose();}
  function stop(){request.current?.abort();setPhase('stopped');setError('Generation stopped. No page has been created.');}
  async function start(event:FormEvent) {
    event.preventDefault();if(busy||draft||page)return;
    const controller=new AbortController();request.current=controller;
    if(generation.current.focus!==focus.trim())generation.current={id:randomUUID(),focus:focus.trim()};
    setPhase('generating');setTitle('');setBlocks([]);setError('');follow.current=true;
    const receive=(event:SourcePageEvent)=>{
      if(!active.current||controller.signal.aborted)return;
      if(event.type==='title')setTitle(event.title);
      else if(event.type==='block')setBlocks(current=>[...current,event.block]);
      else if(event.type==='review')review(event.draft);
      else if(event.type==='completed'){setPage(event.page);setTitle(event.page.title);setBlocks(event.page.blocks);setPhase('completed');onCreated(event.page);}
    };
    try{await createPageFromSource(vaultId,source.id,focus.trim(),generation.current.id,receive,controller.signal);}
    catch(error){if(active.current&&!controller.signal.aborted){setPhase('failed');setError(error instanceof Error?error.message:'Could not generate the page. Please retry.');}}
    finally{if(request.current===controller)request.current=null;}
  }
  async function openPage(value=page){if(!value||opening)return;setOpening(true);setError('');try{await onOpenPage(value.id);onClose();}catch(error){if(active.current)setError(error instanceof Error?error.message:'Could not open the accepted page.');}finally{if(active.current)setOpening(false);}}
  async function accept(){
    if(!draft||busy)return;setPhase('accepting');setError('');
    try{
      const saved=await apiRequest<Page>(route+'/accept','POST',{requestId:draft.id},vaultId,AbortSignal.timeout(30000));
      if(!active.current)return;
      setPage(saved);setDraft(null);setPhase('completed');onCreated(saved);window.dispatchEvent(new Event('noema:ai-activity'));
      await openPage(saved);
    }catch(error){if(active.current){setPhase('review');setError(error instanceof Error?error.message:'Could not accept the draft. Retry to recover the saved result.');}}
  }
  async function reject(){
    if(!draft||busy)return;setPhase('rejecting');setError('');
    try{await apiRequest(route+'/reject','POST',{requestId:draft.id},vaultId,AbortSignal.timeout(30000));window.dispatchEvent(new Event('noema:ai-activity'));if(active.current)onClose();}
    catch(error){if(active.current){setPhase('review');setError(error instanceof Error?error.message:'Could not reject the draft. Please retry.');}}
  }
  const status=phase==='loading'?'Checking for a draft to review…':phase==='accepting'?'Accepting and saving your page…':phase==='rejecting'?'Discarding the draft…':phase==='review'?'Draft ready for review. No page has been created yet.':phase==='completed'?'Page accepted and saved.':phase==='failed'?'Generation could not be completed. Your source is unchanged.':phase==='stopped'?'Generation stopped.':blocks.length?`Writing your draft · ${blocks.length} ${blocks.length===1?'block':'blocks'} received`:'Reading the source and planning your page…';
  return <Modal className="source-page-dialog" titleId="source-page-title" onClose={close}><form onSubmit={start}>
    <header className="source-page-header"><span className="create-entity-icon" aria-hidden="true"><Icon name="sparkles"/></span><div><h2 id="source-page-title">Create page from source</h2><p title={source.name}>{source.name}</p></div><button type="button" className="page-tool" disabled={mutating||opening} aria-label={running?'Stop generation and close':'Close'} onClick={close}><Icon name="close"/></button></header>
    <div className="source-page-body">
      <label className="source-page-focus">What should the created page focus on? <span>Optional</span><textarea autoFocus value={focus} onChange={event=>setFocus(event.target.value)} maxLength={2000} rows={3} disabled={busy||!!draft||!!page} placeholder="For example: explain the key arguments for a beginner, compare the approaches, or turn the practical advice into a guide." aria-describedby="source-page-focus-hint"/></label>
      <p className="section-hint" id="source-page-focus-hint">Leave blank for a source-led reading of the main ideas, with verified excerpts and source-text line references. Supporting AI knowledge is labeled separately. Uses your configured AI model and sends the source’s extracted text and your focus to OpenAI. Review the draft before accepting it as a new page.</p>
      {phase!=='idle'&&<>
        <div className={'source-page-status '+phase} role="status" aria-live="polite">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{(phase==='review'||phase==='completed')&&<Icon name="check"/>}<span>{status}</span></div>
        {phase!=='loading'&&<div className="source-page-preview" ref={preview} aria-label="Generated page preview" aria-busy={running} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;}}>
          {title&&<h3 className="source-page-preview-title">{title}</h3>}
          <ReadOnlyPageBlocks blocks={blocks} entities={[]} pages={[]} vaultId={vaultId} onOpenEntity={()=>{}} onOpenPage={()=>{}}/>
          {running&&<div className="source-page-skeleton" aria-hidden="true"><span/><span/><span/></div>}
          {!running&&!blocks.length&&<p className="section-hint">No page blocks were generated.</p>}
        </div>}
        {(phase==='failed'||phase==='stopped')&&!!blocks.length&&<p className="section-hint">This preview may be incomplete. Retry to recover or generate a complete draft.</p>}
        {draft&&<p className="section-hint">Accept creates an editable page linked to this source. Reject discards this draft without adding a page to your library. Closing keeps it available for later review.</p>}
      </>}
      {error&&<p className="dialog-error" role="alert">{error}</p>}
    </div>
    <footer className="dialog-actions source-page-actions"><button type="button" className="button" disabled={busy||!!draft} onClick={onSettings}>AI settings</button><div>
      {running?<button type="button" className="button" onClick={stop}>Stop generation</button>:draft?<button type="button" className="button" disabled={busy} onClick={()=>void reject()}>{phase==='rejecting'?'Rejecting…':'Reject'}</button>:<button type="button" className="button" onClick={close} disabled={mutating||opening}>{page?'Close':'Cancel'}</button>}
      {page?<button type="button" className="button primary" disabled={opening} onClick={()=>void openPage()}>{opening?'Opening…':'Open page'}</button>:draft?<button type="button" className="button primary" disabled={busy} onClick={()=>void accept()}>{phase==='accepting'?'Accepting…':'Accept page'}</button>:<button className="button primary" disabled={busy}>{running?'Generating draft…':phase==='loading'?'Loading…':phase==='failed'||phase==='stopped'?'Retry':'Generate draft'}</button>}
    </div></footer>
  </form></Modal>;
}
