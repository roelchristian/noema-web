import {t as uiText} from '../i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import {positionAnchoredMenu,revealMenuItem} from './menu-placement';

export interface MenuAction {label: string; checked?: boolean; icon?: string; onSelect?: () => void; children?: MenuAction[]; description?: string; disabled?: boolean; danger?: boolean}
export function ActionMenu({label, actions, disabled = false, icon = 'more'}: {label: string; actions: MenuAction[]; disabled?: boolean; icon?: string}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<MenuAction[]>([]);
  const currentActions = path.at(-1)?.children ?? actions;
  const currentLabel = path.at(-1)?.label ?? label;
  const menuMinWidth = 240;
  const restoreAction = useRef<string | null>(null);
  const focusLast = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current!, button = trigger.current!;
    const wasOpen = popup.matches(':popover-open');
    if (!wasOpen) popup.showPopover();
    popup.scrollTop=0;
    if (!positionAnchoredMenu(popup, button, {align:'end',minWidth:menuMinWidth,maxHeight:350})) {popup.hidePopover();setOpen(false);return;}
    if (wasOpen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      popup.getAnimations().forEach(animation=>animation.cancel());
      popup.animate([{opacity:0,transform:'translateY(-4px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:140,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
    const items = popup.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)');
    const restored=restoreAction.current; restoreAction.current=null;
    const item=restored ? [...items].find(item=>item.dataset.menuAction===restored) : focusLast.current ? items[items.length - 1] : items[path.length ? 1 : 0];
    if(item){item.focus({preventScroll:true});revealMenuItem(popup,item);}
  }, [open,path,menuMinWidth]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if(menu.current?.matches(':popover-open') && trigger.current && !positionAnchoredMenu(menu.current,trigger.current,{align:'end',minWidth:menuMinWidth,maxHeight:350})) {menu.current.hidePopover();setOpen(false);}
    };
    const moved = (event: Event) => {if(!menu.current?.contains(event.target as Node))reposition();};
    document.addEventListener('scroll',moved,true);window.addEventListener('resize',reposition);
    window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
    return () => {document.removeEventListener('scroll',moved,true);window.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('scroll',reposition);};
  }, [open,menuMinWidth]);
  function close() { menu.current?.hidePopover(); setOpen(false); setPath([]); }
  function back() {restoreAction.current=path.at(-1)?.label ?? null;setPath(previous=>previous.slice(0,-1));}
  function select(action:MenuAction) {
    if (action.children?.length) {focusLast.current=false;setPath(previous=>[...previous,action]);return;}
    close(); trigger.current?.focus({preventScroll:true}); action.onSelect?.();
  }
  return <>
    <button ref={trigger} className="sidebar-menu-trigger" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { if (open) close(); else { focusLast.current = false; setOpen(true); } }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); }
    }}><Icon name={icon}/></button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={currentLabel} className="sidebar-action-menu menu-primitive" data-menu-size="regular" data-menu-presentation="popup" onToggle={event => { if (!event.currentTarget.matches(':popover-open')) {setOpen(false);setPath([]);} }} onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const focus = (item:HTMLButtonElement|undefined) => {if(item){item.focus({preventScroll:true});revealMenuItem(event.currentTarget,item);}};
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focus(items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focus(event.key === 'Home' ? items[0] : items.at(-1)); }
      else if (event.key === 'ArrowRight') {
        const action=currentActions.find(action=>action.label===(document.activeElement as HTMLElement)?.dataset.menuAction);
        if(action?.children?.length){event.preventDefault();event.stopPropagation();select(action);}
      }
      else if (path.length && (event.key === 'ArrowLeft' || event.key === 'Escape')) {event.preventDefault();event.stopPropagation();back();}
      else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus({preventScroll:true}); }
    }}>{path.length > 0 && <><button type="button" role="menuitem" className="action-menu-back" onClick={back}><Icon name="chevron"/><span>{uiText("Back")}</span></button></>}{currentActions.map(action => <button type="button" key={action.label} data-menu-action={action.label} title={action.description} aria-description={action.description} role={action.checked===undefined?"menuitem":"menuitemcheckbox"} aria-checked={action.checked} aria-haspopup={action.children?.length?'menu':undefined} aria-expanded={action.children?.length?false:undefined} className={action.danger ? 'danger' : ''} disabled={action.disabled} onClick={() => select(action)}>{action.checked!==undefined ? <span aria-hidden="true">{action.checked?"✓":"○"}</span> : action.icon && <Icon name={action.icon}/>}<span className="action-menu-text">{action.label}</span>{action.children?.length&&<span className="action-menu-child-arrow"><Icon name="chevron"/></span>}</button>)}</div>
  </>;
}
