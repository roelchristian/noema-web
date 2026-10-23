import {t as uiText} from '../i18n';
import {useEffect, useId, useRef, useState} from 'react';
import type { EntityType } from '../../shared/domain';
import {subtypeDisplayName, type EntitySubtype } from '../../shared/entity-schema';
import {Icon} from '../components/Icon';

export function SubtypePicker({type, value, subtypes, onChange, disabled,compact=false}: {type: EntityType; value: string[]; subtypes: EntitySubtype[]; onChange: (value: string[]) => void; disabled?: boolean;compact?:boolean}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const root = useRef<HTMLFieldSetElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId();
  const options = subtypes.filter(subtype => subtype.type === type);
  const selected = options.filter(subtype => value.includes(subtype.id));
  const filtered = options.filter(subtype => subtype.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {setOpen(false); setQuery('');}, [type, disabled]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function outside(event: PointerEvent) {if (!root.current?.contains(event.target as Node)) setOpen(false);}
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <fieldset ref={root} className="subtype-picker" disabled={disabled} onKeyDown={event => {
    if (event.key === 'Escape' && open) {event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();}
  }}>
    <legend>{uiText("Subtypes") + " "}<span className="subtype-optional">{uiText("Optional")}</span></legend>
    <button ref={trigger} type="button" className="subtype-trigger" aria-expanded={open} aria-controls={id} aria-describedby={compact?undefined:id+'-hint'} aria-label={uiText("Choose subtypes")+(selected.length?': '+selected.map(subtype=>subtypeDisplayName(subtype,options)).join(', '):'')} disabled={disabled || !options.length} onClick={() => {setQuery(''); setOpen(!open);}}>
      <span>{selected.length ? selected.map(subtype => subtypeDisplayName(subtype,options)).join(', ') : options.length ? uiText("Select subtypes…") : uiText("No subtypes available")}</span>
      {!!selected.length && <small>{selected.length}</small>}<Icon name="chevron"/>
    </button>
    {open && <div id={id} className="subtype-dropdown" role="group" aria-label={uiText("Choose subtypes")}>
      <div className="subtype-search"><Icon name="search"/><input ref={search} type="search" aria-label={uiText("Search subtypes")} placeholder={uiText("Search subtypes…")} value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();if(event.key==='ArrowDown'){event.preventDefault();root.current?.querySelector<HTMLButtonElement>('.subtype-option')?.focus();}}}/></div>
      <div className="subtype-options">{filtered.map(subtype => <button type="button" role="checkbox" aria-checked={value.includes(subtype.id)} className="subtype-option" title={subtype.description} key={subtype.id} disabled={disabled} onClick={() => onChange(value.includes(subtype.id) ? value.filter(id => id !== subtype.id) : [...value, subtype.id])}><span className="subtype-option-check" aria-hidden="true">{value.includes(subtype.id) && <Icon name="check"/>}</span><span>{subtypeDisplayName(subtype,options)}</span></button>)}{!filtered.length && <p className="subtype-empty">{uiText("No matching subtypes.")}</p>}</div>
      <div className="subtype-dropdown-footer"><span>{selected.length}{" " + uiText("selected")}</span><button type="button" disabled={!selected.length} onClick={()=>onChange([])}>{uiText("Clear selection")}</button><button type="button" onClick={()=>{setOpen(false);trigger.current?.focus();}}>{uiText("Done")}</button></div>
    </div>}
    {!compact&&<p className="section-hint" id={id+'-hint'}>{!options.length ? uiText("Add subtypes in Settings → Knowledge Entities.") : type === 'organism' ? uiText("Choose a biological group and Taxon or Individual, as applicable.") : type === 'culture' ? uiText("Choose Language, Nationality or Cultural Tradition, as applicable.") : uiText("Select all that apply. Each subtype adds its shared fields.")}</p>}
  </fieldset>;
}
