import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {aiPersonas,defaultPersonaExpression,type BuiltinPersonaId,type PersonaExpression,type PersonaIdentity} from '../../shared/ai-personas';
import type {IntelligencePreferences} from '../../shared/intelligence';

type Feedback='Too similar'|'Too exaggerated'|'Just right';
type Preview={id:BuiltinPersonaId;state:'queued'|'generating'|'completed'|'cancelled'|'error';text?:string;error?:string;persona?:PersonaIdentity;feedback?:Feedback};
const example='A group has an identity element. Combining it with any element leaves that element unchanged. For the integers under addition, zero is the identity: adding zero changes nothing. An inverse has a different role: it combines with an element to produce the identity.';
/** All comparison runs snapshot the same passage, expression, model and effort. */
export function PersonaComparisonStudio({modelSettings,expression=defaultPersonaExpression,onChoose,disabled=false,active=true}:{modelSettings:IntelligencePreferences;expression?:PersonaExpression;onChoose:(id:BuiltinPersonaId,expression:PersonaExpression)=>void;disabled?:boolean;active?:boolean}) {
  const [input,setInput]=useState(example),[selected,setSelected]=useState<BuiltinPersonaId[]>(['oxford_don','tutor']);
  const [previews,setPreviews]=useState<Preview[]>([]),[running,setRunning]=useState(false),[notice,setNotice]=useState('');
  const run=useRef(0),controller=useRef<AbortController|null>(null),cancelled=useRef(new Set<string>());
  const generateButton=useRef<HTMLButtonElement|null>(null),restoreFocus=useRef(false);
  useEffect(()=>{if(!running&&restoreFocus.current){restoreFocus.current=false;generateButton.current?.focus();}},[running]);
  const settingsKey=JSON.stringify({modelSettings,expression});
  function stop(){run.current++;controller.current?.abort();controller.current=null;setRunning(false);setPreviews(values=>values.map(p=>p.state==='queued'||p.state==='generating'?{...p,state:'cancelled'}:p));}
  useEffect(()=>()=>{run.current++;controller.current?.abort();},[]);
  useEffect(()=>{if(!active){restoreFocus.current=false;stop();}},[active]);
  useEffect(()=>{stop();setPreviews([]);setNotice('');},[settingsKey]);
  function changeInput(value:string){stop();setInput(value);setPreviews([]);setNotice('');}
  async function generate(){
    if(!active||running||disabled||!input.trim()||!selected.length)return;
    restoreFocus.current=document.activeElement===generateButton.current;
    const token=++run.current,snapshot={input,modelSettings:{...modelSettings},personaExpression:expression};cancelled.current=new Set();
    setRunning(true);setNotice('');setPreviews(selected.map(id=>({id,state:'queued'})));
    const update=(id:BuiltinPersonaId,value:Partial<Preview>)=>{if(run.current===token)setPreviews(values=>values.map(p=>p.id===id?{...p,...value}:p));};
    for(const id of selected){
      if(run.current!==token)break;if(cancelled.current.has(id))continue;
      const request=new AbortController();controller.current=request;update(id,{state:'generating'});
      try{const value=await api.personaPreview({...snapshot,personaId:id},request.signal);if(request.signal.aborted||cancelled.current.has(id))continue;update(id,{state:'completed',text:value.text,persona:value.persona});}
      catch(error){if(request.signal.aborted)update(id,{state:'cancelled'});else update(id,{state:'error',error:error instanceof Error?error.message:'Could not generate preview.'});}
      finally{if(controller.current===request)controller.current=null;}
    }
    if(run.current===token)setRunning(false);
  }
  function cancel(id:BuiltinPersonaId){cancelled.current.add(id);const preview=previews.find(p=>p.id===id);if(preview?.state==='generating')controller.current?.abort();setPreviews(values=>values.map(p=>p.id===id?{...p,state:'cancelled'}:p));}
  function feedback(id:BuiltinPersonaId,value:Feedback){
    setPreviews(values=>values.map(p=>p.id===id?{...p,feedback:value}:p));
    try{const key='noema:persona-comparison-feedback',old=JSON.parse(localStorage.getItem(key)??'[]');const entries=Array.isArray(old)?old:[];localStorage.setItem(key,JSON.stringify([...entries.slice(-99),{id,expression,...modelSettings,feedback:value,at:new Date().toISOString()}]));setNotice('Feedback saved on this device. Passage and output are not included.');}catch{setNotice('Feedback recorded for this session; device storage is unavailable.');}
  }
  return <section className="persona-studio" aria-labelledby="persona-studio-heading">
    <h4 id="persona-studio-heading">Compare actual AI previews</h4>
    <p id="persona-preview-cost">Generate sends this passage to OpenAI once per selected persona. API charges apply, including possible charges after cancellation. Outputs appear only after you generate; these previews do not establish benchmark quality.</p>
    <label htmlFor="persona-preview-input">Representative authored or sample passage</label>
    <textarea id="persona-preview-input" rows={6} maxLength={6000} value={input} disabled={disabled||running} onChange={event=>changeInput(event.target.value)} aria-describedby="persona-preview-cost"/>
    <p>Do not paste raw source extraction. Previews preserve meaning, evidence, citations and the passage’s language.</p>
    <fieldset disabled={disabled||running}><legend>Personas to compare</legend><div className="persona-studio-choices">{aiPersonas.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id as BuiltinPersonaId)} onChange={()=>{setPreviews([]);setSelected(values=>values.includes(p.id as BuiltinPersonaId)?values.filter(id=>id!==p.id):[...values,p.id as BuiltinPersonaId]);}}/>{p.name}</label>)}</div></fieldset>
    <p>Same input · {modelSettings.model} · {modelSettings.reasoningEffort} reasoning · {expression} expression. Requests run sequentially.</p>
    <div className="persona-studio-actions"><button ref={generateButton} className="button" type="button" disabled={disabled||running||!input.trim()||!selected.length} onClick={()=>void generate()}>{previews.length?'Generate comparison again':'Generate comparison'}</button>{running&&<button className="button" type="button" onClick={stop}>Cancel comparison</button>}</div>
    <div role="status" aria-live="polite">{running?'Generating comparison…':notice|| (previews.length?'Comparison run finished.':'No previews generated.')}</div>
    <div className="persona-studio-results">{previews.map(preview=><article key={preview.id} aria-label={aiPersonas.find(p=>p.id===preview.id)?.name}>
      <h5>{aiPersonas.find(p=>p.id===preview.id)?.name}{preview.persona&&` · v${preview.persona.version}`}</h5><p role={preview.state==='error'?'alert':undefined}>{preview.state==='error'?preview.error:preview.state==='cancelled'?'Cancelled. Dispatched provider outcome and charges may be unknown.':preview.state}</p>
      {(preview.state==='queued'||preview.state==='generating')&&<button type="button" className="button" onClick={()=>cancel(preview.id)}>Cancel {aiPersonas.find(p=>p.id===preview.id)?.name}</button>}
      {preview.state==='completed'&&<><div className="persona-studio-output">{preview.text}</div><div className="persona-studio-feedback" role="group" aria-label={`Feedback for ${aiPersonas.find(p=>p.id===preview.id)?.name}`}>{(['Too similar','Too exaggerated','Just right'] as const).map(value=><button type="button" className="button" key={value} aria-pressed={preview.feedback===value} onClick={()=>feedback(preview.id,value)}>{value}</button>)}</div><button type="button" className="button" disabled={disabled} onClick={()=>{onChoose(preview.id,expression);setNotice('Default selected. Click Done to save your changes.');}}>Use {aiPersonas.find(p=>p.id===preview.id)?.name} as default</button></>}
    </article>)}</div>
  </section>;
}
