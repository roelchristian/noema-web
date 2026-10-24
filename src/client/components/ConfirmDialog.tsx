import {t as uiText} from '../i18n';
import { useState } from 'react';
import { Modal, ModalHeader } from './Modal';
import {InlineNotice} from '../notifications/InlineNotice';

export function ConfirmDialog({title, description, action, onConfirm, onClose, danger = false}: {
  title: string; description: string; action: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal className="confirmation-dialog" titleId="confirm-title" onClose={() => { if (!busy) onClose(); }}>
    <ModalHeader titleId="confirm-title" closeDisabled={busy}>{title}</ModalHeader><p>{description}</p>
    {error && <InlineNotice tone="error" title={error} announcement="assertive"/>}
    <div className="dialog-actions"><button type="button" autoFocus className="button confirmation-cancel" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button><button type="button" className={'button confirmation-action'+(danger?' is-danger':'')} disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await onConfirm(); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }}>{busy ? uiText("Working…") : action}</button></div>
  </Modal>;
}
