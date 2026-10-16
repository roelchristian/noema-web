import { useState } from 'react';
import type { Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';

export function PageToolbar({page, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen, focusedReading, onToggleFocusedReading}: {
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
  return <div className="page-toolbar" role="group" aria-label="Page tools">
    <button className="page-tool focused-reading-button" aria-label="Focused reading" aria-pressed={focusedReading} title={focusedReading ? 'Turn off focused reading' : 'Turn on focused reading'} onClick={onToggleFocusedReading}><Icon name="creativework"/></button>
    <button className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving} aria-pressed={!!favourite} aria-label={favourite ? 'Remove page from favourites' : 'Add page to favourites'} title={favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    <button className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" aria-label="Knowledge" title="Knowledge" onClick={onAI}><Icon name="knowledge"/></button>
    <button className="page-tool" aria-label="Move note to Trash" title="Move to Trash" onClick={onDelete}><Icon name="trash"/></button>
  </div>;
}
