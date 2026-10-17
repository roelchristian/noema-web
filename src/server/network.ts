import type {IncomingMessage} from 'node:http';
import {isIP} from 'node:net';
import {hostname, networkInterfaces} from 'node:os';

export interface NetworkConfig {lan: boolean; bindHost: string; allowedHosts: string[]}
const loopbackHosts = ['localhost', '127.0.0.1'];
function ipv4(address: string) {return address.startsWith('::ffff:') ? address.slice(7) : address;}
function isLoopback(address: string) {return address === '::1' || ipv4(address) === '127.0.0.1';}
function isPrivate(address: string) {
  const value = ipv4(address);
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}
function configuredHost(value: string) {
  const host = value.trim().toLowerCase();
  if (!host || host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('NOEMA_ALLOWED_HOSTS must contain comma-separated hostnames or IPv4 addresses, without schemes, ports, paths, or wildcards.');
  }
  return host;
}
export function readNetworkConfig(env: NodeJS.ProcessEnv = process.env): NetworkConfig {
  const mode = env.NOEMA_LAN?.trim().toLowerCase() || '0';
  if (!['0', '1', 'false', 'true'].includes(mode)) throw new Error('NOEMA_LAN must be 1/true or 0/false.');
  const lan = mode === '1' || mode === 'true';
  if (!lan && (env.NOEMA_LAN_HOST || env.NOEMA_ALLOWED_HOSTS)) throw new Error('Enable NOEMA_LAN=1 before configuring LAN hosts.');
  if (!lan) return {lan: false, bindHost: '127.0.0.1', allowedHosts: [...loopbackHosts]};
  const bindHost = env.NOEMA_LAN_HOST?.trim() || '0.0.0.0';
  if (bindHost !== '0.0.0.0' && !isLoopback(bindHost) && !isPrivate(bindHost) || isIP(bindHost) !== 4) {
    throw new Error('NOEMA_LAN_HOST must be 0.0.0.0, 127.0.0.1, or a private local IPv4 address.');
  }
  const addresses = Object.values(networkInterfaces()).flatMap(items => items ?? []).filter(item => item.family === 'IPv4' && !item.internal && isPrivate(item.address)).map(item => item.address);
  const machine = hostname().toLowerCase();
  const hosts = env.NOEMA_ALLOWED_HOSTS !== undefined ? env.NOEMA_ALLOWED_HOSTS.split(',').map(configuredHost) :
    [...addresses, machine, ...(machine.endsWith('.local') ? [] : [machine + '.local'])];
  return {lan, bindHost, allowedHosts: [...new Set([...loopbackHosts, ...(bindHost === '0.0.0.0' ? [] : [bindHost]), ...hosts])]};
}
/** Check the actual peer and Host; forwarded headers never expand LAN access. */
export function networkRequestError(req: IncomingMessage, config: NetworkConfig): string | null {
  const peer = req.socket.remoteAddress || '';
  if (!isLoopback(peer) && !(config.lan && isPrivate(peer))) return config.lan ? 'Only local network connections are allowed' : 'Only loopback connections are allowed';
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(req.headers.host || '');
  if (!match || match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535) || !config.allowedHosts.includes(match[1]!.toLowerCase())) return 'Host is not allowed';
  return null;
}
