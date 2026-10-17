import { useState } from 'react';
import type { Block, Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';
import { FeaturedImageDialog } from './FeaturedImageDialog';
import { CleanupDialog } from './CleanupDialog';

export function PageToolbar({mobile=false, inactive=false, page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, focusedReading, onToggleFocusedReading, onForward, forwardDisabled, onChangeBlocks, onFeaturedImageChange}: {
  mobile?: boolean;
  onForward?: () => void; forwardDisabled?: boolean;
  inactive?: boolean;
  onAI: () => void; aiOpen: boolean; focusedReading: boolean; onToggleFocusedReading: () => void;
  favourite: boolean; onOrganizationChange: (data: Organization) => void; page: Page; onDelete: () => void;
  onError: (error: unknown) => void;
  onFeaturedImageChange: (imageId: string | null) => void;
  onChangeBlocks: (blocks: Block[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [featuredImageOpen, setFeaturedImageOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupUndo, setCleanupUndo] = useState<{before: Block[]; after: Block[]} | null>(null);
  const canUndoCleanup = !!cleanupUndo && JSON.stringify(page.blocks) === JSON.stringify(cleanupUndo.after);
  const cleanupActions = [
    {label: 'Clean up spacing…', icon: 'edit', onSelect: () => setCleanupOpen(true)},
    ...(cleanupUndo ? [{label: 'Undo last cleanup', icon: 'recent', disabled: !canUndoCleanup, onSelect: () => { if (cleanupUndo && canUndoCleanup) { onChangeBlocks(cleanupUndo.before); setCleanupUndo(null); } }}] : []),
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
  return <><div inert={inactive} className="page-toolbar" role="group" aria-label="Page tools">
    {!mobile && <>
      <button className="page-tool focused-reading-button" aria-label="Focused reading" aria-pressed={focusedReading} title={focusedReading ? 'Turn off focused reading' : 'Turn on focused reading'} onClick={onToggleFocusedReading}><Icon name="creativework"/></button>
      <button className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving} aria-pressed={favourite} aria-label={favourite ? 'Remove page from favourites' : 'Add page to favourites'} title={favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    </>}
    <button className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label="Knowledge" title="Knowledge" onClick={onAI}><Icon name="knowledge"/></button>
    {mobile ? <ActionMenu label="More page actions" actions={[
      ...(onForward ? [{label: 'Go forward', icon: 'chevron', disabled: forwardDisabled, onSelect: onForward}] : []),
      {label: focusedReading ? 'Turn off focused reading' : 'Turn on focused reading', icon: 'creativework', onSelect: onToggleFocusedReading},
      {label: favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', disabled: saving, onSelect: () => void toggleFavourite()},
      {label: 'Featured image…', icon: 'image', onSelect: () => setFeaturedImageOpen(true)},
      ...cleanupActions,
      {label: 'Move to Trash', icon: 'trash', danger: true, onSelect: onDelete},
    ]}/> : <><button type="button" className="page-tool" aria-label="Featured image" title="Featured image" aria-haspopup="dialog" onClick={() => setFeaturedImageOpen(true)}><Icon name="image"/></button><ActionMenu label="Clean up note" icon="edit" actions={cleanupActions}/><button className="page-tool" aria-label="Move note to Trash" title="Move to Trash" onClick={onDelete}><Icon name="trash"/></button></>}
  </div>
    {featuredImageOpen && <FeaturedImageDialog page={page} onChange={onFeaturedImageChange} onClose={() => setFeaturedImageOpen(false)}/>}
    {cleanupOpen && <CleanupDialog blocks={page.blocks} onClose={() => setCleanupOpen(false)} onApply={blocks => { setCleanupUndo({before: page.blocks, after: blocks}); onChangeBlocks(blocks); }}/>}
  </>;
}
