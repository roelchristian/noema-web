import {useId,useRef,useState} from 'react';
import {normalizeEntityName} from '../../shared/auto-entities';
import {Icon} from '../components/Icon';

export function AliasInput({value, onChange, disabled,compact=false,maxAliases=100}: {value: string; onChange: (value: string) => void; disabled?: boolean;compact?:boolean;maxAliases?:number}) {
  const [draft,setDraft]=useState(''),[notice,setNotice]=useState('');
  const id=useId(),input=useRef<HTMLInputElement>(null),aliases=parseAliases(value);
  const alias=draft.trim().replace(/\s+/g,' ');
  const duplicate=!!alias&&aliases.some(item=>normalizeEntityName(item)===normalizeEntityName(alias));
  const full=aliases.length>=maxAliases;
  function add() {
    if(disabled||!alias||duplicate||full)return;
    onChange([...aliases,alias].join('\n'));
    setDraft('');setNotice(`Added ${alias}.`);input.current?.focus();
  }
  function remove(index:number) {
    if(disabled)return;
    onChange(aliases.filter((_,position)=>position!==index).join('\n'));
    setNotice(`Removed ${aliases[index]}.`);input.current?.focus();
  }
  return <div className="entity-alias-input" role="group" aria-labelledby={id+'-label'}>
    <label id={id+'-label'} htmlFor={id}>Aliases</label>
    {!!aliases.length&&<ul className="entity-alias-list" aria-label="Current aliases">{aliases.map((item,index)=><li key={item+'-'+index}><span>{item}</span><button type="button" disabled={disabled} aria-label={`Remove alias ${item}`} title="Remove alias" onClick={()=>remove(index)}><Icon name="close"/></button></li>)}</ul>}
    <div className="entity-alias-add"><input ref={input} id={id} type="text" autoComplete="off" placeholder="Add an alias…" maxLength={200} value={draft} disabled={disabled||full} aria-describedby={id+'-help'} onChange={event=>{setDraft(event.target.value);setNotice('');}} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();add();}}}/><button type="button" disabled={disabled||!alias||duplicate||full} onClick={add} aria-label="Add alias"><Icon name="plus"/>Add</button></div>
    <small id={id+'-help'}>{duplicate?'This alias is already listed.':full?`Maximum of ${maxAliases} aliases.`:compact?'Press Enter or Add to include an alias.':'Press Enter or Add to include an alias. Aliases may be shared by multiple entities.'}</small>
    <span className="sr-only" role="status">{notice}</span>
  </div>;
}
export const parseAliases = (value: string) => value.split('\n').map(alias => alias.trim()).filter(Boolean);
