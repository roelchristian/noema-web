import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import { useState } from 'react';
import type { Organization, PageSummary } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { PageIcon } from '../components/PageIcon';
import { Modal, ModalHeader } from '../components/Modal';
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
    <ModalHeader titleId="page-organization-title" leading={<Icon name="collection"/>} closeDisabled={pending}>{uiText("Organize page")}</ModalHeader>
    <p>{uiText("Choose one folder and any number of collections.")}</p>
    <div className="organizing-page"><PageIcon icon={page.icon}/><span><TitleText text={page.title || 'Untitled'}/></span></div>
    <ItemOrganization data={data} kind="page" itemId={page.id} pending={pending} onMove={(...args) => void move(...args)}/>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><span role="status">{pending ? uiText("Saving changes…") : error ? uiText("Changes could not be saved") : uiText("Changes save automatically")}</span><button className="button primary" disabled={pending} onClick={onClose}>{pending ? uiText("Saving…") : uiText("Done")}</button></div>
  </Modal>;
}
