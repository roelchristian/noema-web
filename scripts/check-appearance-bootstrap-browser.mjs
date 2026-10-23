// No screenshots or application data: verify appearance with React deliberately
// absent and the production script CSP intact, before the body is parsed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../public/appearance-bootstrap.js', import.meta.url), 'utf8');
const tokens = await readFile(new URL('../src/client/styles/tokens.css', import.meta.url), 'utf8');
const fixture = html.replace('</head>', '<link rel="stylesheet" href="/tokens.css"><script src="/observe.js"></script></head>').replace(/<script type="module"[^>]*><\/script>/, '');
const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; frame-ancestors 'none'";
const server = createServer((req, res) => {
  const route = req.url?.split('?')[0];
  const assets = {
    '/': ['text/html', fixture],
    '/appearance-bootstrap.js': ['text/javascript', bootstrap],
    '/tokens.css': ['text/css', tokens],
    '/observe.js': ['text/javascript', 'window.bootObservation={mode:document.documentElement.dataset.mode,beforeBody:document.body===null,accent:document.documentElement.style.getPropertyValue("--accent")};'],
  };
  const asset = assets[route];
  res.writeHead(asset ? 200 : 404, {'Content-Type': asset?.[0] ?? 'text/plain', 'Content-Security-Policy': csp});
  res.end(asset?.[1] ?? 'Not found');
});
let browser;
const checks = [];
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  for (const theme of ['ink', 'juniper', 'atlantic']) for (const mode of ['light', 'dark', 'system']) for (const system of ['light', 'dark']) {
    const context = await browser.newContext({colorScheme: system});
    await context.addInitScript(({theme, mode}) => localStorage.setItem('noema.appearance.v1', JSON.stringify({theme, mode})), {theme, mode});
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(() => ({...window.bootObservation, scheme: getComputedStyle(document.documentElement).colorScheme}));
    const expected = mode === 'system' ? system : mode;
    assert.equal(result.mode, expected); assert.equal(result.scheme, expected); assert.equal(result.beforeBody, true);
    checks.push({theme, mode, system, ...result});
    await context.close();
  }
  for (const failure of ['read-denied', 'write-denied', 'corrupt', 'invalid']) {
    const context = await browser.newContext({colorScheme: 'dark'});
    await context.addInitScript(failure => {
      if (failure === 'corrupt') localStorage.setItem('noema.appearance.v1', '{');
      if (failure === 'invalid') localStorage.setItem('noema.appearance.v1', '{"mode":"unsupported","theme":"constructor"}');
      if (failure === 'read-denied') Object.defineProperty(Storage.prototype, 'getItem', {value() { throw new DOMException('Denied', 'SecurityError'); }});
      if (failure === 'write-denied') Object.defineProperty(Storage.prototype, 'setItem', {value() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }});
    }, failure);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(() => window.bootObservation);
    assert.equal(result.mode, 'dark'); assert.equal(result.beforeBody, true); assert.deepEqual(errors, []);
    checks.push({failure, ...result}); await context.close();
  }
  console.log(JSON.stringify({browser: await browser.version(), checks: checks.length, beforeBody: checks.every(check => check.beforeBody), screenshots: 'unrun'}));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
