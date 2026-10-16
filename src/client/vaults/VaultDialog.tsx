import { useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';
export type VaultAction = 'create' | 'lock' | 'unlock';
export function VaultDialog({action, onSubmit, onClose}: {action: VaultAction; onSubmit: (value: string) => Promise<void>; onClose: () => void}) {
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const creating = action === 'create';
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onSubmit(value); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <Modal onClose={() => { if (!busy) onClose(); }} titleId="vault-dialog-title"><form onSubmit={submit}>
    <h2 id="vault-dialog-title">{creating ? 'Create a vault' : action === 'lock' ? 'Lock this vault' : 'Unlock this vault'}</h2>
    <label>{creating ? 'Name' : 'Passphrase'}<input autoFocus type={creating ? 'text' : 'password'} required maxLength={creating ? 200 : 500} minLength={action === 'lock' ? 4 : undefined} autoComplete={creating ? 'off' : action === 'lock' ? 'new-password' : 'current-password'} value={value} onChange={e => setValue(e.target.value)} disabled={busy}/></label>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Working…' : 'Continue'}</button></div>
  </form></Modal>;
}
