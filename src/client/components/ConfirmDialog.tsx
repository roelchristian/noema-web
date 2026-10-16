import { useState } from 'react';
import { Modal } from './Modal';

export function ConfirmDialog({title, description, action, onConfirm, onClose}: {
  title: string; description: string; action: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal titleId="confirm-title" onClose={() => { if (!busy) onClose(); }}>
    <h2 id="confirm-title">{title}</h2><p>{description}</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button autoFocus className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await onConfirm(); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }}>{busy ? 'Working…' : action}</button></div>
  </Modal>;
}
