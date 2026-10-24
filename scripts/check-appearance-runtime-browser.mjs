// Real shell and disposable database. No screenshots, vault access or providers.
// Run with node --import tsx (and the usual PLAYWRIGHT_MODULE/CHROMIUM_PATH).
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'vite';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const repo = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'noema-appearance-runtime-'));
let db, api, vite, browser;
const checks = [];
try {
  db = openDatabase(join(directory, 'fixture.sqlite'));
  api = createApp(new Store(db), join(repo, 'dist/client'));
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  vite = await createServer({configFile: false, root: repo, server: {host: '127.0.0.1', port: 0, proxy: {'/api': `http://127.0.0.1:${api.address().port}`}}});
  await vite.listen();
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  for (const failure of ['none', 'read-denied', 'write-denied', 'both-denied', 'corrupt']) {
    const context = await browser.newContext({colorScheme: 'dark', viewport: {width: 1440, height: 960}});
    await context.addInitScript(failure => {
      localStorage.setItem('noema.appearance.v1', failure === 'corrupt' ? '{' : JSON.stringify({mode: 'system', theme: 'atlantic', bodyFont: 'ibm-plex-mono', headingFont: 'inter'}));
      const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (this === localStorage && ['read-denied', 'both-denied'].includes(failure)) throw new DOMException('Storage denied', 'SecurityError');
        return read.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && ['write-denied', 'both-denied'].includes(failure)) throw new DOMException('Storage full', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    }, failure);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
    await page.getByRole('button', {name: 'A place for connected ideas', exact: false}).first().click();
    await page.locator('#page-title').waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
    if (['none', 'write-denied'].includes(failure)) {
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '#a6c8ee');
      assert.match(await page.evaluate(() => document.documentElement.style.getPropertyValue('--font-ui')), /IBM Plex Mono/);
      assert.match(await page.evaluate(() => document.documentElement.style.getPropertyValue('--font-title')), /Inter/);
    }
    await page.getByRole('button', {name: 'Show page knowledge', exact: true}).click();
    await page.getByRole('button', {name: 'Knowledge settings', exact: true}).click();
    await page.locator('.settings-modal[open]').waitFor();
    const status = page.locator('.settings-footer [role=status]');
    if (['write-denied', 'both-denied'].includes(failure)) await status.filter({hasText: 'Browser storage unavailable.'}).waitFor();
    else await status.filter({hasText: 'Changes saved in this browser.'}).waitFor();
    await page.emulateMedia({colorScheme: 'light'});
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'light');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
    await page.getByRole('button', {name: 'Dark', exact: true}).click();
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
    await page.emulateMedia({colorScheme: 'dark'}); await page.emulateMedia({colorScheme: 'light'});
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mode), 'dark', 'Explicit mode must override later system changes');
    await page.getByRole('button', {name: 'Juniper', exact: true}).click();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#a0cbb1');
    await page.getByRole('button', {name: 'Light', exact: true}).click();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#2d5947');
    await page.getByRole('button', {name: 'System', exact: true}).click();
    await page.emulateMedia({colorScheme: 'dark'});
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
    if (['write-denied', 'both-denied'].includes(failure)) assert.match(await status.innerText(), /Browser storage unavailable/);
    assert.deepEqual(errors, []);
    checks.push({failure, systemTransition: true, explicitMode: true, accentChanges: true, errorNotice: ['write-denied', 'both-denied'].includes(failure)});
    await context.close();
  }
  console.log(JSON.stringify({browser: await browser.version(), checks, screenshots: 'unrun'}));
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (api) await new Promise(resolve => api.close(resolve));
  if (db) db.close();
  await rm(directory, {recursive: true, force: true});
}
