import {PageEditLockDialog} from './PageEditLockDialog';
import { useState } from 'react';
import type { Block, Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu, type MenuAction } from '../components/ActionMenu';
import { FeaturedImageDialog } from './FeaturedImageDialog';
import { CleanupDialog } from './CleanupDialog';

export function PageToolbar({ inactive=false, page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, focusedReading, onToggleFocusedReading, onForward, forwardDisabled, onChangeBlocks, onFeaturedImageChange,onEditLockChange}: {
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
  const [cleanupUndo, setCleanupUndo] = useState<{before: Block[]; after: Block[]} | null>(null);
  const canUndoCleanup = !!cleanupUndo && JSON.stringify(page.blocks) === JSON.stringify(cleanupUndo.after);
  const cleanupActions = [
    {label: 'Clean up spacing…', icon: 'edit', disabled:!!page.editLocked, onSelect: () => setCleanupOpen(true)},
    ...(cleanupUndo ? [{label: 'Undo last cleanup', icon: 'recent', disabled: !!page.editLocked || !canUndoCleanup, onSelect: () => { if (cleanupUndo && canUndoCleanup) { onChangeBlocks(cleanupUndo.before); setCleanupUndo(null); } }}] : []),
  ];
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
    ? {label:'Unlock editing',icon:'lock',disabled:changingLock,children:[
        {label:page.editProtected?'Unlock with password…':'Unlock editing',icon:'unlock',onSelect:()=>page.editProtected?setLockOpen(true):void changeLock(false)},
        {label:'Keep locked',onSelect:()=>{}},
      ]}
    : {label:'Lock editing',icon:'unlock',disabled:changingLock,children:[
        {label:'Without a password',icon:'lock',description:'Lock editing. The page stays readable.',onSelect:()=>void changeLock(true)},
        {label:'With a password…',icon:'lock',description:'Require a password to unlock editing.',onSelect:()=>setLockOpen(true)},
      ]};
  return <><div inert={inactive} className="page-toolbar" role="group" aria-label="Page tools">
    <button type="button" className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving} aria-pressed={favourite} aria-label={favourite ? 'Remove page from favourites' : 'Add page to favourites'} title={favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    <button type="button" className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label="Knowledge" title="Knowledge" onClick={onAI}><Icon name="knowledge"/></button>
    {page.editLocked && <ActionMenu label="Page locked: unlock editing" icon="lock" disabled={changingLock} actions={lockAction.children ?? []}/>}
    <ActionMenu label="More page actions" disabled={changingLock} actions={[
      ...(onForward ? [{label: 'Go forward', icon: 'chevron', disabled: forwardDisabled, onSelect: onForward}] : []),
      {label: focusedReading ? 'Turn off focused reading' : 'Turn on focused reading', icon: 'creativework', onSelect: onToggleFocusedReading},
      {label: 'Featured image…', icon: 'image', disabled:!!page.editLocked, onSelect: () => setFeaturedImageOpen(true)},
      ...cleanupActions,
      lockAction,
      {label:'Move to Trash',icon:'trash',disabled:!!page.editLocked,danger:true,children:[
        {label:'Move to Trash',icon:'trash',danger:true,description:'You can restore this note within 30 days.',onSelect:()=>{void onDelete().catch(onError);}},
        {label:'Keep note',onSelect:()=>{}},
      ]},
    ]}/>
  </div>
    {lockOpen && <PageEditLockDialog page={page} onChange={onEditLockChange} onClose={()=>setLockOpen(false)}/>}
    {featuredImageOpen && <FeaturedImageDialog page={page} onChange={onFeaturedImageChange} onClose={() => setFeaturedImageOpen(false)}/>}
    {cleanupOpen && <CleanupDialog blocks={page.blocks} onClose={() => setCleanupOpen(false)} onApply={blocks => { setCleanupUndo({before: page.blocks, after: blocks}); onChangeBlocks(blocks); }}/>}
  </>;
}
