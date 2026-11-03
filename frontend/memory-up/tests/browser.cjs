// Optional browser regressions: install Playwright separately; see MEMORY_UP.md.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    const file = req.url.startsWith('/memory-up-assets/') ? req.url.split('/').pop() : 'index.html';
    if (!['index.html', 'app.js', 'style.css'].includes(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await fs.readFile(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.MEMORY_UP_BROWSER_CHANNEL ? { channel: process.env.MEMORY_UP_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let denySecond = false;
    let invalidUpload = false;
    let published = false;
    let releaseUpload;
    let uploadStarted;
    let holdUpload = false;
    let uploadCount = 0;
    const context = {
      user: { name: 'Test doctor', role: 'doctor', department: 'Radiology' },
      patients: [{ id: 'TEST-1', name: 'Synthetic one' }, { id: 'TEST-2', name: 'Synthetic two' }],
      can_write: true,
      appointments: [{ id: 1, department: 'Radiology', start: '2040-01-02T10:00:00', clinician: 'Test doctor' }],
    };
    await page.route('**/api/memory-up/**', async route => {
      const url = new URL(route.request().url());
      const second = url.searchParams.get('patient_id') === 'TEST-2' || url.pathname.endsWith('/TEST-2');
      if (second && denySecond) return route.fulfill({ status: 403, json: { detail: 'Access revoked' } });
      if (url.pathname.endsWith('/publish')) { published = true; return route.fulfill({ json: {} }); }
      if (route.request().method() === 'POST' && holdUpload) {
        uploadCount++;
        uploadStarted();
        await new Promise(resolve => { releaseUpload = resolve; });
      }
      if (route.request().method() === 'POST' && invalidUpload)
        return route.fulfill({ status: 422, json: { detail: [{ msg: 'Field required: appointment' }] } });
      if (url.pathname.endsWith('/context')) return route.fulfill({ json: context });
      return route.fulfill({ json: second ? [] : [{ id: 1, title: 'Private first-patient advice',
        advice: 'Synthetic instructions', status: published ? 'published' : 'draft',
        approved_by: published ? 'Test doctor' : '', department: 'Radiology',
        appointment_at: '2040-01-02T10:00:00', doctor: 'Test doctor' }] });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/memory-up`);
    await page.locator('#appointment').selectOption('1');
    await page.locator('#advice').fill('Unsaved appointment notes');
    await page.locator('#file').setInputFiles({ name: 'visit.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic advice') });
    await page.locator('#refresh').click();
    await page.locator('#compose').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#advice').inputValue(), 'Unsaved appointment notes');
    assert.equal(await page.locator('#appointment').inputValue(), '1');
    assert.equal(await page.locator('#file').evaluate(node => node.files.length), 1);
    await page.getByText('I reviewed this advice · publish for patient').click();
    await page.getByText('Reviewed by Test doctor').waitFor();
    assert.equal(await page.locator('#advice').inputValue(), 'Unsaved appointment notes');

    invalidUpload = true;
    await page.locator('[name=identity_confirmed]').check();
    holdUpload = true;
    const started = new Promise(resolve => { uploadStarted = resolve; });
    await page.locator('#save').click();
    await started;
    for (const selector of ['#save', '#refresh', '#patient', '#advice', '#file']) {
      assert.equal(await page.locator(selector).isDisabled(), true, selector);
    }
    await page.locator('#memory-form').dispatchEvent('submit');
    assert.equal(uploadCount, 1);
    holdUpload = false;
    releaseUpload();
    await page.getByText('Field required: appointment', { exact: true }).waitFor();
    assert.equal(await page.locator('#advice').inputValue(), 'Unsaved appointment notes');
    assert.equal(await page.locator('#advice').isDisabled(), false);
    assert.equal(await page.locator('#refresh').isDisabled(), false);

    denySecond = true;
    await page.locator('#patient').selectOption('TEST-2');
    await page.getByText('Access revoked', { exact: true }).waitFor();
    // Force the former redisplay path even though the filter is now disabled.
    await page.locator('#department').dispatchEvent('change');
    assert.equal(await page.locator('.note').count(), 0);
    assert.equal(await page.locator('#advice').inputValue(), '');
    assert.equal(await page.locator('#file').evaluate(node => node.files.length), 0);
    assert.equal(await page.locator('#compose').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: draft retention, appointment/file retention, review refresh, validation messages and failed-switch privacy.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
