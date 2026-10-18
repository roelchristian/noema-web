import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Block,Entity,Page} from '../../shared/domain';
import {defaultSourcePageOptions,sourcePageChoices,sourcePageFormats,sourcePageLanguages,type SourcePageOptions,type SourcePageRevision,type SourcePageEvent,type SourcePageReview} from '../../shared/source-page';
import {randomUUID} from '../../shared/uuid';
import {readSourcePagePreferences,rememberSourcePagePreferences} from '../state/source-page-preferences';
import {createPageFromSource,request as apiRequest} from '../api';
import {Modal} from '../components/Modal';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';
import {ReadOnlyPageBlocks} from '../editor/ReadOnlyPageBlocks';

type Phase='loading'|'idle'|'generating'|'review'|'accepting'|'rejecting'|'completed'|'failed'|'stopped';
export function CreatePageFromSourceDialog({vaultId,source,onClose,onCreated,onOpenPage,onSettings}:{vaultId:string;source:Entity;onClose:()=>void;onCreated:(page:Page)=>void;onOpenPage:(id:string)=>Promise<void>;onSettings:()=>void}) {
  const [focus,setFocus]=useState(''),[title,setTitle]=useState(''),[blocks,setBlocks]=useState<Block[]>([]),[phase,setPhase]=useState<Phase>('loading'),[error,setError]=useState(''),[draft,setDraft]=useState<SourcePageReview|null>(null),[page,setPage]=useState<Page|null>(null),[opening,setOpening]=useState(false);
  const [options,setOptions]=useState<SourcePageOptions>(readSourcePagePreferences);
  const [retryOpen,setRetryOpen]=useState(false),[feedback,setFeedback]=useState('');
  const feedbackField=useRef<HTMLTextAreaElement>(null);
  const request=useRef<AbortController|null>(null),generation=useRef({id:randomUUID(),settings:''}),preview=useRef<HTMLDivElement>(null),follow=useRef(true),active=useRef(true);
  const running=phase==='generating',mutating=phase==='accepting'||phase==='rejecting',busy=running||mutating||phase==='loading'||opening;
  const route=`entities/${encodeURIComponent(source.id)}/create-page`;
  function review(value:SourcePageReview){generation.current={id:value.id,settings:JSON.stringify([value.focus,value.options??defaultSourcePageOptions])};setOptions({...defaultSourcePageOptions,...value.options});setDraft(value);setFocus(value.focus);setTitle(value.title);setBlocks(value.blocks);setPhase('review');setRetryOpen(false);setFeedback('');}
  useEffect(()=>{
    active.current=true;const controller=new AbortController();request.current=controller;
    void apiRequest<{draft:SourcePageReview|null}>(route,'GET',undefined,vaultId,controller.signal).then(result=>{if(active.current&&!controller.signal.aborted){if(result.draft)review(result.draft);else setPhase('idle');}}).catch(error=>{if(active.current&&!controller.signal.aborted){setPhase('failed');setError(error instanceof Error?error.message:'Could not check for an existing draft.');}});
    return()=>{active.current=false;controller.abort();request.current?.abort();};
  },[vaultId,source.id]);
  useEffect(()=>{if(follow.current&&preview.current)preview.current.scrollTop=preview.current.scrollHeight;},[blocks.length,phase]);
  useEffect(()=>{if(retryOpen)feedbackField.current?.focus();},[retryOpen]);
  function close(){if(mutating||opening)return;request.current?.abort();onClose();}
  function stop(){request.current?.abort();if(draft){setTitle(draft.title);setBlocks(draft.blocks);setPhase('review');setError('Revision stopped. Your previous draft is still available.');}else{setPhase('stopped');setError('Generation stopped. No page has been created.');}}
  async function start(event:FormEvent,fresh=false) {
    event.preventDefault();if(busy||page||draft&&!retryOpen&&!fresh)return;
    const previousDraft=draft;
    const revision:SourcePageRevision|undefined=previousDraft?{draftId:previousDraft.id,feedback:fresh?'':feedback.trim(),mode:fresh?'retry':'changes'}:undefined;
    if(fresh)setRetryOpen(false);
    rememberSourcePagePreferences(options);
    const controller=new AbortController();request.current=controller;
    const settings=JSON.stringify([focus.trim(),options,...(revision?[revision]:[])]);
    if(generation.current.settings!==settings)generation.current={id:randomUUID(),settings};
    setPhase('generating');setTitle('');setBlocks([]);setError('');follow.current=true;
    const receive=(event:SourcePageEvent)=>{
      if(!active.current||controller.signal.aborted)return;
      if(event.type==='title')setTitle(event.title);
      else if(event.type==='block')setBlocks(current=>[...current,event.block]);
      else if(event.type==='review')review(event.draft);
      else if(event.type==='completed'){setPage(event.page);setTitle(event.page.title);setBlocks(event.page.blocks);setPhase('completed');onCreated(event.page);}
    };
    try{await createPageFromSource(vaultId,source.id,focus.trim(),options,generation.current.id,receive,controller.signal,revision);}
    catch(error){if(active.current&&!controller.signal.aborted){if(previousDraft){setTitle(previousDraft.title);setBlocks(previousDraft.blocks);setPhase('review');}else setPhase('failed');setError(error instanceof Error?error.message:'Could not generate the page. Please retry.');}}
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
  const status=running&&draft?(retryOpen?'Revising your draft…':'Creating another draft…'):phase==='loading'?'Checking for a draft to review…':phase==='accepting'?'Accepting and saving your page…':phase==='rejecting'?'Discarding the draft…':phase==='review'?'Draft ready for review. No page has been created yet.':phase==='completed'?'Page accepted and saved.':phase==='failed'?'Generation could not be completed. Your source is unchanged.':phase==='stopped'?'Generation stopped.':blocks.length?`Writing your draft · ${blocks.length} ${blocks.length===1?'block':'blocks'} received`:'Reading the source and planning your page…';
  const hasPreview=running||!!title||!!blocks.length||!!draft||!!page;
  const controlsDisabled=busy||!!draft||!!page;
  return <Modal className={'source-page-dialog'+(hasPreview?' has-preview':'')} titleId="source-page-title" onClose={close}><form onSubmit={start}>
    <header className="source-page-header"><span className="create-entity-icon" aria-hidden="true"><Icon name="sparkles"/></span><div><h2 id="source-page-title">Create page from source</h2><p title={source.name}>{source.name}</p></div><button type="button" className="page-tool" disabled={mutating||opening} aria-label={running?'Stop generation and close':'Close'} onClick={close}><Icon name="close"/></button></header>
    <div className="source-page-body">
      <div className="source-page-controls">
      <fieldset className="source-page-formats"><legend>Choose a format</legend><div role="group" aria-label="Page format">
        {Object.entries(sourcePageFormats).map(([key,format])=><button type="button" key={key} className="source-page-format" aria-pressed={options.format===key} disabled={controlsDisabled} onClick={()=>setOptions(current=>({...current,format:key as SourcePageOptions['format'],organization:format.organization}))}><strong>{format.label}</strong><small>{format.description}</small></button>)}
      </div></fieldset>
      <div className="source-page-options source-page-essentials">
        <label className="source-page-option">Length<Select aria-label="Length" value={options.detail} disabled={controlsDisabled} onChange={event=>setOptions(current=>({...current,detail:event.target.value as SourcePageOptions['detail']}))}>{Object.entries(sourcePageChoices.detail.options).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
        <label className="source-page-option">Output language<Select aria-label="Output language" value={options.language} disabled={controlsDisabled} onChange={event=>setOptions(current=>({...current,language:event.target.value}))}>
          <option value="">Match the source</option>
          {options.language&&!sourcePageLanguages.some(language=>language===options.language)&&<option value={options.language}>{options.language}</option>}
          {sourcePageLanguages.map(language=><option key={language} value={language}>{language}</option>)}
        </Select></label>
      </div>
      <label className="source-page-focus">{options.format==='custom'?'Describe your page':'Anything to focus on?'} <span>Optional</span><textarea autoFocus value={focus} onChange={event=>setFocus(event.target.value)} maxLength={2000} rows={2} disabled={controlsDisabled} placeholder={options.format==='custom'?'Describe the note you want to create…':'Add a topic, question, or emphasis…'} aria-describedby="source-page-focus-hint"/></label>
      {draft&&retryOpen&&<div className="source-page-retry">
        <label className="source-page-focus">What would you like to change? <span>Optional</span><textarea ref={feedbackField} value={feedback} onChange={event=>setFeedback(event.target.value)} maxLength={2000} rows={3} disabled={busy} placeholder="For example: make it shorter, explain the key ideas more clearly, or use a different structure." aria-describedby="source-page-retry-hint"/></label>
        <p className="section-hint" id="source-page-retry-hint">Your current draft stays available until the new version is ready.</p>
        <div className="source-page-retry-actions"><button type="button" className="button" disabled={busy} onClick={()=>setRetryOpen(false)}>Cancel</button><button type="submit" className="button primary" disabled={busy}>Generate revision</button></div>
      </div>}
      <p className="section-hint source-page-note" id="source-page-focus-hint">Format, length, and language are remembered. Your AI model receives the source and instructions; review the draft before saving.</p>
      </div>
      {phase!=='idle'&&<div className="source-page-result">
        <div className={'source-page-status '+phase} role="status" aria-live="polite">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{(phase==='review'||phase==='completed')&&<Icon name="check"/>}<span>{status}</span></div>
        {phase!=='loading'&&<div className="source-page-preview" ref={preview} aria-label="Generated page preview" aria-busy={running} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;}}>
          {title&&<h3 className="source-page-preview-title">{title}</h3>}
          <ReadOnlyPageBlocks blocks={blocks} entities={[]} pages={[]} vaultId={vaultId} onOpenEntity={()=>{}} onOpenPage={()=>{}}/>
          {running&&<div className="source-page-skeleton" aria-hidden="true"><span/><span/><span/></div>}
          {!running&&!blocks.length&&<p className="section-hint">No page blocks were generated.</p>}
        </div>}
        {(phase==='failed'||phase==='stopped')&&!!blocks.length&&<p className="section-hint">This preview may be incomplete. Retry to recover or generate a complete draft.</p>}
        {draft&&<p className="section-hint">Accept creates an editable page linked to this source. Reject discards this draft without adding a page to your library. Closing keeps it available for later review.</p>}
      </div>}
      {error&&<p className="dialog-error" role="alert">{error}</p>}
    </div>
    <footer className="dialog-actions source-page-actions"><button type="button" className="button" disabled={busy||!!draft} onClick={onSettings}>AI settings</button><div>
      {running?<button type="button" className="button" onClick={stop}>Stop generation</button>:draft?<button type="button" className="button" disabled={busy} onClick={()=>void reject()}>{phase==='rejecting'?'Rejecting…':'Reject'}</button>:<button type="button" className="button" onClick={close} disabled={mutating||opening}>{page?'Close':'Cancel'}</button>}
      {draft&&!running&&<><button type="button" className="button" disabled={busy} onClick={event=>void start(event,true)}>Try again</button><button type="button" className="button" disabled={busy||retryOpen} onClick={()=>setRetryOpen(true)}>Request changes</button></>}
      {page?<button type="button" className="button primary" disabled={opening} onClick={()=>void openPage()}>{opening?'Opening…':'Open page'}</button>:draft?<button type="button" className="button primary" disabled={busy} onClick={()=>void accept()}>{phase==='accepting'?'Accepting…':'Accept page'}</button>:<button className="button primary" disabled={busy}>{running?'Generating draft…':phase==='loading'?'Loading…':phase==='failed'||phase==='stopped'?'Retry':'Generate draft'}</button>}
    </div></footer>
  </form></Modal>;
}
