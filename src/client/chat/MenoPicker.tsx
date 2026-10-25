import {useEffect,useRef,useState} from 'react';
import {aiPersonas,personaMetadata,type BuiltinPersonaId} from '../../shared/ai-personas';
import {api} from '../api';
import {Icon} from '../components/Icon';
import {MenoAvatar} from './MenoAvatar';

export function MenoPicker({personaId,disabled,onOpenAISettings}:{personaId:string;disabled?:boolean;onOpenAISettings?:()=>void}) {
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const host=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),pending=useRef(false);
 useEffect(()=>{if(!open)return;const dismiss=(event:PointerEvent)=>{if(!host.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',dismiss);host.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();return()=>document.removeEventListener('pointerdown',dismiss);},[open]);
 async function choose(id:BuiltinPersonaId){
  if(pending.current||disabled)return;
  if(id===personaId){setOpen(false);trigger.current?.focus();return;}
  pending.current=true;setSaving(true);setError('');
  try{await api.saveAIPersona(id);window.dispatchEvent(new Event('noema:persona-preferences'));setOpen(false);trigger.current?.focus();}
  catch(reason){setError(reason instanceof Error?reason.message:'Could not change Meno. Please try again.');}
  finally{pending.current=false;setSaving(false);}
 }
 return <div ref={host} className="meno-picker" onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
  <button ref={trigger} type="button" className="chat-persona-button" aria-label={`Edit Meno · ${personaMetadata(personaId).name}`} aria-expanded={open} aria-haspopup="menu" onClick={()=>setOpen(value=>!value)}>Edit Meno<Icon name="chevron"/></button>
  {open&&<div className="meno-picker-panel"><header><strong>Meet your Meno</strong><p>Seven personalities. Find your kind of company.</p></header><div role="menu" aria-label="Meno personas" aria-busy={saving} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const choices=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));const index=choices.indexOf(document.activeElement as HTMLButtonElement);choices[event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowUp'?-1:1)+choices.length)%choices.length]?.focus();}}>
   {aiPersonas.map(persona=><button key={persona.id} type="button" role="menuitemradio" aria-checked={persona.id===personaId} aria-disabled={saving||disabled} className="meno-persona-option" onClick={()=>void choose(persona.id as BuiltinPersonaId)}><MenoAvatar personaId={persona.id} decorative/><span><strong>{persona.name}</strong><small>{persona.description}</small></span>{persona.id===personaId&&<Icon name="check"/>}</button>)}
  </div><footer><p role="status">{saving?'Changing Meno…':disabled?'Choose a persona when Meno finishes replying.':'Applies to new replies · shared across vaults'}</p>{error&&<p role="alert">{error}</p>}{onOpenAISettings&&<button type="button" onClick={()=>{setOpen(false);onOpenAISettings();}}><Icon name="sliders"/>AI settings<Icon name="chevron"/></button>}</footer></div>}
 </div>;
}
