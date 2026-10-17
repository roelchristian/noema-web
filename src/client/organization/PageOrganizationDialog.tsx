import { useState } from 'react';
import type { Organization, PageSummary } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { PageIcon } from '../components/PageIcon';
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
  return <Modal className="organization-dialog" titleId="page-organization-title" onClose={onClose}>
    <div className="organization-dialog-heading"><span className="destination-icon"><Icon name="collection"/></span><button className="page-tool" aria-label="Close organization dialog" disabled={pending} onClick={onClose}><Icon name="close"/></button></div>
    <h2 id="page-organization-title">Organize page</h2>
    <p>Choose one folder and any number of collections.</p>
    <div className="organizing-page"><PageIcon icon={page.icon}/><span>{page.title || 'Untitled'}</span></div>
    <ItemOrganization data={data} kind="page" itemId={page.id} pending={pending} onMove={(...args) => void move(...args)}/>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><span role="status">{pending ? 'Saving changes…' : error ? 'Changes could not be saved' : 'Changes save automatically'}</span><button className="button primary" disabled={pending} onClick={onClose}>{pending ? 'Saving…' : 'Done'}</button></div>
  </Modal>;
}
