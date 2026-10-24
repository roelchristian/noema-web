import {rememberTransliteration,useTransliteration} from '../state/transliteration-preferences';
import {PresentationSelector} from '../settings/PresentationSelector';
import type {PresentationMode} from '../settings/appearance';
import {t as uiText} from '../i18n';
import {PageEditLockDialog} from './PageEditLockDialog';
import { useLayoutEffect, useState } from 'react';
import {createPortal} from 'react-dom';
import type { Block, Page, Organization, Entity, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu, type MenuAction } from '../components/ActionMenu';
import { FeaturedImageDialog } from './FeaturedImageDialog';
import { CleanupDialog } from './CleanupDialog';
import {PageEntityAssociationsDialog} from './PageEntityAssociationsDialog';
import {rememberMarkdownTyping,useMarkdownTyping} from '../state/markdown-preferences';
import {formatMarkdownBlocks} from './markdown-typing';

export function PageToolbar({ onArchive, onRestore, onHistory, onRename, entities, pages, onEntityAssociationsChanged, onOpenEntity, tocAvailable=false, tocVisible=true, onToggleToc, onRevealInSidebar, inactive=false, page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, presentationMode, onPresentationModeChange, onExitFocus, onForward, forwardDisabled, onChangeBlocks, onFeaturedImageChange,onEditLockChange, onUndo, onRedo, canUndo, canRedo}: {
  onHistory?:()=>void;
  onRename?:()=>void;
  pages?:PageSummary[]; entities?:Entity[]; onEntityAssociationsChanged?:()=>Promise<void>; onOpenEntity?:(id:string)=>void;
  tocAvailable?:boolean;tocVisible?:boolean;onToggleToc?:()=>void;
  onRevealInSidebar: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  onEditLockChange:(locked:boolean,password?:string)=>Promise<void>;
  onForward?: () => void; forwardDisabled?: boolean;
  inactive?: boolean;
  onAI: () => void; aiOpen: boolean; presentationMode: PresentationMode; onPresentationModeChange: (mode: PresentationMode) => void; onExitFocus: () => void;
  onArchive?:()=>Promise<void>; onRestore?:()=>Promise<void>;
  favourite: boolean; onOrganizationChange: (data: Organization) => void; page: Page; onDelete: () => Promise<void>;
  onError: (error: unknown) => void;
  onFeaturedImageChange: (imageId: string | null) => void;
  onChangeBlocks: (blocks: Block[]) => void;
}) {
  const [identityTarget,setIdentityTarget]=useState<HTMLElement|null>(null);
  useLayoutEffect(()=>{setIdentityTarget(document.getElementById('page-identity-tools'));},[]);
  const [entityAssociationsOpen,setEntityAssociationsOpen]=useState(false);
  const [lockOpen,setLockOpen]=useState(false);
  const [changingLock,setChangingLock]=useState(false);
  const [saving, setSaving] = useState(false);
  const [featuredImageOpen, setFeaturedImageOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const markdownTyping=useMarkdownTyping();
  const transliterationKey=page.vault_id+'/'+page.id;
  const transliteration=useTransliteration(transliterationKey);
  const editingDisabled=!!page.editLocked||!!page.archived_at||changingLock;
  const contentsLabel=tocVisible?uiText("Hide table of contents"):uiText("Show table of contents");
  function toggleMarkdownTyping() {
    rememberMarkdownTyping(!markdownTyping);
  }
  async function toggleFavourite() {
    if (saving) return;
    setSaving(true);
    try {
      const data = await api.organize(page.vault_id, 'favourites', {kind: 'page', item_id: page.id, favourite: !favourite});
      onOrganizationChange(data);
    } catch (error) { onError(error); }
    finally { setSaving(false); }
  }
  async function changeLock(locked:boolean) {
    if (changingLock) return;
    setChangingLock(true);
    try {await onEditLockChange(locked);} catch(error) {onError(error);}
    finally {setChangingLock(false);}
  }
  const lockAction:MenuAction = page.editLocked
    ? {get label(){return uiText("Unlock editing")},icon:'unlock',disabled:changingLock,children:[
        {label:page.editProtected?uiText("Unlock with password…"):uiText("Unlock editing"),icon:'unlock',onSelect:()=>page.editProtected?setLockOpen(true):void changeLock(false)},
        {label:uiText("Keep locked"),onSelect:()=>{}},
      ]}
    : {get label(){return uiText("Lock editing")},icon:'lock',disabled:changingLock,children:[
        {label:uiText("Without a password"),icon:'lock',description:uiText("Lock editing. The page stays readable."),onSelect:()=>void changeLock(true)},
        {label:uiText("With a password…"),icon:'lock',description:uiText("Require a password to unlock editing."),onSelect:()=>setLockOpen(true)},
      ]};
  const identityControls=<div className="page-toolbar-identity" inert={inactive}>
    <button type="button" className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving||!!page.archived_at} aria-busy={saving} aria-pressed={favourite} aria-label={favourite ? uiText("Remove page from favourites") : uiText("Add page to favourites")} title={favourite ? uiText("Remove from favourites") : uiText("Add to favourites")} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    {page.editLocked && <div className="page-toolbar-lock"><ActionMenu label={uiText("Page locked: unlock editing")} icon="lock" disabled={changingLock} actions={lockAction.children ?? []}/><span aria-hidden="true">{uiText("Locked")}</span></div>}
  </div>;
  return <>{identityTarget?createPortal(identityControls,identityTarget):identityControls}<div inert={inactive} className="page-toolbar" role="group" aria-label={uiText("Page tools")}>
    <div className="page-toolbar-history page-toolbar-secondary" role="group" aria-label={uiText("Editing")}>
      <button type="button" className="page-tool" aria-label={uiText("Undo")} title={uiText("Undo")+' · ⌘/Ctrl+Z'} disabled={editingDisabled||!canUndo} onMouseDown={event=>{if(event.button===0)event.preventDefault();}} onClick={onUndo}><Icon name="undo"/></button>
      <button type="button" className="page-tool" aria-label={uiText("Redo")} title={uiText("Redo")+' · ⌘/Ctrl+Shift+Z'} disabled={editingDisabled||!canRedo} onMouseDown={event=>{if(event.button===0)event.preventDefault();}} onClick={onRedo}><Icon name="redo"/></button>
    </div>
    <div className="page-toolbar-view"><ActionMenu label={uiText("View")} triggerText={uiText("View")} icon="view-list" actions={[
      ...(['standard','subtle','focus'] as const).map(mode=>({id:mode,label:uiText(mode==='standard'?'Standard':mode==='subtle'?'Subtle':presentationMode==='focus'?'Exit Focus':'Focus'),checked:presentationMode===mode,onSelect:()=>mode==='focus'&&presentationMode==='focus'?onExitFocus():onPresentationModeChange(mode)})),
      ...(tocAvailable&&onToggleToc?[{id:'contents',group:uiText("Contents"),label:uiText("Table of contents"),checked:tocVisible,onSelect:onToggleToc}]:[]),
    ]}/></div>
    <PresentationSelector value={presentationMode} onChange={onPresentationModeChange} onExitFocus={onExitFocus}/>
    {tocAvailable&&onToggleToc&&<div className="page-toolbar-reading page-toolbar-secondary" role="group" aria-label={uiText("View")}>
      <button type="button" className="page-tool" aria-label={contentsLabel} title={contentsLabel} aria-pressed={tocVisible} onClick={onToggleToc}><Icon name="view-list"/></button>
    </div>}
    <button type="button" className="page-tool page-tool-labeled knowledge-toggle" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label={uiText("Show page knowledge")} title={uiText("Knowledge")} onClick={onAI}><Icon name="knowledge"/><span>{uiText("Knowledge")}</span></button>
    <ActionMenu label={uiText("More page actions")} disabled={changingLock} actions={[
      {id:'favourite',group:uiText("Page"),label:uiText("Favourite"),icon:'star',checked:favourite,disabled:saving||!!page.archived_at,onSelect:()=>void toggleFavourite()},
      ...(onRename?[{id:'rename',group:uiText("Page"),label:uiText("Rename"),icon:'edit',disabled:editingDisabled,onSelect:onRename}]:[]),
      ...(entities?[{id:'entities',group:uiText("Page"),label:uiText("Connect…"),icon:"knowledge",disabled:editingDisabled,onSelect:()=>setEntityAssociationsOpen(true)}]:[]),
      {id:'featured-image',group:uiText("Page"),label:uiText("Featured image…"),icon:'image',disabled:editingDisabled,onSelect:()=>setFeaturedImageOpen(true)},
      ...(onHistory?[{id:'history',group:uiText("Page"),label:uiText("Version history"),icon:"undo",onSelect:onHistory}]:[]),
      {id:'find',group:uiText("Navigation"),label:uiText("Find in page"),icon:"search",shortcut:"⌘F / Ctrl+F",onSelect:()=>document.dispatchEvent(new Event("noema:document-find"))},
      {id:'reveal',group:uiText("Navigation"),label:uiText("Reveal in sidebar"),icon:'folder',onSelect:onRevealInSidebar},
      ...(onForward?[{id:'forward',group:uiText("Navigation"),label:uiText("Go forward"),icon:'chevron',disabled:forwardDisabled,onSelect:onForward}]:[]),
      ...(tocAvailable&&onToggleToc?[{id:'contents',group:uiText("Navigation"),label:uiText("Table of contents"),icon:'view-list',checked:tocVisible,onSelect:onToggleToc}]:[]),
      {id:'transliteration',group:uiText("Navigation"),label:uiText("Transliteration"),icon:'culture',description:uiText("Greek, Cyrillic, Coptic and Glagolitic · Latin letters, no AI"),children:[
        {label:uiText("Off"),checked:transliteration==='off',onSelect:()=>rememberTransliteration(transliterationKey,'off')},
        {label:uiText("Below paragraphs"),checked:transliteration==='below',onSelect:()=>rememberTransliteration(transliterationKey,'below')},
        {label:uiText("Side by side"),checked:transliteration==='side-by-side',onSelect:()=>rememberTransliteration(transliterationKey,'side-by-side')},
      ]},
      {id:'editing',group:uiText("Editing"),label:uiText("Editing"),icon:'edit',children:[
        {id:'undo',label:uiText("Undo"),icon:'undo',shortcut:"⌘Z / Ctrl+Z",disabled:editingDisabled||!canUndo,onSelect:onUndo},
        {id:'redo',label:uiText("Redo"),icon:'redo',shortcut:"⌘⇧Z / Ctrl+Y",disabled:editingDisabled||!canRedo,onSelect:onRedo},
        {id:'markdown-typing',label:uiText("Markdown shortcuts while typing"),checked:markdownTyping,description:uiText("Preference for future typing. Existing page content stays unchanged."),onSelect:toggleMarkdownTyping},
        {id:'markdown-convert',label:uiText("Format existing Markdown…"),disabled:editingDisabled,description:uiText("Convert Markdown in this page only. Undo restores the previous content."),children:[
          {id:'markdown-apply',label:uiText("Format current page"),description:uiText("Apply Markdown formatting to existing content on this page. You can undo this change."),onSelect:()=>{if(!editingDisabled)onChangeBlocks(formatMarkdownBlocks(page.blocks));}},
          {label:uiText("Keep page unchanged"),onSelect:()=>{}},
        ]},
        {id:'cleanup',label:uiText("Clean up spacing…"),disabled:editingDisabled,onSelect:()=>setCleanupOpen(true)},
      ]},
      {...lockAction,id:'editing-lock',group:uiText("Page management"),disabled:!!page.archived_at||changingLock},
      ...(page.archived_at?[{id:'restore',group:uiText("Page management"),label:uiText("Restore page"),icon:'undo',onSelect:()=>void onRestore?.().catch(onError)}]:[{id:'archive',group:uiText("Page management"),label:uiText("Archive"),icon:'archive',onSelect:()=>void onArchive?.().catch(onError)}]),
      {id:'trash',group:uiText("Page management"),label:uiText("Move to Trash"),icon:'trash',disabled:!!page.editLocked||!!page.archived_at,danger:true,children:[
        {label:uiText("Move to Trash"),icon:'trash',danger:true,description:uiText("You can restore this page within 30 days."),onSelect:()=>{void onDelete().catch(onError);}},
        {label:uiText("Keep page"),onSelect:()=>{}},
      ]},
    ]}/>
  </div>
    {entityAssociationsOpen && <PageEntityAssociationsDialog key={page.vault_id+":"+page.id} page={page} pages={pages} entities={entities??[]} onClose={()=>setEntityAssociationsOpen(false)} onChanged={onEntityAssociationsChanged} onOpenEntity={onOpenEntity}/>}
    {lockOpen && <PageEditLockDialog page={page} onChange={onEditLockChange} onClose={()=>setLockOpen(false)}/>}
    {featuredImageOpen && <FeaturedImageDialog page={page} onChange={onFeaturedImageChange} onClose={() => setFeaturedImageOpen(false)}/>}
    {cleanupOpen && <CleanupDialog blocks={page.blocks} onClose={() => setCleanupOpen(false)} onApply={blocks => { onChangeBlocks(blocks); }}/>}
  </>;
}
