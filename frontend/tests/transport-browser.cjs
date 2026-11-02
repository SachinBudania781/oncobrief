// Run against a local Vite server, with Playwright available on NODE_PATH.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

async function main() {
  let server;
  let browser;
  try {
    let base = process.env.TRANSPORT_TEST_BASE_URL;
    if (!base) {
      const { createServer } = await import('vite');
      server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 5190, strictPort: false } });
      await server.listen();
      base = `http://127.0.0.1:${server.httpServer.address().port}`;
    }
    browser = await chromium.launch({ headless: true,
      ...(process.env.MEMORY_UP_BROWSER_CHANNEL ? { channel: process.env.MEMORY_UP_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage();
    await page.clock.install();
    await page.addInitScript(() => {
      window.__geo = { active: new Set(), next: 0 };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition(success) { success({ coords: { latitude: 18.5, longitude: 73.8, accuracy: 10 } }); },
        watchPosition() { const id = ++window.__geo.next; window.__geo.active.add(id); return id; },
        clearWatch(id) { window.__geo.active.delete(id); },
      } });
    });
    let closed = false;
    let sharing = 'available';
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/location/start')) { sharing = 'active'; return route.fulfill({ json: { status: 'active' } }); }
      if (path.endsWith('/location/stop')) { sharing = 'stopped'; return route.fulfill({ json: { status: 'stopped' } }); }
      if (path.endsWith('/location')) return route.fulfill({ json: { status: 'active' } });
      if (path.endsWith('/taxonomy')) return route.fulfill({ json: { hospital_now: '2040-01-02T08:00:00' } });
      if (path.endsWith('/appointments')) return route.fulfill({ json: [] });
      return route.fulfill({ json: [{ id: 1, status: closed ? 'completed' : 'requested',
        appointment: { id: 1, start: '2040-01-02T10:00:00', department: 'Radiology' },
        data: { pickup_at: '2040-01-02T09:00:00', pickup_address: 'Synthetic pickup',
          ride_type: 'caregiver', location_consent: true, location_sharing: closed ? 'stopped' : sharing },
      }] });
    });
    await page.goto(base + '/tests/transport-harness.html');
    await page.getByRole('button', { name: 'Start trip location', exact: true }).click();
    await page.waitForFunction(() => window.__geo.active.size === 1);
    closed = true;
    await page.clock.fastForward(21000);
    await page.getByText('completed', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__geo.active.size), 0, 'Closed trips must stop collecting GPS');

    closed = false; sharing = 'active';
    await page.reload();
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await page.getByText("This trip's location link has been withdrawn.", { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Start trip location|Resume trip location/ }).count(), 0);
    assert.equal(sharing, 'stopped');
    console.log('PASS: closed trips stop GPS, remote sharing can be withdrawn and withdrawn links cannot be restarted.');
  } finally { if (browser) await browser.close(); if (server) await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
