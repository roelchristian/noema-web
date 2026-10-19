import {t as uiText} from '../i18n';
import {useEffect, useId, useRef, useState} from 'react';
import {DOMAINS, domainPath} from '../../shared/domains';
import {Icon} from '../components/Icon';

export function domainBreadcrumb(id: string): string {
  return domainPath(id).map(domain => domain.label).join(' → ') || id;
}

/** Browse one branch at a time; search always covers the complete fixed registry. */
export function DomainPicker({value, onChange, disabled, label = 'Disciplines', max}: {value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; label?: string; max?: number}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [branch, setBranch] = useState<string | null>(null);
  const root = useRef<HTMLFieldSetElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId();
  const filtered = DOMAINS.filter(domain => query.trim() ? domainBreadcrumb(domain.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) : domain.parent_id === branch);
  useEffect(() => {if (disabled) setOpen(false);}, [disabled]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {if (!root.current?.contains(event.target as Node)) setOpen(false);};
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function toggle(domainId: string) {onChange(value.includes(domainId) ? value.filter(id => id !== domainId) : max === 1 ? [domainId] : [...value, domainId]);}
  return <fieldset ref={root} className="subtype-picker domain-picker" disabled={disabled} onKeyDown={event => {if (event.key === 'Escape' && open) {event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <legend>{label}<span className="subtype-optional">{uiText("Optional")}</span></legend>
    <button ref={trigger} type="button" className="subtype-trigger" aria-label={uiText("Choose ")+label.toLowerCase()} aria-expanded={open} aria-controls={id} onClick={() => {setOpen(!open);setQuery('');setBranch(null);}}><span>{value.length ? value.map(domainBreadcrumb).join(' · ') : uiText("Select ")+label.toLowerCase()+'…'}</span><Icon name="chevron"/></button>
    {open && <div className="subtype-dropdown domain-dropdown" id={id} role="group" aria-label={label}>
      <div className="subtype-search"><Icon name="search"/><input ref={search} type="search" value={query} placeholder={uiText("Search subjects…")} aria-label={uiText("Search ")+label.toLowerCase()} onChange={event => setQuery(event.target.value)} onKeyDown={event => {if(event.key === 'Enter')event.preventDefault();}}/></div>
      {!query.trim() && <div className="domain-breadcrumb"><button type="button" onClick={() => setBranch(null)}>{uiText("All subjects")}</button>{branch && <><span>→ {domainBreadcrumb(branch)}</span><button type="button" onClick={() => setBranch(DOMAINS.find(domain => domain.id === branch)?.parent_id ?? null)}>{uiText("Back")}</button></>}</div>}
      <div className="subtype-options">{filtered.map(domain => <div className="domain-option-row" key={domain.id}><button type="button" role="checkbox" aria-checked={value.includes(domain.id)} className="subtype-option" title={domainBreadcrumb(domain.id)} disabled={!value.includes(domain.id) && max !== 1 && max !== undefined && value.length >= max} onClick={() => toggle(domain.id)}><span className="subtype-option-check" aria-hidden="true">{value.includes(domain.id) && <Icon name="check"/>}</span><span>{query.trim() ? domainBreadcrumb(domain.id) : domain.label}</span></button>{DOMAINS.some(child => child.parent_id === domain.id) && <button type="button" className="domain-expand" aria-label={uiText("Browse ")+domain.label} onClick={() => {setQuery('');setBranch(domain.id);}}><Icon name="chevron"/></button>}</div>)}{!filtered.length && <p className="subtype-empty">{uiText("No matching subjects.")}</p>}</div>
      <div className="subtype-dropdown-footer"><span>{value.length}{" " + uiText("selected")}{max && max > 1 ? uiText(" · up to ")+max : ''}</span><button type="button" disabled={!value.length} onClick={() => onChange([])}>{uiText("Clear")}</button><button type="button" onClick={() => {setOpen(false);trigger.current?.focus();}}>{uiText("Done")}</button></div>
    </div>}
    {!!value.length && <div className="domain-selection">{value.map(domainId => <span key={domainId}>{domainBreadcrumb(domainId)}<button type="button" aria-label={uiText("Remove ")+domainBreadcrumb(domainId)} onClick={() => onChange(value.filter(id => id !== domainId))}>×</button></span>)}</div>}
  </fieldset>;
}
