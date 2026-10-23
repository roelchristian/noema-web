import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {Organization,PageSummary} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {positionAnchoredMenu} from '../components/menu-placement';
import {t as uiText} from '../i18n';
import {CollectionDialog} from './CollectionDialog';

export function CollectionCreatePopover({vaultId,data,pages,disabled,onChanged,empty=false}:{vaultId:string;data:Organization;pages:PageSummary[];disabled:boolean;onChanged:(data:Organization)=>void;empty?:boolean}) {
  const id=useId(),trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[kind,setKind]=useState<'manual'|'smart'|null>(null),[busy,setBusy]=useState(false);
  const label=uiText('Collection actions');
  function close(restoreFocus=false){
    if(busy)return;
    popup.current?.hidePopover();setOpen(false);setKind(null);
    if(restoreFocus)trigger.current?.focus({preventScroll:true});
  }
  useLayoutEffect(()=>{
    if(!open)return;
    const panel=popup.current!,button=trigger.current!;
    if(!panel.matches(':popover-open'))panel.showPopover();
    const position=()=>positionAnchoredMenu(panel,button,{align:'start',minWidth:kind==='smart'?640:kind?340:260,maxHeight:Math.max(240,window.innerHeight-32)});
    position();panel.scrollTop=0;
    panel.querySelector<HTMLElement>(kind?'input':'[role="menuitem"]')?.focus({preventScroll:true});
    const observer=new ResizeObserver(position);observer.observe(panel);
    const moved=(event:Event)=>{if(!panel.contains(event.target as Node))position();};
    window.addEventListener('resize',position);document.addEventListener('scroll',moved,true);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{observer.disconnect();window.removeEventListener('resize',position);document.removeEventListener('scroll',moved,true);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[open,kind]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!popup.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))close();};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open,busy]);
  useEffect(()=>{if(disabled)close();},[disabled]);
  return <>
    <button ref={trigger} type="button" className={empty?'sidebar-create':'sidebar-menu-trigger'} aria-label={label} title={label} aria-haspopup={kind?'dialog':'menu'} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>open?close(true):setOpen(true)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}><Icon name="plus"/>{empty&&uiText('Create a collection')}</button>
    <div ref={popup} id={id} popover="manual" role={kind?'dialog':'menu'} aria-label={kind?uiText(kind==='smart'?'Create Smart Collection':'Add collection'):label} className={'collection-create-popover'+(kind?' is-form':' sidebar-action-menu menu-primitive')} data-menu-size="regular" data-menu-presentation="popup" onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node)&&!trigger.current?.contains(event.relatedTarget as Node))close();}} onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      if(!kind&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();
        const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],index=items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();
      }
    }}>
      {open&&(kind?<CollectionDialog key={kind} vaultId={vaultId} data={data} pages={pages} inline initialKind={kind} onBusyChange={setBusy} onChanged={result=>{onChanged(result);popup.current?.hidePopover();setOpen(false);setKind(null);setBusy(false);trigger.current?.focus({preventScroll:true});}} onClose={()=>{if(!busy)setKind(null);}}/>:<>
        <button type="button" role="menuitem" onClick={()=>setKind('manual')}><Icon name="collection"/><span>{uiText('Add collection')}<small>{uiText('Gather pages and folders by hand')}</small></span></button>
        <button type="button" role="menuitem" onClick={()=>setKind('smart')}><Icon name="sparkles"/><span>{uiText('Create Smart Collection')}<small>{uiText('Bring matching pages together automatically')}</small></span></button>
      </>)}
    </div>
  </>;
}
