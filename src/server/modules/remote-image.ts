import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {publicAddress, sourceURL} from './source-import.js';
import {maxImageBytes} from './images.js';
import {HttpError} from '../validation.js';

/** Download clipboard images without browser CORS restrictions; pin validated DNS on every redirect. */
export async function fetchRemoteImage(value: unknown): Promise<{bytes: Buffer; mime: string}> {
  let url = sourceURL(value);
  const signal = AbortSignal.timeout(30000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    let addresses;
    try {addresses = await lookup(url.hostname, {all:true, family:4});}
    catch {throw new HttpError(400, 'Unable to resolve the clipboard image URL.');}
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new HttpError(400, 'Clipboard images must use public internet addresses.');
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).get(url, {
        signal, agent:false, family:4,
        lookup:(_host, _options, callback) => callback(null, addresses[0]!.address, 4),
        headers:{Accept:'image/png, image/jpeg, image/gif, image/webp', 'Accept-Encoding':'identity', 'User-Agent':'Noema image import'},
      }, resolve);
      req.on('error', () => reject(new HttpError(400, 'Could not download the clipboard image. Copy the image itself and paste it again.')));
    });
    if ([301,302,303,307,308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location; response.destroy();
      if (!location || redirects === 5) throw new HttpError(400, 'Too many clipboard image redirects.');
      url = sourceURL(new URL(location, url).href); continue;
    }
    if (response.statusCode !== 200) {response.destroy(); throw new HttpError(400, 'The clipboard image URL did not return a successful response.');}
    const mime = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!['image/png','image/jpeg','image/gif','image/webp','application/octet-stream'].includes(mime) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      response.destroy(); throw new HttpError(415, 'Choose a PNG, JPEG, GIF, or WebP image.');
    }
    if (Number(response.headers['content-length']) > maxImageBytes) {response.destroy(); throw new HttpError(413, 'Images must be 20 MB or smaller');}
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > maxImageBytes) {response.destroy(); throw new HttpError(413, 'Images must be 20 MB or smaller');}
      chunks.push(Buffer.from(chunk));
    }
    return {bytes:Buffer.concat(chunks), mime};
  }
  throw new HttpError(400, 'Could not download the clipboard image.');
}
