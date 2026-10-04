import { options, format } from './editor.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { html } from './html.mjs';
import { auth } from './auth.mjs';
import { diagram } from './diagram.mjs';
import { tree } from './tree.mjs';
import { navigation } from './navigation.mjs';
import { markdown } from './markdown.mjs';
import { icons } from './icons.mjs';
import { sharing } from './sharing.mjs';
import { publicLinks } from './public.mjs';
import { mcp } from './mcp.mjs';
import { ui } from './ui.mjs';
import { preview } from './preview.mjs';
import { header } from './header.mjs';

const image = process.argv[2] ?? 'docs:review';
const baseline = process.argv.includes('--baseline');
const onlySharing = process.argv.includes('--sharing');
const onlyPublic = process.argv.includes('--public');
const onlyNavigation = process.argv.includes('--navigation');
const onlyMcp = process.argv.includes('--mcp');
const iconsOnly = process.argv.includes('--icons-only');
const onlyUi = process.argv.includes('--ui');
const onlyHeader = process.argv.includes('--header');
const withPreview = onlyUi && process.argv.includes('--preview');
const dir = new URL('../../artifacts/e2e/', import.meta.url);
await mkdir(dir, { recursive: true });
const report = new URL(`${onlyHeader ? 'header' : onlyUi ? 'ui' : onlyMcp ? 'mcp' : onlyPublic ? 'public' : onlySharing ? 'sharing' : onlyNavigation ? 'navigation' : baseline ? 'before' : 'report'}.json`, dir);
const started = new Date().toISOString();
await writeFile(report, JSON.stringify({ image, started, status: 'running' }, null, 2));
const docker = (...args) =>
    execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
});
const key = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'fixture',
    alg: 'RS256',
    use: 'sig'
};
const bearer = randomBytes(32).toString('hex');
function jwt(email, aud = 'browser', claims = {}) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const data = `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ iss: 'https://fixture.cloudflareaccess.com', aud: [aud], sub: email, email, exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
    return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
let container;
let browser;
let page;
const checks = [];
const errors = [];
let previewPath;
async function checkHeader(count) {
    const header = page.locator('#app-header');
    assert.equal(
        await header.evaluate((el) => el.parentElement.getBoundingClientRect().height),
        60,
        'Home and editor must share a fixed 60px navbar'
    );
    assert(
        await header.evaluate((el) => {
            const bar = el.getBoundingClientRect();
            return [...el.querySelectorAll('button, a')].every((control) => {
                const box = control.getBoundingClientRect();
                if (!box.width || !box.height) return true;
                return (
                    box.width === 36 &&
                    box.height === 36 &&
                    Math.abs(box.top + box.height / 2 - (bar.top + bar.height / 2)) < 1
                );
            });
        }),
        'All header controls must be 36px and vertically centered'
    );
    const compactEditor = count === 3 && page.viewportSize().width < 640;
    assert.equal(await header.getByRole('link', { name: 'Docs home' }).isVisible(), !compactEditor);
    assert.equal(await header.getByRole('button').count(), count === 3 ? (page.viewportSize().width >= 1024 ? 13 : 5) : count);
    if (!compactEditor) assert(
        await header
            .getByRole('link', { name: 'Docs home' })
            .evaluate((el) => el.getBoundingClientRect().left < innerWidth / 2)
    );
    assert(
        await header
            .getByRole('button', { name: 'User menu' })
            .evaluate((el) => el.getBoundingClientRect().left >= innerWidth / 2)
    );
    assert.equal(await header.getByRole('button', { name: 'Toggle document details' }).count(), 0);
    assert.equal(await header.getByRole('link', { name: 'Back to vaults' }).count(), 0);
    assert(
        await header.locator('svg').evaluateAll((icons) =>
            icons.every((icon) => {
                const box = icon.getBoundingClientRect();
                return box.width <= 18 && box.height <= 18;
            })
        ),
        'Header icons should be no larger than 18px'
    );
}
try {
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const socketPort = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    container = docker(
        'run',
        '-d',
        '--rm',
        '--no-healthcheck',
        '--network',
        'host',
        '-e',
        'APP_ENV=testing',
        '-e',
        'APP_DEBUG=false',
        '-e',
        `APP_KEY=base64:${randomBytes(32).toString('base64')}`,
        '-e',
        `APP_URL=${base}`,
        '-e',
        'DB_DATABASE=/tmp/docs.sqlite',
        '-e',
        'SESSION_SECURE_COOKIE=false',
        '-e',
        'SCOUT_DRIVER=null',
        '-e',
        `BROADCAST_CONNECTION=${onlySharing ? 'reverb' : 'log'}`,
        '-e', 'REVERB_APP_ID=fixture',
        '-e', 'REVERB_APP_KEY=fixture',
        '-e', 'REVERB_APP_SECRET=fixture-secret',
        '-e', 'REVERB_HOST=127.0.0.1',
        '-e', `REVERB_PORT=${socketPort}`,
        '-e', 'REVERB_SCHEME=http',
        '-e',
        'QUEUE_CONNECTION=sync',
        '-e',
        'CF_ACCESS_TEAM_DOMAIN=fixture.cloudflareaccess.com',
        '-e',
        'CF_ACCESS_AUD=browser',
        '-e',
        'MCP_EMAIL=agent@example.test',
        '--entrypoint',
        'sh',
        image,
        '-c',
        `php artisan config:clear && php -r 'touch("/tmp/docs.sqlite");' && php artisan migrate --force && ${onlySharing ? `(php artisan reverb:start --host=127.0.0.1 --port=${socketPort} & php artisan serve --host=127.0.0.1 --port=${port})` : `php artisan serve --host=127.0.0.1 --port=${port}`}`
    );
    for (let i = 0; i < 80; i++) {
        try {
            if (
                (
                    await fetch(`${base}/up`, {
                        signal: AbortSignal.timeout(1000)
                    })
                ).ok
            )
                break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    docker('cp', 'tests/e2e/fixture.php', `${container}:/tmp/fixture.php`);
    const fixture = JSON.parse(
        execFileSync('docker', ['exec', '-i', container, 'php', '/tmp/fixture.php'], {
            input: JSON.stringify({ key, legacy: onlyPublic }),
            encoding: 'utf8'
        })
    );
    browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
    if (onlyHeader) {
        checks.push(await header({ browser, base, jwt, dir, baseline }));
    } else if (onlyUi) {
        const result = await ui({ browser, base, jwt, dir });
        checks.push(result.message);
        previewPath = result.path;
    } else if (onlyMcp) {
        checks.push(...await auth({ base, browser, jwt, fixture, bearer }));
        checks.push(await tree({ browser, base, jwt, dir }));
        checks.push(await mcp({ browser, base, jwt, dir, fixture }));
    } else if (onlyPublic) {
        checks.push(await publicLinks({ browser, base, jwt, dir, fixture }));
    } else if (onlySharing) {
        checks.push(await sharing({ browser, base, jwt, dir, socketPort }));
    } else if (onlyNavigation) {
        checks.push(await navigation({ browser, base, jwt, dir }));
    } else {
    if (!baseline && !iconsOnly) checks.push(...await auth({ base, browser, jwt, fixture, bearer }));
    const context = await browser.newContext({
        hasTouch: true,
        extraHTTPHeaders: {
            'Cf-Access-Jwt-Assertion': jwt('alex@example.test')
        }
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await page
        .getByRole('heading', {
            name: baseline ? 'Vaults' : 'Workspace',
            exact: true
        })
        .waitFor();
    assert.equal(await page.getByText('Private archive', { exact: true }).count(), 0);
    checks.push('Home renders and excludes unaccepted/private vaults');
    if (!baseline) await page.waitForFunction(() => document.title === 'Docs');
    if (!baseline) checks.push(...await icons({ page }));
    if (!iconsOnly) {
    for (const [name, width, height] of [
        ['small-mobile', 320, 740],
        ['mobile', 390, 844],
        ['mobile-boundary', 639, 844],
        ['tablet-boundary', 640, 1024],
        ['tablet', 768, 1024],
        ['desktop', 1440, 1000]
    ]) {
        await page.setViewportSize({ width, height });
        for (const theme of ['light', 'dark']) {
            await page.evaluate(
                (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
                theme
            );
            await page.evaluate(
                () =>
                    new Promise((resolve) =>
                        requestAnimationFrame(() => requestAnimationFrame(resolve))
                    )
            );
            assert(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                `${name} overflow`
            );
            await page.screenshot({
                path: new URL(`${baseline ? 'before' : 'after'}-${name}-${theme}.png`, dir)
                    .pathname,
                fullPage: true,
                animations: 'disabled'
            });
            if (!baseline) {
                await checkHeader(1);
                await page.mouse.move(0, 0);
                const searchStyle = await page.getByRole('searchbox', { name: 'Find a vault' }).evaluate(el => {
                    const style = getComputedStyle(el);
                    return { background: style.backgroundColor, border: style.borderColor };
                });
                const importStyle = await page.getByRole('button', { name: 'Import', exact: true }).evaluate(el => {
                    const style = getComputedStyle(el);
                    return { background: style.backgroundColor, border: style.borderColor };
                });
                assert.deepEqual(searchStyle, importStyle, `${name}/${theme}: search must match the Import button colours`);
                assert.equal(
                    await page.locator('[aria-labelledby="recent-title"]').isVisible(),
                    width >= 640,
                    `${name}: recent documents should only appear on larger screens`
                );
                assert(
                    await page.getByRole('link', { name: 'Open Product', exact: true }).isVisible()
                );
                assert(await page.evaluate(() => {
                    const vaults = document.querySelector('[aria-labelledby="vaults-title"]');
                    const recent = document.querySelector('[aria-labelledby="recent-title"]');
                    return !!(vaults.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING);
                }), 'Vaults must precede Recent in DOM and keyboard order');
                if (width >= 640) {
                    const vaults = await page.locator('[aria-labelledby="vaults-title"]').boundingBox();
                    const recent = await page.locator('[aria-labelledby="recent-title"]').boundingBox();
                    assert(vaults.y + vaults.height <= recent.y, 'Show the vault list before Recent');
                }
                if (width < 640) {
                    const title = await page.locator('#home-title').boundingBox();
                    assert(
                        title && title.width <= 1 && title.height <= 1,
                        'Workspace is visually hidden on mobile'
                    );
                    const search = await page
                        .getByRole('searchbox', { name: 'Find a vault' })
                        .boundingBox();
                    const list = await page.locator('ul').boundingBox();
                    const vaultTitle = await page.locator('#vaults-title').boundingBox();
                    assert(
                        vaultTitle && vaultTitle.width <= 1 && vaultTitle.height <= 1,
                        'Vaults heading is visually hidden on mobile'
                    );
                    const importButton = await page
                        .getByRole('button', { name: 'Import', exact: true })
                        .boundingBox();
                    const newButton = await page
                        .getByRole('button', { name: 'New vault', exact: true })
                        .boundingBox();
                    assert(
                        search &&
                            importButton &&
                            newButton &&
                            search.height === 44 &&
                            search.y === importButton.y &&
                            search.y === newButton.y &&
                            search.x + search.width <= importButton.x &&
                            importButton.x < newButton.x,
                        'Mobile toolbar must be one row: search, import, new vault'
                    );
                    assert(
                        list && list.y < 140,
                        'Mobile list should start without a large header gap'
                    );
                    assert.equal(
                        await page.getByRole('link', { name: /Open Getting started in/ }).count(),
                        0
                    );
                    assert.equal(
                        await page.getByRole('button', { name: 'Show all recent' }).count(),
                        0
                    );
                }
                // Icon controls must stay named, text-free and large enough to tap.
                for (const name of ['Import', 'New vault']) {
                    const action = page.getByRole('button', {
                        name,
                        exact: true
                    });
                    assert.equal((await action.innerText()).trim(), '');
                    assert(await action.getAttribute('title'));
                    const box = await action.boundingBox();
                    assert(box && box.width >= 44 && box.height >= 44);
                }
                await page
                    .getByRole('heading', { name: 'Vaults', exact: true })
                    .scrollIntoViewIfNeeded();
                assert(
                    await page.getByRole('button', { name: /Actions for/ }).evaluateAll((buttons) =>
                        buttons.every((button) => {
                            const box = button.getBoundingClientRect();
                            return box.left >= 0 && box.right <= innerWidth;
                        })
                    ),
                    `${name}: vault actions outside viewport`
                );
                await page.screenshot({
                    path: new URL(`library-${name}-${theme}.png`, dir).pathname
                });
                await page
                    .getByRole('button', { name: 'New vault', exact: true })
                    .scrollIntoViewIfNeeded();
            }
        }
    }
    checks.push(
        'Vaults precede Recent on tablet/desktop in DOM and visual order; mobile remains vault-only; both themes fit without overflow'
    );
    if (!baseline) {
        assert(await page.getByRole('img', { name: 'Shared', exact: true }).count());
        assert(await page.getByRole('img', { name: 'Private', exact: true }).count());
        assert(await page.getByRole('img', { name: /\d+ documents?/ }).count());
        checks.push('Icon-only home actions retain accessible labels, hints and 44px tap targets');
        await page.getByRole('searchbox', { name: 'Find a vault' }).fill('engineering');
        assert.equal(await page.getByRole('link', { name: /Open Engineering/ }).count(), 1);
        assert.equal(await page.getByRole('link', { name: /Open Product/ }).count(), 0);
        await page.getByRole('searchbox', { name: 'Find a vault' }).fill('no-such-vault');
        await page.getByText('No matching vaults').waitFor();
        await page.getByRole('button', { name: 'Clear search' }).click();
        assert.equal(await page.getByRole('combobox', { name: 'Sort vaults' }).count(), 0);
        const vaultNames = await page
            .locator('ul')
            .getByRole('link')
            .evaluateAll((links) =>
                links.map((link) => link.getAttribute('aria-label').replace(/^Open /, ''))
            );
        assert.deepEqual(
            vaultNames,
            [...vaultNames].sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
            )
        );
        assert.match(
            await page.locator('ul').getByRole('link').first().getAttribute('aria-label'),
            /Open A very long/
        );
        checks.push('Vault search and no-results recovery');
        await page.getByRole('button', { name: 'User menu' }).click();
        await page.getByRole('menuitem', { name: 'Dark mode', exact: true }).click();
        await page.reload();
        assert(await page.locator('html').evaluate((el) => el.classList.contains('dark')));
        checks.push('Theme switch persists across reload');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: 'New vault', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create vault' });
        await dialog.waitFor();
        await page.screenshot({
            path: new URL('dialog-mobile.png', dir).pathname,
            animations: 'disabled'
        });
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab');
            assert(
                await page.evaluate(() =>
                    Boolean(document.activeElement?.closest('[role="dialog"]'))
                )
            );
        }
        await page.getByRole('button', { name: 'Create vault', exact: true }).click();
        await page.getByText('Cannot be empty.', { exact: true }).waitFor();
        await page.getByRole('textbox', { name: 'Vault name' }).fill('Browser check');
        await page.route('**/vaults', (route) =>
            route.request().method() === 'POST'
                ? route.fulfill({
                      status: 503,
                      contentType: 'application/json',
                      body: '{"message":"Unavailable"}'
                  })
                : route.continue()
        );
        await page.getByRole('button', { name: 'Create vault', exact: true }).click();
        await page
            .getByText('The service is temporarily unavailable. Try again shortly.')
            .waitFor();
        assert.equal(
            await page.getByRole('textbox', { name: 'Vault name' }).inputValue(),
            'Browser check'
        );
        await page.unroute('**/vaults');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(
            await page
                .getByRole('button', { name: 'New vault', exact: true })
                .evaluate((el) => el === document.activeElement),
            true
        );
        checks.push(
            'Dialog naming/focus restoration, validation and failed submission retain input'
        );
        await page.getByRole('button', { name: 'New vault', exact: true }).click();
        await page.getByRole('textbox', { name: 'Vault name' }).fill('Browser check');
        await page.getByRole('button', { name: 'Create vault', exact: true }).click();
        await page.waitForURL(/\/vaults\/\d+$/);
        await page.waitForFunction(() => document.title === 'Browser check');
        await page.goto(base);
        await page.getByRole('heading', { name: 'Workspace' }).waitFor();
        await page.getByRole('link', { name: /Open Browser check/ }).waitFor();
        checks.push('Create vault and return to a predictable home');
        await page.getByRole('button', { name: 'Actions for Browser check' }).click();
        await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
        await page.getByRole('textbox', { name: 'Vault name' }).fill('Renamed vault');
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await page.getByRole('link', { name: 'Open Renamed vault', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Actions for Product' }).click();
        const exported = page.waitForResponse((response) => response.url().includes('/export'));
        const downloaded = page.waitForEvent('download').catch(() => null);
        await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
        const exportResponse = await exported;
        assert.equal(exportResponse.status(), 200, await exportResponse.text());
        assert(
            !exportResponse.headers()['content-type']?.includes('text/html'),
            'Export returned HTML'
        );
        const archive = await downloaded;
        assert(archive, 'Export did not download');
        assert.match(archive.suggestedFilename(), /\.zip$/);
        await archive.saveAs(new URL('export.zip', dir).pathname);
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await page
            .getByLabel('Import a vault from a ZIP archive')
            .setInputFiles(new URL('export.zip', dir).pathname);
        await page.getByText('Vault imported', { exact: true }).waitFor();
        await page.getByRole('link', { name: 'Open export', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Actions for Renamed vault' }).click();
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
        await page
            .getByRole('dialog', { name: 'Delete vault' })
            .getByRole('button', { name: 'Delete', exact: true })
            .click();
        await page
            .getByRole('link', { name: 'Open Renamed vault', exact: true })
            .waitFor({ state: 'detached' });
        checks.push('Rename, export/import ZIP round trip and delete through the vault menu');
        await page.getByRole('link', { name: 'Open Product', exact: true }).tap();
        await page.waitForURL(/\/vaults\/\d+$/);
        await page.waitForFunction(() => document.title === 'Product');
        await page.getByRole('button', { name: 'Toggle document tree' }).tap();
        await page.locator('aside').first().getByTitle('Getting started', { exact: true }).tap();
        await page.locator('.tiptap[contenteditable="true"]').waitFor();
        checks.push('Mobile vault list opens a vault and its document');
        await page.waitForFunction(() => document.title === 'Getting started');
        await page.goto(base);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page
            .getByRole('link', {
                name: 'Open Getting started in Product',
                exact: true
            })
            .click();
        const editor = page.locator('.tiptap[contenteditable="true"]');
        await editor.waitFor();
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction((small) => {
                const box = document.querySelector('aside')?.getBoundingClientRect();
                return box && (small ? box.right <= 1 : box.width >= 240 && box.left === 0);
            }, width < 1024);
            await checkHeader(3);
            assert.equal(await page.getByRole('button', { name: 'Close file', exact: true }).count(), 0, 'Close file is in More, not a redundant header icon');
            const title = page.getByRole('textbox', { name: 'Document title', exact: true });
            assert.equal(await title.count(), 1, 'Only one editable document title');
            assert.equal(
                await title.evaluate((el) => Boolean(el.closest('#app-header'))),
                true,
                'Title belongs in the shared header at every width'
            );
            assert(
                await title.evaluate((el) => el.getBoundingClientRect().width >= 100),
                'Title has usable space even at 320px'
            );
            if (width >= 1024) assert(await page.getByRole('group', { name: 'Document formatting' }).evaluate(el => Boolean(el.closest('#app-header'))), 'No secondary formatting row');
            else assert(await page.getByRole('button', { name: 'Show formatting', exact: true }).isVisible());
            const searchButton = page.getByRole('button', {
                name: 'Search documents',
                exact: true
            });
            assert(
                await searchButton.evaluate((el) => {
                    const box = el.getBoundingClientRect();
                    return (
                        box.left >= innerWidth / 2 &&
                        box.right <= innerWidth &&
                        box.width >= 36 &&
                        box.height >= 36
                    );
                }),
                'Search must stay on the right without shrinking its tap target'
            );
            assert.equal(
                await page.locator('aside').count(),
                1,
                'Only the left document tree should remain'
            );
            assert(
                await page
                    .getByRole('button', { name: 'Search documents', exact: true })
                    .isVisible()
            );
            assert(
                await page
                    .locator('main > section')
                    .evaluate((el) => Math.abs(el.getBoundingClientRect().right - innerWidth) < 1),
                'Editor must extend to the right edge without a sidebar gap'
            );
            await page.screenshot({
                path: new URL(`editor-${width}.png`, dir).pathname,
                animations: 'disabled'
            });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
        await page.setViewportSize({ width: 320, height: 900 });
        await page.locator('#app-header').getByRole('textbox', { name: 'Document title', exact: true }).waitFor();
        const documentTitle = page.getByRole('textbox', { name: 'Document title', exact: true });
        const titleSaved = page.waitForResponse(
            (response) =>
                response.request().method() === 'PATCH' && response.url().includes('/nodes/')
        );
        await documentTitle.fill('Proteus - a long document title for narrow phones');
        await documentTitle.blur();
        assert.equal((await titleSaved).status(), 200);
        await page.waitForFunction(() => document.title === 'Proteus - a long document title for narrow phones');
        await page.reload();
        await page.waitForFunction(() => document.title === 'Proteus - a long document title for narrow phones');
        assert.equal(
            await documentTitle.inputValue(),
            'Proteus - a long document title for narrow phones'
        );
        await checkHeader(3);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const titleRestored = page.waitForResponse(
            (response) =>
                response.request().method() === 'PATCH' && response.url().includes('/nodes/')
        );
        await documentTitle.fill('Getting started');
        await documentTitle.blur();
        assert.equal((await titleRestored).status(), 200);
        await page.waitForFunction(() => document.title === 'Getting started');
        await page.setViewportSize({ width: 1440, height: 900 });
        await options(page);
        await page.getByRole('menuitem', { name: 'Close file', exact: true }).click();
        await page.getByText('Select a note', { exact: true }).waitFor();
        await page.waitForFunction(() => document.title === 'Product');
        assert.equal(await page.getByRole('textbox', { name: 'Document title' }).count(), 0);
        await page.setViewportSize({ width: 320, height: 900 });
        await page.getByRole('button', { name: 'Toggle document tree' }).click();
        await page.locator('aside').first().getByTitle('Getting started', { exact: true }).click();
        await editor.waitFor();
        assert.equal(await documentTitle.inputValue(), 'Getting started');
        await page.waitForFunction(() => document.title === 'Getting started');
        checks.push(
            'One header contains the editable title/formatting at every size; rename persists and More close/reopen works'
        );
        await page.getByRole('button', { name: 'Search documents', exact: true }).focus();
        await page.keyboard.press('Enter');
        const searchDialog = page.getByRole('dialog', { name: 'Search', exact: true });
        await searchDialog.waitFor();
        await page.getByRole('textbox', { name: 'Search documents', exact: true }).waitFor();
        assert(await searchDialog.evaluate(el => {
            const style = getComputedStyle(el);
            return ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
                .every(side => style[side] === '0px');
        }), 'Search panel has no outer padding');
        assert((await searchDialog.boundingBox()).height <= 50, 'Empty search is only one row');
        const searchTitle = await searchDialog
            .getByRole('heading', { name: 'Search', exact: true })
            .boundingBox();
        assert(
            searchTitle && searchTitle.width <= 1 && searchTitle.height <= 1,
            'Search title is screen-reader only'
        );
        const searchFileId = Number(new URL(page.url()).searchParams.get('file'));
        await page.route('**/vaults/*/search?*', async (route) =>
            route.fulfill({
                json: {
                    data: {
                        files: new URL(route.request().url()).searchParams.get('search') === 'missing' ? [] : [
                            {
                                id: searchFileId,
                                name: 'Getting started',
                                full_path: 'Getting started.md',
                                type: 'note',
                                extension: 'md',
                                content: 'Search preview',
                                updated_at: new Date().toISOString()
                            }
                        ]
                    }
                }
            })
        );
        await searchDialog.getByRole('textbox', { name: 'Search documents' }).fill('Getting');
        await searchDialog.getByRole('button', { name: /Getting started/ }).waitFor();
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const box = await searchDialog.boundingBox();
            assert(
                box &&
                    Math.abs(box.x + box.width - width) < 1 &&
                    Math.abs(box.y - 60) < 1 &&
                    Math.abs(box.width - Math.min(width, 448)) < 1,
                'Search is flush below the navbar and against the right edge without outer margins'
            );
            const input = await searchDialog.getByRole('textbox').boundingBox();
            const close = await searchDialog.getByRole('button', { name: 'Close', exact: true }).boundingBox();
            const result = await searchDialog.getByRole('button', { name: /Getting started/ }).boundingBox();
            assert(input && close && result && input.height === 48 && close.height === 44 &&
                Math.abs(input.y + input.height / 2 - close.y - close.height / 2) < 1 &&
                Math.abs(result.y - input.y - input.height - 1) < 1 &&
                input.x + input.width <= close.x,
                'Flat search row has aligned touch controls and results directly below its divider');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            for (const theme of ['light', 'dark']) {
                await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
                await page.screenshot({
                    path: new URL(`search-${width}-${theme}.png`, dir).pathname,
                    animations: 'disabled'
                });
            }
        }
        await searchDialog.getByRole('textbox').fill('missing');
        await searchDialog.getByText('No results found', { exact: true }).waitFor();
        await searchDialog.getByRole('textbox').fill('');
        await searchDialog.getByRole('status').waitFor({ state: 'hidden' });
        assert((await searchDialog.boundingBox()).height <= 50, 'Clearing search collapses the results');
        await searchDialog.getByRole('textbox').fill('Getting');
        await searchDialog.getByRole('button', { name: /Getting started/ }).waitFor();
        await searchDialog.getByRole('textbox').press('ArrowDown');
        await searchDialog.getByRole('textbox', { name: 'Search documents' }).press('Enter');
        await searchDialog.waitFor({ state: 'hidden' });
        await page.unroute('**/vaults/*/search?*');
        await page.setViewportSize({ width: 320, height: 900 });
        await page.getByRole('button', { name: 'Search documents', exact: true }).click();
        await searchDialog.waitFor();
        await page.keyboard.press('Escape');
        await searchDialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
            () => document.activeElement?.getAttribute('aria-label') === 'Search documents'
        );
        checks.push('Flat search panel: no outer padding, aligned controls, flush results, both themes and empty-state recovery');
        checks.push(
            'Left home/tree/search controls restored; right sidebar and toggle removed without a layout gap'
        );
        await editor.click();
        await format(page, 'Heading');
        const headingMenu = page.getByRole('menu').last();
        await headingMenu.waitFor();
        assert(
            await headingMenu.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= innerWidth;
            })
        );
        await page.screenshot({
            path: new URL('toolbar-mobile.png', dir).pathname,
            animations: 'disabled'
        });
        const formatted = page.waitForResponse(
            (response) =>
                response.request().method() === 'PATCH' && response.url().includes('/nodes/')
        );
        await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).tap();
        await editor.locator('h2').waitFor();
        assert.equal((await formatted).status(), 200);
        await page.getByRole('button', { name: 'Lists', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitem', { name: 'Ordered list', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Lists');
        await page.getByRole('button', { name: 'Read document', exact: true }).click();
        await page.locator('.tiptap[contenteditable="false"]').waitFor();
        assert(await page.getByRole('button', { name: 'Heading', exact: true }).isDisabled());
        await page.getByRole('button', { name: 'Edit document', exact: true }).click();
        await editor.waitFor();
        await options(page);
        await page.getByRole('menuitem', { name: 'Markdown source', exact: true }).click();
        await page.getByRole('textbox', { name: 'Markdown source', exact: true }).waitFor();
        await options(page);
        await page.getByRole('menuitem', { name: 'Rich text editor', exact: true }).click();
        await editor.waitFor();
        checks.push(
            '320px touch and keyboard formatting menus, focus return and explicit read/edit states'
        );
        await html(page, dir);
        checks.push(
            'HTML previews preserve source, save/reload, work in read mode and on phones, and isolate styles without scripts, navigation or network access'
        );
        await diagram(page, dir);
        checks.push('Archify JSON diagrams render, persist, pan/zoom and expand on phones/desktop; invalid input recovers and labels remain inert');
        const saved = page.waitForResponse(
            (response) =>
                response.request().method() === 'PATCH' && response.url().includes('/nodes/')
        );
        await editor.fill('Browser edit persists.');
        assert.equal((await saved).status(), 200);
        await page.reload();
        await editor.getByText('Browser edit persists.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Toggle document tree' }).click();
        await page.getByRole('button', { name: 'Collaboration', exact: true }).click();
        const sharing = page.getByRole('dialog', {
            name: 'Collaboration',
            exact: true
        });
        await sharing.waitFor();
        assert(
            await sharing
                .getByRole('list', { name: 'People with access' })
                .locator('li')
                .evaluateAll((rows) =>
                    rows.every((row) => row.getBoundingClientRect().height >= 64)
                ),
            'People rows have room to breathe'
        );
        await sharing.getByRole('button', { name: 'Remove Agent' }).click();
        const confirmation = page.getByRole('dialog', {
            name: 'Delete collaborator'
        });
        await confirmation.waitFor();
        await confirmation.getByRole('button', { name: 'Cancel' }).click();
        await sharing.getByRole('tab', { name: 'People', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        const peopleInput = sharing.getByRole('combobox', { name: 'Find people' });
        assert.equal(await sharing.getByText(/Share with someone who/).count(), 0);
        await peopleInput.fill('nobody-matches');
        await sharing.getByText('No people found', { exact: true }).waitFor();
        await page.route('**/collaborations?q=fail', (route) =>
            route.fulfill({ status: 503, json: {} })
        );
        await peopleInput.fill('fail');
        await sharing.getByText('Could not load people. Try again.', { exact: true }).waitFor();
        await page.unroute('**/collaborations?q=fail');
        let finishSlow;
        const slowFinished = new Promise((resolve) => {
            finishSlow = resolve;
        });
        await page.route('**/collaborations?q=slow', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 700));
            await route
                .fulfill({
                    json: { data: [{ id: 999, name: 'Stale result', email: 'stale@example.test' }] }
                })
                .catch(() => {});
            finishSlow();
        });
        const slowStarted = page.waitForRequest('**/collaborations?q=slow');
        await peopleInput.fill('slow');
        await slowStarted;
        await peopleInput.fill('nobody-matches');
        await sharing.getByText('No people found', { exact: true }).waitFor();
        await slowFinished;
        assert.equal(
            await sharing.getByRole('listbox', { name: 'People', exact: true }).getByRole('option').count(),
            0,
            'A late lookup cannot replace newer results'
        );
        await page.unroute('**/collaborations?q=slow');
        await peopleInput.fill('sa');
        await sharing.getByRole('option', { name: /Sam.*sam@example.test/ }).waitFor();
        for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.screenshot({
                path: new URL(`lookup-${width}.png`, dir).pathname,
                animations: 'disabled'
            });
        }
        await peopleInput.press('ArrowDown');
        await peopleInput.press('Enter');
        assert.equal(await peopleInput.inputValue(), 'sam@example.test');
        await page.setViewportSize({ width: 320, height: 900 });
        await sharing.getByRole('button', { name: 'Add collaborator', exact: true }).click();
        await sharing.getByRole('button', { name: 'Remove Sam' }).waitFor();
        await sharing.getByRole('tab', { name: 'Add collaborator', exact: true }).click();
        await peopleInput.fill('sam');
        await sharing.getByText('No people found', { exact: true }).waitFor();
        await sharing.getByRole('tab', { name: 'People', exact: true }).click();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({
            path: new URL('sharing-desktop.png', dir).pathname,
            animations: 'disabled'
        });
        await page.setViewportSize({ width: 390, height: 900 });
        await page.screenshot({
            path: new URL('sharing-mobile.png', dir).pathname,
            animations: 'disabled'
        });
        await sharing.getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByRole('button', { name: 'User menu' }).click();
        await page.getByRole('menuitem', { name: 'Profile', exact: true }).waitFor();
        assert.equal(
            await page
                .getByRole('menuitem', {
                    name: /^(Show documents|Hide documents|Search documents)$/
                })
                .count(),
            0
        );
        await page.screenshot({
            path: new URL('account-mobile.png', dir).pathname,
            animations: 'disabled'
        });
        await page.getByRole('menuitem', { name: 'Profile', exact: true }).click();
        await page.getByRole('textbox', { name: 'Display name' }).fill('Alex Updated');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.getByText('Profile updated', { exact: true }).waitFor();
        checks.push(
            'Preserved sidebar opens sharing; nested dialogs, keyboard tabs, collaborator creation and profile updates work'
        );
        await options(page);
        await page.getByRole('menuitem', { name: 'Docs home', exact: true }).click();
        await page.getByRole('heading', { name: 'Workspace' }).waitFor();
        await page.waitForFunction(() => document.title === 'Docs');
        checks.push('Browser tab titles follow home, active document, rename, reload and close/reopen without a brand suffix');
        checks.push(
            'Compact header, right-aligned search, no back button; home returns to the A–Z vault list'
        );
        checks.push(
            'Recent document opens, editor works at three sizes and an edit persists after reload'
        );
        await page.goto(`${base}/vaults/999999`);
        await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
        await page.screenshot({
            path: new URL('error-mobile.png', dir).pathname,
            animations: 'disabled'
        });
        await page.getByRole('link', { name: 'Back to Docs', exact: true }).click();
        await page.getByRole('heading', { name: 'Workspace' }).waitFor();
        checks.push('Missing documents show a responsive error page with a working home link');
        const emptyContext = await browser.newContext({
            extraHTTPHeaders: {
                'Cf-Access-Jwt-Assertion': jwt('new@example.test')
            }
        });
        const empty = await emptyContext.newPage();
        await empty.goto(base);
        await empty.getByText('No vaults yet').waitFor();
        checks.push('First Cloudflare sign-in provisions a user and displays a useful empty state');
        await emptyContext.close();
        const sharingUrl = `${base}/vaults/${fixture.vaults[4]}`;
        async function shareFrom(browserPage, vaultId, email) {
            return browserPage.evaluate(
                async ({ vaultId, email }) => {
                    const cookie = document.cookie
                        .split('; ')
                        .find((value) => value.startsWith('XSRF-TOKEN='));
                    const response = await fetch(`/vaults/${vaultId}/collaborations`, {
                        method: 'POST',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            'X-XSRF-TOKEN': decodeURIComponent(cookie.slice('XSRF-TOKEN='.length))
                        },
                        body: JSON.stringify({ email })
                    });
                    return response.status;
                },
                { vaultId, email }
            );
        }
        await page.goto(sharingUrl);
        await page.getByRole('button', { name: 'Toggle document tree' }).click();
        await page.getByRole('button', { name: 'Collaboration', exact: true }).click();
        const memberSharing = page.getByRole('dialog', { name: 'Collaboration', exact: true });
        await memberSharing.getByRole('tab', { name: 'Add collaborator', exact: true }).click();
        await memberSharing.getByRole('combobox', { name: 'Find people' }).fill('new@');
        await memberSharing.getByRole('option', { name: /new@example.test/ }).tap();
        const shared = page.waitForResponse(
            (response) =>
                response.url() === `${sharingUrl}/collaborations` &&
                response.request().method() === 'POST'
        );
        await memberSharing.getByRole('button', { name: 'Add collaborator', exact: true }).click();
        assert.equal((await shared).status(), 200, 'An existing collaborator can share');
        await memberSharing.getByRole('tab', { name: 'People', exact: true }).waitFor();
        // count() does not wait; let the collaborator list load first.
        await memberSharing.getByRole('button', { name: /^Remove / }).first().waitFor();
        assert.equal(
            await memberSharing.getByRole('button', { name: /^Remove / }).count(),
            1,
            'Members may only remove themselves'
        );
        await page.screenshot({
            path: new URL('member-sharing-mobile.png', dir).pathname,
            animations: 'disabled'
        });
        for (const email of [
            'alex@example.test',
            'sam@example.test',
            'new@example.test',
            'unknown@example.test'
        ]) {
            assert.equal(
                await shareFrom(page, fixture.vaults[4], email),
                422,
                'Reject self, owner, duplicate and unknown recipients'
            );
        }
        assert.equal(
            await shareFrom(page, fixture.vaults[5], 'new@example.test'),
            403,
            'An unaccepted member cannot share'
        );
        const lookup = await page.evaluate(
            async ({ allowed, denied }) => {
                const get = async (id, q) => {
                    const response = await fetch(
                        `/vaults/${id}/collaborations?q=${encodeURIComponent(q)}`,
                        { headers: { Accept: 'application/json' } }
                    );
                    return { status: response.status, body: await response.json() };
                };
                return {
                    members: await get(allowed, 'example.test'),
                    blank: await get(allowed, ''),
                    wildcard: await get(allowed, '%%'),
                    denied: await get(denied, 'example.test')
                };
            },
            { allowed: fixture.vaults[4], denied: fixture.vaults[5] }
        );
        assert.equal(lookup.members.status, 200);
        assert(lookup.members.body.data.length <= 8);
        assert(
            lookup.members.body.data.every(
                (person) => Object.keys(person).sort().join() === 'email,id,name'
            )
        );
        assert(
            !lookup.members.body.data.some((person) =>
                [
                    'sam@example.test',
                    'alex@example.test',
                    'new@example.test',
                    'agent@example.test'
                ].includes(person.email)
            ),
            'Existing members, owner and agent are excluded'
        );
        assert.deepEqual(lookup.blank.body.data, []);
        assert.deepEqual(lookup.wildcard.body.data, []);
        assert.equal(lookup.denied.status, 403, 'Lookup requires accepted vault access');
        checks.push(
            'People lookup supports name/email selection, empty/error recovery and excludes existing members; compact search supports keyboard selection'
        );
        const recipientContext = await browser.newContext({
            extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('new@example.test') }
        });
        const recipient = await recipientContext.newPage();
        await recipient.goto(base);
        await recipient.getByRole('link', { name: 'Open Shared playbook', exact: true }).waitFor();
        assert.equal(
            await shareFrom(recipient, fixture.vaults[1], 'agent@example.test'),
            403,
            'A non-member cannot share a private vault'
        );
        await recipient.getByRole('link', { name: 'Open Shared playbook', exact: true }).click();
        await recipient.waitForURL(sharingUrl);
        await recipient.locator('aside').getByText('Shared playbook', { exact: true }).waitFor();
        await recipientContext.close();
        checks.push(
            'Existing members can share; recipients gain access; duplicate, unknown, pending and non-member shares are rejected'
        );
        async function rpc(method, params = {}) {
            const response = await fetch(`${base}/mcp`, {
                method: 'POST',
                headers: {
                    'Cf-Access-Jwt-Assertion': jwt('alex@example.test'),
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream'
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
            });
            assert.equal(response.status, 200);
            return (await response.json()).result;
        }
        assert.equal(
            (await rpc('initialize', { protocolVersion: '2025-11-25' })).serverInfo.name,
            'Docs'
        );
        assert.equal((await rpc('tools/list')).tools.length, 8);
        const call = (name, args) => rpc('tools/call', { name, arguments: args });
        const vaults = JSON.parse((await call('vaults', {})).content[0].text).data;
        assert(fixture.vaults.slice(0, 5).every((id) => vaults.some((v) => v.id === id)));
        assert(!vaults.some((v) => v.id === fixture.vaults[5]));
        const created = await call('create', {
            vaultId: fixture.vaults[0],
            name: 'Agent check',
            content: '# First'
        });
        assert(!created.isError, created.content[0].text);
        const note = JSON.parse(created.content[0].text);
        assert(
            JSON.parse(
                (await call('list', { vaultId: fixture.vaults[0] })).content[0].text
            ).data.some((item) => item.id === note.id)
        );
        assert(
            JSON.parse((await call('search', { query: 'Agent check' })).content[0].text).data.some(
                (item) => item.id === note.id
            )
        );
        assert(!(await call('update', { noteId: note.id, content: '\nSecond' })).isError);
        assert.equal(
            JSON.parse((await call('read', { noteId: note.id })).content[0].text).content,
            '# First\nSecond'
        );
        assert((await call('read', { noteId: note.id, extra: true })).isError);
        checks.push(
            'MCP initialize, schema, scoped vault listing, create, update, read and argument validation'
        );
        assert.equal(
            (
                await fetch(`${base}/vaults`, {
                    headers: { Accept: 'application/json' }
                })
            ).status,
            403
        );
        checks.push('Unauthenticated browser requests remain blocked');
        checks.push(await mcp({ browser, base, jwt, dir, fixture }));
        checks.push(await tree({ browser, base, jwt, dir }));
        checks.push(await navigation({ browser, base, jwt, dir }));
        checks.push(await markdown({ browser, base, jwt, dir }));
    }
    }
    }
    assert.deepEqual(errors, [], 'Browser exceptions');
    for (const file of ['failure.png', 'failure.txt', 'export.zip']) {
        await unlink(new URL(file, dir)).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
        });
    }
    await writeFile(
        report,
        JSON.stringify(
            {
                image,
                imageId: docker('inspect', '--format', '{{.Image}}', container),
                started,
                status: 'passed',
                checks,
                errors
            },
            null,
            2
        )
    );
    console.log(JSON.stringify({ image, checks, errors }, null, 2));
    if (withPreview) {
        await browser.close();
        browser = null;
        await preview({ base, jwt, path: previewPath });
    }
} catch (error) {
    await writeFile(
        report,
        JSON.stringify(
            {
                image,
                started,
                status: 'failed',
                checks,
                errors,
                failure: String(error)
            },
            null,
            2
        )
    );
    if (page && !page.isClosed()) {
        await page.screenshot({ path: new URL('failure.png', dir).pathname }).catch(() => {});
        await writeFile(
            new URL('failure.txt', dir),
            await page
                .locator('body')
                .innerText()
                .catch(() => 'No page')
        );
    }
    if (container) {
        console.error(docker('logs', '--tail', '30', container));
        console.error(docker('exec', container, 'sh', '-c', 'tail -120 storage/logs/laravel.log 2>/dev/null || true'));
    }
    throw error;
} finally {
    await browser?.close();
    if (container) docker('stop', container);
}
