import {t as uiText} from '../i18n';
import {PageEditLockDialog} from './PageEditLockDialog';
import { useState } from 'react';
import type { Block, Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu, type MenuAction } from '../components/ActionMenu';
import { FeaturedImageDialog } from './FeaturedImageDialog';
import { CleanupDialog } from './CleanupDialog';
import {rememberMarkdownTyping,useMarkdownTyping} from '../state/markdown-preferences';
import {formatMarkdownBlocks} from './markdown-typing';

export function PageToolbar({ tocAvailable=false, tocVisible=true, onToggleToc, onRevealInSidebar, inactive=false, page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, focusedReading, onToggleFocusedReading, onForward, forwardDisabled, onChangeBlocks, onFeaturedImageChange,onEditLockChange, onUndo, onRedo, canUndo, canRedo}: {
  tocAvailable?:boolean;tocVisible?:boolean;onToggleToc?:()=>void;
  onRevealInSidebar: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  onEditLockChange:(locked:boolean,password?:string)=>Promise<void>;
  onForward?: () => void; forwardDisabled?: boolean;
  inactive?: boolean;
  onAI: () => void; aiOpen: boolean; focusedReading: boolean; onToggleFocusedReading: () => void;
  favourite: boolean; onOrganizationChange: (data: Organization) => void; page: Page; onDelete: () => Promise<void>;
  onError: (error: unknown) => void;
  onFeaturedImageChange: (imageId: string | null) => void;
  onChangeBlocks: (blocks: Block[]) => void;
}) {
  const [lockOpen,setLockOpen]=useState(false);
  const [changingLock,setChangingLock]=useState(false);
  const [saving, setSaving] = useState(false);
  const [featuredImageOpen, setFeaturedImageOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const markdownTyping=useMarkdownTyping();
  function toggleMarkdownTyping() {
    if(!markdownTyping)onChangeBlocks(formatMarkdownBlocks(page.blocks));
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
    ? {get label(){return uiText("Unlock editing")},icon:'lock',disabled:changingLock,children:[
        {label:page.editProtected?uiText("Unlock with password…"):uiText("Unlock editing"),icon:'unlock',onSelect:()=>page.editProtected?setLockOpen(true):void changeLock(false)},
        {label:uiText("Keep locked"),onSelect:()=>{}},
      ]}
    : {get label(){return uiText("Lock editing")},icon:'unlock',disabled:changingLock,children:[
        {label:uiText("Without a password"),icon:'lock',description:uiText("Lock editing. The page stays readable."),onSelect:()=>void changeLock(true)},
        {label:uiText("With a password…"),icon:'lock',description:uiText("Require a password to unlock editing."),onSelect:()=>setLockOpen(true)},
      ]};
  return <><div inert={inactive} className="page-toolbar" role="group" aria-label={uiText("Page tools")}>
    <button type="button" className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving} aria-pressed={favourite} aria-label={favourite ? uiText("Remove page from favourites") : uiText("Add page to favourites")} title={favourite ? uiText("Remove from favourites") : uiText("Add to favourites")} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    <button type="button" className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label={uiText("Knowledge")} title={uiText("Knowledge")} onClick={onAI}><Icon name="knowledge"/></button>
    {page.editLocked && <ActionMenu label={uiText("Page locked: unlock editing")} icon="lock" disabled={changingLock} actions={lockAction.children ?? []}/>}
    <ActionMenu label={uiText("More page actions")} disabled={changingLock} actions={[
      ...(onForward ? [{get label(){return uiText("Go forward")}, icon: 'chevron', disabled: forwardDisabled, onSelect: onForward}] : []),
      {label: uiText("Reveal in sidebar"), icon: 'folder', onSelect: onRevealInSidebar},
      {label: focusedReading ? uiText("Turn off focused reading") : uiText("Turn on focused reading"), icon: 'creativework', onSelect: onToggleFocusedReading},
      ...(tocAvailable&&onToggleToc?[{label:tocVisible?uiText("Hide table of contents"):uiText("Show table of contents"),icon:'menu',checked:tocVisible,onSelect:onToggleToc}]:[]),
      {label: uiText("Featured image…"), icon: 'image', disabled:!!page.editLocked, onSelect: () => setFeaturedImageOpen(true)},
      {get label(){return uiText("Editing")}, icon: 'edit', disabled: !!page.editLocked, children: [
        {label: uiText("Undo"), description: uiText("⌘/Ctrl+Z"), disabled: !canUndo, onSelect: onUndo},
        {label: uiText("Redo"), description: uiText("⌘/Ctrl+Shift+Z or Ctrl+Y"), disabled: !canRedo, onSelect: onRedo},
        {label: uiText("Format Markdown as you type"), checked:markdownTyping, description:markdownTyping?uiText("On · Turning off keeps existing formatting."):uiText("Off · Turning on also formats Markdown already in this page."), onSelect:toggleMarkdownTyping},
        {label: uiText("Clean up spacing…"), onSelect: () => setCleanupOpen(true)},
      ]},
      lockAction,
      {label:uiText("Move to Trash"),icon:'trash',disabled:!!page.editLocked,danger:true,children:[
        {label:uiText("Move to Trash"),icon:'trash',danger:true,description:uiText("You can restore this note within 30 days."),onSelect:()=>{void onDelete().catch(onError);}},
        {label:uiText("Keep note"),onSelect:()=>{}},
      ]},
    ]}/>
  </div>
    {lockOpen && <PageEditLockDialog page={page} onChange={onEditLockChange} onClose={()=>setLockOpen(false)}/>}
    {featuredImageOpen && <FeaturedImageDialog page={page} onChange={onFeaturedImageChange} onClose={() => setFeaturedImageOpen(false)}/>}
    {cleanupOpen && <CleanupDialog blocks={page.blocks} onClose={() => setCleanupOpen(false)} onApply={blocks => { onChangeBlocks(blocks); }}/>}
  </>;
}
