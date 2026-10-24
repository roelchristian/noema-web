import {InlineNotice} from '../notifications/InlineNotice';
import {FormNotice,useFormNotice} from '../notifications/FormNotice';
import {t as uiText} from '../i18n';
import {useEffect, useState, type FormEvent} from 'react';
import type {Vault} from '../../shared/domain';
import type {NetworkSettings} from '../../shared/security';
import {api} from '../api';

export function SecuritySettings({vault, onChangePassphrase, onBeforeNetworkChange}: {
  vault: Vault | null;
  onChangePassphrase: (current: string, next: string | null) => Promise<void>;
  onBeforeNetworkChange: () => Promise<void>;
}) {
  const [network, setNetwork] = useState<NetworkSettings | null>(null);
  const [loading, setLoading] = useState(true), [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState(''), [networkNotice,setNetworkNotice,networkOccurrence]=useFormNotice();
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'change' | 'remove'>('change');
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice,setNotice,noticeOccurrence]=useFormNotice();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setNetworkError('');
    void api.networkSettings(controller.signal).then(setNetwork).catch(error => {
      if (!controller.signal.aborted) setNetworkError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => { setCurrent(''); setNext(''); setConfirmation(''); setError(''); setNotice(''); setMode('change'); }, [vault?.id, vault?.locked]);
  async function toggleNetwork() {
    if (!network || networkBusy) return;
    setNetworkBusy(true); setNetworkError(''); setNetworkNotice('');
    try {
      await onBeforeNetworkChange();
      const updated = await api.saveNetworkSettings(!network.lan);
      setNetwork(updated);
      const remote = !['localhost', '127.0.0.1'].includes(window.location.hostname);
      setNetworkNotice(updated.lan ? 'LAN access is on. Devices on your local network can connect.' : remote ? `LAN access is off. To reconnect, open ${updated.localUrl} on the computer running Noema.` : 'LAN access is off. Only this computer can connect.');
    } catch (error) { setNetworkError(error instanceof Error ? error.message : String(error)); }
    finally { setNetworkBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !vault || vault.locked) return;
    setError(''); setNotice('');
    if (mode !== 'remove' && next !== confirmation) { setError('The new passphrases do not match.'); return; }
    const removed = vault.protected && mode === 'remove', wasProtected = vault.protected;
    setBusy(true);
    try {
      await onChangePassphrase(current, removed ? null : next);
      setCurrent(''); setNext(''); setConfirmation(''); setMode('change');
      setNotice(removed ? 'Passphrase removed. This vault no longer requires a passphrase.' : wasProtected ? 'Passphrase changed. Use it the next time you unlock this vault.' : 'Passphrase added. Use Lock vault when you want to lock it.');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <>
    <section className="settings-section" aria-labelledby="security-passphrase-heading">
      <h3 id="security-passphrase-heading">{uiText("Vault passphrase")}</h3>
      <p>{vault ? uiText("Control access to “{value0}”. Passphrases do not encrypt the database.",{value0: vault.name}) : uiText("Choose a vault to manage its passphrase.")}</p>
      {vault?.locked ? <p>{uiText("Unlock this vault to manage its passphrase.")}</p> : vault && <form className="security-passphrase-form" onSubmit={submit}>
        <p className="security-protection-status">{vault.protected ? uiText("A passphrase is set for this vault.") : uiText("This vault has no passphrase.")}</p>
        {vault.protected && <div className="display-options" role="group" aria-label={uiText("Passphrase action")}>
          <button type="button" aria-pressed={mode === 'change'} disabled={busy} onClick={() => { setMode('change'); setError(''); setNotice(''); }}>{uiText("Change passphrase")}</button>
          <button type="button" aria-pressed={mode === 'remove'} disabled={busy} onClick={() => { setMode('remove'); setNext(''); setConfirmation(''); setError(''); setNotice(''); }}>{uiText("Remove passphrase")}</button>
        </div>}
        {vault.protected && <label htmlFor="security-current-passphrase">{uiText("Current passphrase")}<input id="security-current-passphrase" type="password" autoComplete="current-password" required maxLength={500} disabled={busy} value={current} onChange={event => setCurrent(event.target.value)}/></label>}
        {(!vault.protected || mode === 'change') && <>
          <label htmlFor="security-new-passphrase">{uiText("New passphrase")}<input id="security-new-passphrase" type="password" autoComplete="new-password" minLength={4} maxLength={500} required disabled={busy} value={next} onChange={event => setNext(event.target.value)} aria-describedby="security-passphrase-hint"/></label>
          <p id="security-passphrase-hint">{uiText("Use at least 4 characters.")}</p>
          <label htmlFor="security-confirm-passphrase">{uiText("Confirm new passphrase")}<input id="security-confirm-passphrase" type="password" autoComplete="new-password" minLength={4} maxLength={500} required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
        </>}
        {mode === 'remove' && vault.protected && <p>{uiText("Anyone with server access will be able to open this vault.")}</p>}
        {error && <InlineNotice tone="error" title={error} announcement="assertive"/>}
        <FormNotice message={uiText(notice)} occurrence={noticeOccurrence} onDismiss={()=>setNotice('')}/>
        <button type="submit" className="button primary" disabled={busy}>{busy ? uiText("Saving…") : !vault.protected ? uiText("Add passphrase") : mode === 'remove' ? uiText("Remove passphrase") : uiText("Save passphrase")}</button>
      </form>}
    </section>
    <section className="settings-section" aria-labelledby="security-network-heading">
      <div className="security-network-row"><div><h3 id="security-network-heading">{uiText("Allow LAN connections")}</h3><p id="security-network-description">{uiText("Let local network devices connect and access unlocked vaults.")}</p></div>
        <button type="button" className="security-switch" role="switch" aria-checked={network?.lan ?? false} aria-labelledby="security-network-heading" aria-describedby="security-network-description" disabled={loading || !network || networkBusy} onClick={() => void toggleNetwork()}><span/></button>
      </div>
      <p className="security-network-state" role="status">{loading ? uiText("Loading network settings…") : networkBusy ? uiText("Saving network settings…") : network ? uiText("LAN access is {value0}.",{value0: network.lan ? uiText('On') : uiText('Off')}) : uiText("Network settings are unavailable.")}</p>
      <FormNotice message={uiText(networkNotice)} occurrence={networkOccurrence} onDismiss={()=>setNetworkNotice('')}/>
      {networkError && <InlineNotice tone="error" title={networkError} announcement="assertive" actions={<button type="button" className="summary-toggle" disabled={networkBusy} onClick={() => setReload(value => value + 1)}>{uiText("Retry")}</button>}/>}
    </section>
  </>;
}
