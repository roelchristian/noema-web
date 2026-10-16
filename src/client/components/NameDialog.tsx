import { useState, type FormEvent } from 'react';
import { Modal } from './Modal';

export function NameDialog({title, value = '', maxLength = 200, onSave, onClose}: {title: string; value?: string; maxLength?: number; onSave: (name: string) => Promise<void>; onClose: () => void}) {
  const [name, setName] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try { await onSave(name.trim()); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  return <Modal titleId="name-dialog-title" onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}>
    <h2 id="name-dialog-title">{title}</h2><label>Name<input autoFocus required maxLength={maxLength} value={name} disabled={busy} onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)}/></label>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button></div>
  </form></Modal>;
}
