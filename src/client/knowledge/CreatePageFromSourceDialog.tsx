import {PersonaSelect,useDefaultPersona} from '../components/PersonaSelect';
import {personaMetadata,personaIdentityName} from '../../shared/ai-personas';
import {getLocale,languageLabel,t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import {sourceDuration,type SourceProcessingProgress} from '../../shared/source-progress';
import {memo,useEffect,useRef,useState,type FormEvent} from 'react';
import type {Block,Entity,Page,Segment} from '../../shared/domain';
import {defaultSourcePageOptions,normalizeSourcePageOptions,sourcePageChoices,sourcePageFormats,sourcePageFormatPresets,sourcePageScope,selectSourcePageFormat,sourcePageLanguages,type SourcePageOptions,type SourcePageRevision,type SourcePageEvent,type SourcePageReview} from '../../shared/source-page';
import {randomUUID} from '../../shared/uuid';
import {readSourcePagePreferences,rememberSourcePagePreferences} from '../state/source-page-preferences';
import {createPageFromSource,request as apiRequest} from '../api';
import {Modal,ModalHeader} from '../components/Modal';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';
import {ReadOnlyPageBlocks} from '../editor/ReadOnlyPageBlocks';
import {formatMarkdownBlocks} from '../editor/markdown-typing';

function previewText(text:string,streaming=false):string {
  const cleaned=text.replace(/[ \t]*\[(?:L:\s*\d+(?:\s*-\s*\d+)?|\?\?)\]/g,'');
  // Keep a citation arriving across multiple deltas out of the live preview too.
  return streaming?cleaned.replace(/[ \t]*\[(?:L(?::[\s\d-]*)?|\?{1,2})$/,''):cleaned;
}
function previewSegments(content:Segment[]):Segment[] {
  return content.flatMap(segment=>{
    if(segment.sourceReference)return [];
    if(segment.text===undefined||segment.code||segment.math)return [segment];
    const text=previewText(segment.text);
    return text?[{...segment,text}]:[];
  });
}
const DraftBlocks=memo(function DraftBlocks({blocks,vaultId}:{blocks:Block[];vaultId:string}) {
  const visible=blocks.map(block=>block.type==='code'||block.type==='math'?block:{...block,content:previewSegments(block.content),...(block.rows?{rows:block.rows.map(row=>row.map(previewSegments))}:{})})
    .filter(block=>block.type!=='paragraph'||block.content.some(segment=>segment.entityId||segment.math||segment.text?.trim()));
  return <ReadOnlyPageBlocks blocks={formatMarkdownBlocks(visible)} entities={[]} pages={[]} vaultId={vaultId} onOpenEntity={()=>{}} onOpenPage={()=>{}}/>;
});
type LiveBlock={blockType:Block['type'];text:string};
const LiveDraftBlock=memo(function LiveDraftBlock({block,vaultId}:{block:LiveBlock;vaultId:string}) {
  const text=block.blockType==='code'||block.blockType==='math'?block.text:previewText(block.text,true);
  const blocks:Block[]=[{id:'source-page-live-preview',type:block.blockType,checked:false,content:[{text}]}];
  return <div className="source-page-live-block" aria-label={uiText("Text still being generated")}><DraftBlocks blocks={blocks} vaultId={vaultId}/></div>;
});

type Phase='loading'|'idle'|'generating'|'review'|'accepting'|'rejecting'|'completed'|'failed'|'stopped';
export function CreatePageFromSourceDialog({vaultId,source,onClose,onCreated,onOpenPage,onSettings}:{vaultId:string;source:Entity;onClose:()=>void;onCreated:(page:Page)=>void;onOpenPage:(id:string)=>Promise<void>;onSettings:()=>void}) {
  const [focus,setFocus]=useState(''),[title,setTitle]=useState(''),[blocks,setBlocks]=useState<Block[]>([]),[phase,setPhase]=useState<Phase>('loading'),[error,setError]=useState(''),[draft,setDraft]=useState<SourcePageReview|null>(null),[page,setPage]=useState<Page|null>(null),[opening,setOpening]=useState(false);
  const inheritedPersona=useDefaultPersona();
  const [personaId,setPersonaId]=useState('');
  const [options,setOptions]=useState<SourcePageOptions>(readSourcePagePreferences);
  const [submitted,setSubmitted]=useState<{options:SourcePageOptions;focus:string}|null>(null);
  const [retryOpen,setRetryOpen]=useState(false),[feedback,setFeedback]=useState('');
  const [liveBlock,setLiveBlock]=useState<LiveBlock|null>(null),[generationStage,setGenerationStage]=useState<'waiting'|'writing'|'checking'|'math'>('waiting');
  const [waitingLonger,setWaitingLonger]=useState(false);
  const [mathProgress,setMathProgress]=useState<SourceProcessingProgress>();
  const [estimate,setEstimate]=useState<{seconds:number;at:number}>();
  const [clock,setClock]=useState(Date.now());
  const startedAt=useRef(Date.now());

  const live=useRef<LiveBlock|null>(null),liveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const feedbackField=useRef<HTMLTextAreaElement>(null);
  const request=useRef<AbortController|null>(null),generation=useRef({id:randomUUID(),settings:''}),preview=useRef<HTMLDivElement>(null),follow=useRef(true),active=useRef(true);
  const running=phase==='generating',mutating=phase==='accepting'||phase==='rejecting',busy=running||mutating||phase==='loading'||opening;
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[running]);
  const route=`entities/${encodeURIComponent(source.id)}/create-page`;
  function clearLive(){if(liveTimer.current!==null)clearTimeout(liveTimer.current);liveTimer.current=null;live.current=null;setLiveBlock(null);}
  function review(value:SourcePageReview){setPersonaId('');setSubmitted({options:normalizeSourcePageOptions(value.options),focus:value.focus});clearLive();generation.current={id:value.id,settings:JSON.stringify([value.focus,value.options??defaultSourcePageOptions])};setOptions(normalizeSourcePageOptions(value.options));setDraft(value);setFocus(value.focus);setTitle(value.title);setBlocks(value.blocks);setPhase('review');setRetryOpen(false);setFeedback('');}
  useEffect(()=>{
    active.current=true;const controller=new AbortController();request.current=controller;
    void apiRequest<{draft:SourcePageReview|null}>(route,'GET',undefined,vaultId,controller.signal).then(result=>{if(active.current&&!controller.signal.aborted){if(result.draft)review(result.draft);else setPhase('idle');}}).catch(error=>{if(active.current&&!controller.signal.aborted){setPhase('failed');setError(error instanceof Error?error.message:'Could not check for an existing draft.');}});
    return()=>{active.current=false;controller.abort();request.current?.abort();if(liveTimer.current!==null)clearTimeout(liveTimer.current);};
  },[vaultId,source.id]);
  useEffect(()=>{if(!preview.current)return;if(phase==='review')preview.current.scrollTop=0;else if(running&&follow.current)preview.current.scrollTop=preview.current.scrollHeight;},[blocks.length,phase,liveBlock?.text]);
  useEffect(()=>{if(retryOpen)feedbackField.current?.focus();},[retryOpen]);
  function close(){if(mutating||opening)return;request.current?.abort();onClose();}
  function stop(){request.current?.abort();clearLive();if(draft){setTitle(draft.title);setBlocks(draft.blocks);setPhase('review');setError('Revision stopped. Your previous draft is still available.');}else{setPhase('stopped');setError('Generation stopped. No page has been created.');}}
  async function start(event:FormEvent,fresh=false) {
    event.preventDefault();if(busy||page||draft&&!retryOpen&&!fresh)return;
    const previousDraft=draft;
    const revision:SourcePageRevision|undefined=previousDraft?{draftId:previousDraft.id,feedback:fresh?'':feedback.trim(),mode:fresh?'retry':'changes'}:undefined;
    setRetryOpen(false);
    const generationOptions=normalizeSourcePageOptions(options);
    rememberSourcePagePreferences(generationOptions);
    if(generationOptions.language==='current-ui')generationOptions.language=getLocale();
    setSubmitted({options:generationOptions,focus:focus.trim()});
    const controller=new AbortController();request.current=controller;
    const settings=JSON.stringify([focus.trim(),generationOptions,personaId,...(revision?[revision]:[])]);
    if(generation.current.settings!==settings)generation.current={id:randomUUID(),settings};
    clearLive();setGenerationStage('waiting');setWaitingLonger(false);setMathProgress(undefined);setEstimate(undefined);startedAt.current=Date.now();setClock(Date.now());
    setPhase('generating');setTitle('');setBlocks([]);setError('');follow.current=true;
    const slowTimer=setTimeout(()=>{if(active.current&&!controller.signal.aborted&&request.current===controller)setWaitingLonger(true);},45000);
    const receivedContent=()=>{clearTimeout(slowTimer);setWaitingLonger(false);};
    const receive=(event:SourcePageEvent)=>{
      if(!active.current||controller.signal.aborted)return;
      if(event.type==='preview_reset'){clearLive();setTitle('');setBlocks([]);return;}
      if(event.type==='title'||event.type==='block'||event.type==='review'||event.type==='completed'||event.type==='block_delta'&&!event.reset&&!!event.delta)receivedContent();
      if(event.type==='estimate')setEstimate({seconds:event.seconds,at:Date.now()});
      else if(event.type==='status'){
        setGenerationStage(event.phase==='preparing_math'?'math':event.phase==='reviewing'?'checking':'waiting');
        setMathProgress(event.progress);
      }
      else if(event.type==='title'){setTitle(event.title);setGenerationStage('writing');}
      else if(event.type==='block_delta'){
        if(event.reset){clearLive();return;}
        setGenerationStage('writing');
        live.current={blockType:event.blockType,text:(live.current?.text??'')+event.delta};
        if(liveTimer.current===null)liveTimer.current=setTimeout(()=>{liveTimer.current=null;if(active.current&&!controller.signal.aborted)setLiveBlock(live.current?{...live.current}:null);},80);
      }
      else if(event.type==='block'){clearLive();setGenerationStage('writing');setBlocks(current=>[...current,event.block]);}
      else if(event.type==='review')review(event.draft);
      else if(event.type==='completed'){clearLive();setPage(event.page);setTitle(event.page.title);setBlocks(event.page.blocks);setPhase('completed');onCreated(event.page);}
    };
    try{await createPageFromSource(vaultId,source.id,focus.trim(),generationOptions,generation.current.id,receive,controller.signal,revision,personaId||undefined);}
    catch(error){if(active.current&&!controller.signal.aborted){clearLive();if(previousDraft){setTitle(previousDraft.title);setBlocks(previousDraft.blocks);setPhase('review');}else setPhase('failed');setError(error instanceof Error?error.message:'Could not generate the page. Please retry.');}}
    finally{clearTimeout(slowTimer);if(request.current===controller)request.current=null;}
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
  async function backToSetup(){
    if(busy||page)return;
    if((draft||blocks.length||liveBlock)&&!window.confirm(uiText("Discard this draft and return to setup? Your settings and instructions will be kept.")))return;
    if(draft){
      setPhase('rejecting');setError('');
      try{
        await apiRequest(route+'/reject','POST',{requestId:draft.id},vaultId,AbortSignal.timeout(30000));
        window.dispatchEvent(new Event('noema:ai-activity'));
      }catch(error){if(active.current){setPhase('review');setError(error instanceof Error?error.message:'Could not discard the draft. Please retry.');}return;}
      if(!active.current)return;
    }
    request.current?.abort();request.current=null;
    clearLive();setDraft(null);setSubmitted(null);setTitle('');setBlocks([]);setRetryOpen(false);setFeedback('');setError('');
    generation.current={id:randomUUID(),settings:''};follow.current=true;setPhase('idle');
  }
  const elapsed=Math.max(0,Math.floor((clock-startedAt.current)/1000));
  const remaining=generationStage==='math'&&mathProgress?.estimatedRemainingSeconds!==undefined
    ?mathProgress.estimatedRemainingSeconds-(clock-mathProgress.updatedAt)/1000
    :estimate&&generationStage!=='math'?estimate.seconds-(clock-estimate.at)/1000:undefined;
  const timing=`${elapsed<60?`${elapsed}s`:`${Math.floor(elapsed/60)}m ${elapsed%60}s`} elapsed`+(remaining===undefined
    ?generationStage==='math'?' · Estimating after the first batch…':' · No reliable time estimate yet.'
    :remaining>0?` · Estimated ${sourceDuration(remaining)} remaining${generationStage==='math'?' for notation':''}`:' · Still working; this is taking longer than estimated.');
  const status=running?(generationStage==='math'?(mathProgress?`Preparing mathematical notation · ${mathProgress.completed} of ${mathProgress.total} batches complete`:'Preparing mathematical notation…'):generationStage==='waiting'?(waitingLonger?'Still reading and planning. Long sources can take a few minutes.':'Reading the source and planning your draft…'):generationStage==='checking'?'Checking references and saving your draft…':`Writing your draft · ${blocks.length} complete ${blocks.length===1?'block':'blocks'}`):phase==='loading'?'Checking for a draft to review…':phase==='accepting'?'Accepting and saving your page…':phase==='rejecting'?'Discarding the draft…':phase==='review'?'Draft ready for review.':phase==='completed'?'Page saved.':phase==='failed'?'Generation could not be completed. Your source is unchanged.':phase==='stopped'?'Generation stopped.':blocks.length?`Writing your draft · ${blocks.length} ${blocks.length===1?'block':'blocks'} received`:'Reading the source and planning your page…';
  const hasPreview=!!submitted||running||!!title||!!blocks.length||!!draft||!!page;
  const controlsDisabled=busy||!!draft||!!page;
  return <Modal className={'source-page-dialog'+(hasPreview?' has-preview':'')} titleId="source-page-title" onClose={close}><form onSubmit={start}>
    <ModalHeader titleId="source-page-title" leading={<Icon name="sparkles"/>} closeDisabled={mutating||opening} closeLabel={running?uiText("Stop generation and close"):uiText("Close dialog")}><span>{uiText("Create page from source")}</span><span className="source-page-header-source" title={source.name}>{source.name}</span></ModalHeader>
    <div className="source-page-body">
      <div className="source-page-controls">
      {submitted?<section className="source-page-request">
      <p className="source-page-eyebrow">{uiText("Your request")}</p>
      <dl className="source-page-selection" aria-label={uiText("Submitted request")}>
        <div className="source-page-request-format"><dt>{uiText("Format")}</dt><dd><span className="source-page-format-mark" aria-hidden="true"><Icon name={submitted.options.format==='study'?'source':submitted.options.format==='explainer'?'lightbulb':submitted.options.format==='critique'?'annotation':submitted.options.format==='custom'?'compose':'page'}/></span><span className="source-page-format-name">{uiText(sourcePageFormats[submitted.options.format].label)}</span><small>{uiText(sourcePageFormats[submitted.options.format].description)}</small></dd></div>
        <div><dt>AI Persona</dt><dd>{(draft?.persona?personaIdentityName(draft.persona):personaMetadata(personaId||inheritedPersona).name)}</dd></div>
        <div><dt>{uiText("Length")}</dt><dd>{uiText(sourcePageChoices.detail.options[submitted.options.detail])}</dd></div>
        <div><dt>{uiText("Output language")}</dt><dd>{submitted.options.language?uiText(/^[a-z]{2,3}(?:-|$)/.test(submitted.options.language)?languageLabel(submitted.options.language):submitted.options.language):uiText("Match Source")}</dd></div>
        <div><dt>{uiText("Reader familiarity")}</dt><dd>{uiText(sourcePageChoices.familiarity.options[submitted.options.familiarity])}</dd></div>
        <div><dt>{uiText("Source scope")}</dt><dd>{submitted.options.beyondSources?uiText("Include AI background knowledge"):uiText("Supplied source only")}</dd></div>
        {submitted.focus&&<div><dt>{submitted.options.format==='custom'?uiText("Your instructions"):uiText("Focus")}</dt><dd>{submitted.focus}</dd></div>}
      </dl>
      </section>:<>
      <fieldset className="source-page-formats"><legend>{uiText("Choose a format")}</legend><div role="group" aria-label={uiText("Page format")}>
        {sourcePageFormatPresets.map(key=>{const format=sourcePageFormats[key];return <button type="button" key={key} className="source-page-format" aria-pressed={options.format===key} disabled={controlsDisabled} onClick={()=>setOptions(current=>selectSourcePageFormat(current,key))}><strong>{uiText(format.label)}</strong><small>{uiText(format.description)}</small></button>;})}
      </div></fieldset>
      <div className="source-page-options source-page-essentials">
        <label className="source-page-option">{uiText("Length")}<Select aria-label={uiText("Length")} value={options.detail} disabled={controlsDisabled} onChange={event=>setOptions(current=>({...current,detail:event.target.value as SourcePageOptions['detail']}))}>{Object.entries(sourcePageChoices.detail.options).map(([value,label])=><option key={value} value={value}>{uiText(label)}</option>)}</Select></label>
        <label className="source-page-option">{uiText("Output language")}<Select aria-label={uiText("Output language")} value={options.language} disabled={controlsDisabled} onChange={event=>setOptions(current=>({...current,language:event.target.value}))}>
          <optgroup label={uiText("Automatic language")}><option value="current-ui">{uiText("Current UI language")}</option>
          <option value="">{uiText("Match Source")}</option></optgroup>
          <optgroup label={uiText("Languages")}>
          {options.language&&options.language!=='current-ui'&&!sourcePageLanguages.some(language=>language===options.language)&&<option value={options.language}>{options.language}</option>}
          {sourcePageLanguages.map(language=><option key={language} value={language}>{uiText(language)}</option>)}
          </optgroup>
        </Select></label>
        <label className="source-page-option">{uiText("Reader familiarity")}<Select aria-label={uiText("Reader familiarity")} value={options.familiarity} disabled={controlsDisabled} onChange={event=>setOptions(current=>({...current,familiarity:event.target.value as SourcePageOptions['familiarity']}))}>{Object.entries(sourcePageChoices.familiarity.options).map(([value,label])=><option key={value} value={value}>{uiText(label)}</option>)}</Select></label>
        <PersonaSelect value={personaId} onChange={setPersonaId} disabled={busy||!!page||(!!draft&&!retryOpen)}/>
      </div>
      <div className="source-page-scope"><div><span id="source-page-scope-label">{uiText("Go beyond sources")}</span><p id="source-page-scope-hint">{options.beyondSources?uiText("Allow clearly labeled AI background knowledge and illustrative examples."):uiText("Use only the supplied source. Any analysis stays grounded in its text.")}</p></div><button type="button" className="source-page-switch" role="switch" aria-checked={options.beyondSources} aria-labelledby="source-page-scope-label" aria-describedby="source-page-scope-hint" disabled={controlsDisabled} onClick={()=>setOptions(current=>sourcePageScope(current,!current.beyondSources))}><span/></button></div>
      <label className="source-page-focus">{options.format==='custom'?uiText("Describe your page"):uiText("Anything to focus on?")} <span>{uiText("Optional")}</span><textarea autoFocus value={focus} onChange={event=>setFocus(event.target.value)} maxLength={2000} rows={2} disabled={controlsDisabled} placeholder={options.format==='custom'?uiText("Describe the note you want to create…"):uiText("Add a topic, question, or emphasis…")} aria-describedby="source-page-focus-hint"/></label>
      <p className="section-hint source-page-note" id="source-page-focus-hint">{uiText("Your settings are remembered. Review the AI draft before saving.")}</p>
      </>}
      {draft&&retryOpen&&<div className="source-page-retry">
        <PersonaSelect original={draft.persona} value={personaId} onChange={setPersonaId} disabled={busy}/><label className="source-page-focus">{uiText("What would you like to change?") + " "}<span>{uiText("Optional")}</span><textarea ref={feedbackField} value={feedback} onChange={event=>setFeedback(event.target.value)} maxLength={2000} rows={3} disabled={busy} placeholder={uiText("For example: make it shorter, explain the key ideas more clearly, or use a different structure.")} aria-describedby="source-page-retry-hint"/></label>
        <p className="section-hint" id="source-page-retry-hint">{uiText("Your current draft is kept until the revision is ready.")}</p>
        <div className="source-page-retry-actions"><button type="button" className="button" disabled={busy} onClick={()=>setRetryOpen(false)}>{uiText("Cancel")}</button><button type="submit" className="button primary" disabled={busy}>{uiText("Generate revision")}</button></div>
      </div>}
      </div>
      {phase!=='idle'&&<div className="source-page-result">
        <div className="source-page-progress">
        <span className="source-page-eyebrow">{running?uiText("Live draft"):uiText("Draft preview")}</span>
        <div className={'source-page-status '+phase} role="status" aria-live="polite">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{(phase==='review'||phase==='completed')&&<Icon name="check"/>}<span>{status}</span></div>
        {running&&<p className="source-page-timing">{timing}</p>}
        {running&&generationStage==='math'&&mathProgress&&<progress value={mathProgress.completed} max={mathProgress.total} aria-label={uiText("Math preparation batches completed")}/>}
        </div>
        {phase!=='loading'&&<div className="source-page-preview" dir="auto" ref={preview} aria-label={uiText("Generated page preview")} aria-busy={running} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<64;}}>
          {title&&<h3 className="source-page-preview-title"><TitleText text={title}/></h3>}
          <DraftBlocks blocks={blocks} vaultId={vaultId}/>
          {running&&liveBlock&&<LiveDraftBlock block={liveBlock} vaultId={vaultId}/>}
          {running&&<div className="source-page-skeleton" aria-hidden="true"><span/><span/><span/></div>}
          {!running&&!blocks.length&&<p className="section-hint">{uiText("No page blocks were generated.")}</p>}
        </div>}
        {running&&<p className="section-hint">{uiText("Keep this dialog open while generating. Citations are hidden in preview.")}</p>}
        {(phase==='failed'||phase==='stopped')&&!!blocks.length&&<p className="section-hint">{uiText("Incomplete preview. Retry to generate a complete draft.")}</p>}
        {draft&&!running&&<p className="section-hint">{uiText("Accept saves a page linked to this source. Closing keeps the draft for later. Back to setup lets you discard it and change your settings.")}</p>}
      </div>}
      {error&&<p className="dialog-error" role="alert">{error}</p>}
    </div>
    <footer className="dialog-actions source-page-actions"><button type="button" className="button" disabled={busy||!!draft} onClick={onSettings}>{uiText("AI settings")}</button><div>
      {running?<button type="button" className="button" onClick={stop}>{uiText("Stop generation")}</button>:hasPreview&&!page?<button type="button" className="button" disabled={busy} onClick={()=>void backToSetup()}>{phase==='rejecting'?uiText("Discarding…"):uiText("Back to setup")}</button>:<button type="button" className="button" onClick={close} disabled={mutating||opening}>{page?uiText("Close"):uiText("Cancel")}</button>}
      {draft&&!running&&<><button type="button" className="button" disabled={busy} onClick={event=>void start(event,true)}>{uiText("Try again")}</button><button type="button" className="button" disabled={busy||retryOpen} onClick={()=>setRetryOpen(true)}>{uiText("Request changes")}</button></>}
      {page?<button type="button" className="button primary" disabled={opening} onClick={()=>void openPage()}>{opening?uiText("Opening…"):uiText("Open page")}</button>:draft?<button type="button" className="button primary" disabled={busy} onClick={()=>void accept()}>{phase==='accepting'?uiText("Accepting…"):uiText("Accept page")}</button>:<button className="button primary" disabled={busy}>{running?uiText("Generating draft…"):phase==='loading'?uiText("Loading…"):phase==='failed'||phase==='stopped'?uiText("Retry"):uiText("Generate draft")}</button>}
    </div></footer>
  </form></Modal>;
}
