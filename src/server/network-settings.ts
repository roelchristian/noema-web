import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readNetworkConfig, type NetworkConfig} from './network.js';
import {HttpError} from './validation.js';

export function networkSettingsPath(database: string) { return path.resolve(database) + '.network.json'; }
// Keep listener capacity available so toggling LAN never requires restarting workers.
export function networkListenerConfig(env: NodeJS.ProcessEnv = process.env) {
  const network = readNetworkConfig({...env, LAN: '1', NOEMA_LAN: '1'});
  // Keep localhost reachable even when a specific LAN interface is selected.
  return {...network, bindHost: '0.0.0.0', ...(network.bindHost !== '0.0.0.0' ? {interfaceHost: network.bindHost} : {})};
}
export class NetworkAccess {
  private memory: boolean;
  constructor(readonly filename: string | undefined, private initial = readNetworkConfig(), readonly listener = networkListenerConfig()) {
    this.memory = initial.lan;
  }
  enabled() {
    if (!this.filename) return this.memory;
    try {
      const data: unknown = JSON.parse(readFileSync(this.filename, 'utf8'));
      return !!data && typeof data === 'object' && 'lan' in data && data.lan === true;
    } catch (error) {
      // A damaged or unreadable saved setting must not enable remote access.
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? this.initial.lan : false;
    }
  }
  config(): NetworkConfig { return {...this.listener, lan: this.enabled()}; }
  save(value: unknown) {
    if (typeof value !== 'boolean') throw new HttpError(400, 'LAN access must be on or off.');
    if (this.filename) {
      mkdirSync(path.dirname(this.filename), {recursive: true});
      const temporary = this.filename + '.' + randomUUID() + '.tmp';
      try {
        writeFileSync(temporary, JSON.stringify({lan: value}) + '\n', {mode: 0o600});
        renameSync(temporary, this.filename);
      } finally { try { unlinkSync(temporary); } catch { /* Renamed or never created. */ } }
    }
    this.memory = value;
  }
}
