import {useEffect,useState} from 'react';
import {aiPersonas,defaultPersonaId,personaMetadata,personaIdentityName,type PersonaIdentity} from '../../shared/ai-personas';
import {api} from '../api';
import {Select} from './Select';
export function useDefaultPersona() {
  const [inherited,setInherited]=useState(defaultPersonaId);
  useEffect(()=>{let active=true;const refresh=()=>{void api.intelligence().then(p=>{if(active)setInherited(p.personaId??defaultPersonaId);}).catch(()=>{});};refresh();window.addEventListener('noema:persona-preferences',refresh);return()=>{active=false;window.removeEventListener('noema:persona-preferences',refresh);};},[]);
  return inherited;
}
export function PersonaSelect({value,onChange,disabled=false,original}:{original?:PersonaIdentity;value:string;onChange:(id:string)=>void;disabled?:boolean}) {
  const inherited=useDefaultPersona();
  return <label className="persona-select" title={value?"Applies to this request only; your default is unchanged.":original?"Uses the original draft’s persona and version.":"Inherits your global default persona."}>Persona:<Select aria-label="Persona" value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">{original?`Original · ${personaIdentityName(original)} · v${original.version}`:`${personaMetadata(inherited).name} (default)`}</option>{aiPersonas.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>;
}
