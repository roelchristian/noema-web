import {useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Select} from './Select';
import {LibraryDensitySwitch, type LibraryDensity} from './LibraryDensitySwitch';
import {Icon} from './Icon';
import {positionAnchoredMenu} from './menu-placement';
import {t as uiText} from '../i18n';

/** Common order across destinations; lifecycle actions remain owned by the caller. */
export function LibraryToolbar({filter, sort, onSort, density, onDensity, group, onGroup, children, disabled=false, typeSort=false, dateLabel='Modified'}: {
  filter?:ReactNode; sort:string; onSort:(sort:string)=>void; density:LibraryDensity; onDensity:(density:LibraryDensity)=>void;
  group?:boolean; onGroup?:(group:boolean)=>void; children?:ReactNode; disabled?:boolean; typeSort?:boolean; dateLabel?:string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId(), titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  function close(restoreFocus = false) {
    popup.current?.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({preventScroll:true});
  }
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const panel = popup.current;
    panel.showPopover();
    if (!positionAnchoredMenu(panel, trigger.current, {align:'end',minWidth:280,maxHeight:460})) {close();return;}
    panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({preventScroll:true});
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (popup.current?.matches(':popover-open') && trigger.current && !positionAnchoredMenu(popup.current, trigger.current, {align:'end',minWidth:280,maxHeight:460})) close();
    };
    const moved = (event:Event) => {if (!popup.current?.contains(event.target as Node)) reposition();};
    document.addEventListener('scroll',moved,true);
    window.addEventListener('resize',reposition);
    window.visualViewport?.addEventListener('resize',reposition);
    window.visualViewport?.addEventListener('scroll',reposition);
    const observer = new ResizeObserver(reposition);
    if (popup.current) observer.observe(popup.current);
    return () => {
      document.removeEventListener('scroll',moved,true);
      window.removeEventListener('resize',reposition);
      window.visualViewport?.removeEventListener('resize',reposition);
      window.visualViewport?.removeEventListener('scroll',reposition);
      observer.disconnect();
    };
  }, [open]);
  useEffect(() => {if (disabled) close();}, [disabled]);
  return <div className="library-toolbar" role="group" aria-label="Library controls">
    {filter}
    <Select disabled={disabled} aria-label="Sort library" value={sort} onChange={event=>onSort(event.target.value)}>
      <option value="modified-desc">{dateLabel} · newest first</option><option value="modified-asc">{dateLabel} · oldest first</option>
      <option value="title-asc">Name · A–Z</option><option value="title-desc">Name · Z–A</option>
      {typeSort&&<><option value="type-asc">Type · A–Z</option><option value="type-desc">Type · Z–A</option></>}
    </Select>
    <button ref={trigger} className="library-view-options-trigger" type="button" title={uiText("View options")} aria-label={uiText("View options")} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => open ? close() : setOpen(true)}><Icon name="sliders"/></button>
    <div ref={popup} id={id} className="library-view-options" popover="auto" role="dialog" aria-labelledby={titleId} onToggle={event => {if (!event.currentTarget.matches(':popover-open')) setOpen(false);}} onKeyDown={event => {
      if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();close(true);}
    }}>
      <div id={titleId} className="library-view-options-title">{uiText("View options")}</div>
      <div className="library-view-options-section"><span>{uiText("Density")}</span><LibraryDensitySwitch disabled={disabled} value={density} onChange={onDensity}/></div>
      {onGroup&&<label className="library-group"><input type="checkbox" disabled={disabled} checked={group} onChange={event=>onGroup(event.target.checked)}/>{uiText("Group folders first")}</label>}
      {children&&<div className="library-view-options-secondary">{children}</div>}
    </div>
  </div>;
}
