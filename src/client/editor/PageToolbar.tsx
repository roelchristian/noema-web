import { useState } from 'react';
import type { Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';

export function PageToolbar({mobile=false, inactive=false, page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, focusedReading, onToggleFocusedReading, onForward, forwardDisabled}: {
  mobile?: boolean;
  onForward?: () => void; forwardDisabled?: boolean;
  inactive?: boolean;
  onAI: () => void; aiOpen: boolean; focusedReading: boolean; onToggleFocusedReading: () => void;
  favourite: boolean; onOrganizationChange: (data: Organization) => void; page: Page; onDelete: () => void;
  onError: (error: unknown) => void;
}) {
  const [saving, setSaving] = useState(false);
  async function toggleFavourite() {
    if (saving) return;
    setSaving(true);
    try {
      const data = await api.organize(page.vault_id, 'favourites', {kind: 'page', item_id: page.id, favourite: !favourite});
      onOrganizationChange(data);
    } catch (error) { onError(error); }
    finally { setSaving(false); }
  }
  return <div inert={inactive} className="page-toolbar" role="group" aria-label="Page tools">
    {!mobile && <>
      <button className="page-tool focused-reading-button" aria-label="Focused reading" aria-pressed={focusedReading} title={focusedReading ? 'Turn off focused reading' : 'Turn on focused reading'} onClick={onToggleFocusedReading}><Icon name="creativework"/></button>
      <button className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving} aria-pressed={favourite} aria-label={favourite ? 'Remove page from favourites' : 'Add page to favourites'} title={favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    </>}
    <button className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label="Knowledge" title="Knowledge" onClick={onAI}><Icon name="knowledge"/></button>
    {mobile ? <ActionMenu label="More page actions" actions={[
      ...(onForward ? [{label: 'Go forward', icon: 'chevron', disabled: forwardDisabled, onSelect: onForward}] : []),
      {label: focusedReading ? 'Turn off focused reading' : 'Turn on focused reading', icon: 'creativework', onSelect: onToggleFocusedReading},
      {label: favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', disabled: saving, onSelect: () => void toggleFavourite()},
      {label: 'Move to Trash', icon: 'trash', danger: true, onSelect: onDelete},
    ]}/> : <button className="page-tool" aria-label="Move note to Trash" title="Move to Trash" onClick={onDelete}><Icon name="trash"/></button>}
  </div>;
}
