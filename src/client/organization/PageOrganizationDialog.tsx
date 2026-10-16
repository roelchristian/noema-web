import { useState } from 'react';
import type { Organization, PageSummary } from '../../shared/domain';
import { Modal } from '../components/Modal';
import { ItemOrganization } from './ItemOrganization';

export function PageOrganizationDialog({page, data, onMove, onClose}: {
  page: PageSummary; data: Organization; onClose: () => void;
  onMove: (collection: string, folder: string | null, remove?: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  async function move(collection: string, folder: string | null, remove = false) {
    if (pending) return;
    setPending(true); setError('');
    try { await onMove(collection, folder, remove); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update page organization.'); }
    finally { setPending(false); }
  }
  return <Modal titleId="page-organization-title" onClose={onClose}>
    <h2 id="page-organization-title">Add to folder / collection</h2>
    <p>{page.title || 'Untitled'}</p>
    <ItemOrganization data={data} kind="page" itemId={page.id} pending={pending} onMove={(...args) => void move(...args)}/>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button primary" disabled={pending} onClick={onClose}>{pending ? 'Saving…' : 'Done'}</button></div>
  </Modal>;
}
