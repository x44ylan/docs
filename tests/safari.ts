// Safari (WebKit) smoke check against a running Docs: home and a vault must
// render on an iPhone viewport with no page errors. WebKit needs system
// libraries, so this runs in Playwright's image:
//   docker run --rm --network host -v $PWD:/app -w /app mcr.microsoft.com/playwright:v1.64.1-noble \
//     node tests/safari.ts <base URL> <Cf-Access assertion or Bearer token>
import assert from 'node:assert/strict';
import { devices, webkit } from 'playwright';

const [base = 'http://127.0.0.1:3000', credential = ''] = process.argv.slice(2);
const headers = credential.startsWith('ey') && credential.split('.').length === 3 && !base.startsWith('https')
    ? { 'cf-access-jwt-assertion': credential }
    : { Authorization: `Bearer ${credential}` };
const browser = await webkit.launch();
try {
    const context = await browser.newContext({ ...devices['iPhone 13'], extraHTTPHeaders: headers });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/#`, { waitUntil: 'networkidle' });
    await page.getByRole('region', { name: 'Vaults' }).waitFor({ timeout: 15_000 });
    await page.getByRole('region', { name: 'Vaults' }).getByRole('link').first().click();
    await page.locator('.note .ProseMirror').first().waitFor({ timeout: 20_000 });
    assert.deepEqual(errors, []);
    console.log('safari ok', page.url());
} finally {
    await browser.close();
}
