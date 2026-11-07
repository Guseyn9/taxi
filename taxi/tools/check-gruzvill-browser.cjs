'use strict';
// Guest browser smoke test. Only the public dictionary is read from shared dev.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..', 'build');
const output = process.env.GRUZVILL_BROWSER_OUTPUT;
if (!output || !path.isAbsolute(output)) throw Error('Set an absolute GRUZVILL_BROWSER_OUTPUT');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let file = path.resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], writes = [], blockedOptionalReads = [], dictionaries = [], workers = [], rows = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.route('https://ibronevik.itest24.com/**', route => {
      // Deliberately fail this optional public read to exercise offline recovery.
      if (new URL(route.request().url()).pathname.endsWith('/api/v1/trip/get')) { blockedOptionalReads.push(route.request().url()); return route.abort(); }
      if (route.request().method() !== 'GET') { writes.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    page.on('response', response => {
      if (response.url().endsWith('/api/v1/data')) dictionaries.push({ url: response.url(), status: response.status() });
      if (response.url().includes('/maps/maplibre-gl-worker.mjs')) workers.push(response.status());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/passenger-order`);
    await expect(page.locator('.header-language__trigger')).toBeVisible({ timeout: 30000 });
    await page.locator('.header-language__trigger').click();
    await expect(page.getByRole('menuitemradio')).toHaveCount(9);
    await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
    await expect(page.getByText('Куда поедем?', { exact: true })).toBeVisible();
    await expect(page.getByTestId('rsale-map-status')).toHaveAttribute('data-status', 'ready', { timeout: 30000 });
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, lang: document.documentElement.lang, renderer: document.querySelector('[data-testid=rsale-map-status]')?.getAttribute('data-renderer') }));
      assert.ok(metrics.scrollWidth <= viewport.width, JSON.stringify(metrics));
      await page.screenshot({ path: path.join(output, `gruzvill-${viewport.width}.jpg`), fullPage: true });
      rows.push({ viewport, metrics });
    }
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ rows, dictionaries, workers, errors, writes, blockedOptionalReads, scope: 'Guest UI; optional public trip read deliberately fails; no authenticated ride/backend acceptance.' }, null, 2));
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    assert.ok(dictionaries.some(item => item.status === 200 && item.url === 'https://ibronevik.itest24.com/taxi_dev2/c/gruzvill/api/v1/data'));
    assert.ok(workers.includes(200), 'MapLibre worker must load from compiled local assets');
    console.log(JSON.stringify({ passed: true, sizes: rows.length, errors, writes, output }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
