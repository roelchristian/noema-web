import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Vault } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now, required, text } from '../validation.js';
interface VaultRow { id: string; name: string; locked: number; password_hash: string | null; salt: string | null; updated_at: string }
const summary = (v: VaultRow): Vault => ({id:v.id, name:v.name, locked:!!v.locked, protected:!!v.password_hash, updated_at:v.updated_at});
export class Vaults {
  constructor(private store: Store) {}
  private row(id: string) {
    const row = this.store.get<VaultRow>('SELECT * FROM vaults WHERE id=?', id);
    if (!row) throw new HttpError(404, 'Vault not found');
    return row;
  }
  list() { return this.store.all<VaultRow>('SELECT * FROM vaults ORDER BY updated_at DESC,id').map(summary); }
  create(body: Record<string, unknown>) {
    const id=randomUUID();
    this.store.run('INSERT INTO vaults (id,name,updated_at) VALUES (?,?,?)', id, required(body.name), now());
    return summary(this.row(id));
  }
  requireOpen(id: string) {
    if (this.row(id).locked) throw new HttpError(423, 'Vault is locked');
    return id;
  }
  lock(id: string, body: Record<string, unknown>) {
    const vault=this.row(id);
    if (!vault.password_hash) {
      const passphrase=text(body.passphrase,500);
      if (passphrase.length<4) throw new HttpError(400,'Use a passphrase of at least 4 characters');
      const salt=randomUUID();
      this.store.run('UPDATE vaults SET password_hash=?,salt=? WHERE id=?',scryptSync(passphrase,salt,64).toString('hex'),salt,id);
    }
    this.store.run('UPDATE vaults SET locked=1,updated_at=? WHERE id=?',now(),id);
    return summary(this.row(id));
  }
  unlock(id: string, body: Record<string, unknown>) {
    const vault=this.row(id);
    if (vault.password_hash && !timingSafeEqual(scryptSync(text(body.passphrase,500),vault.salt!,64),Buffer.from(vault.password_hash,'hex'))) throw new HttpError(403,'Incorrect passphrase');
    this.store.run('UPDATE vaults SET locked=0,updated_at=? WHERE id=?',now(),id);
    return summary(this.row(id));
  }
  setPassphrase(id: string, body: Record<string, unknown>) {
    this.requireOpen(id);
    const vault = this.row(id);
    if (vault.password_hash) {
      if (typeof body.currentPassphrase !== 'string' || !body.currentPassphrase) throw new HttpError(400, 'Enter the current passphrase.');
      if (!timingSafeEqual(scryptSync(text(body.currentPassphrase,500),vault.salt!,64),Buffer.from(vault.password_hash,'hex'))) throw new HttpError(403, 'Incorrect current passphrase.');
    }
    const passphrase = body.passphrase === null ? null : text(body.passphrase,500);
    if (passphrase !== null && passphrase.length < 4) throw new HttpError(400, 'Use a passphrase of at least 4 characters.');
    const salt = passphrase === null ? null : randomUUID();
    const hash = passphrase === null ? null : scryptSync(passphrase,salt!,64).toString('hex');
    this.store.run('UPDATE vaults SET password_hash=?,salt=?,updated_at=? WHERE id=?',hash,salt,now(),id);
    return summary(this.row(id));
  }
}
