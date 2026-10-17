import { useState } from 'react';
import type { Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';

export function PageToolbar({inactive=false, page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, focusedReading, onToggleFocusedReading, onForward, forwardDisabled}: {
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
    <button className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label="Knowledge" title="Knowledge" onClick={onAI}><Icon name="knowledge"/></button>
    <ActionMenu label="More page actions" actions={[
      ...(onForward ? [{label: 'Go forward', icon: 'chevron', disabled: forwardDisabled, onSelect: onForward}] : []),
      {label: focusedReading ? 'Turn off focused reading' : 'Turn on focused reading', icon: 'creativework', onSelect: onToggleFocusedReading},
      {label: favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', disabled: saving, onSelect: () => void toggleFavourite()},
      {label: 'Move to Trash', icon: 'trash', danger: true, onSelect: onDelete},
    ]}/>
  </div>;
}
