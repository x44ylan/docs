import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function publicLinks({ browser, base, jwt, dir, fixture }) {
    const contexts = [];
    const errors = [];
    const blocked = [];
    const writes = [];
    const origin = new URL(base).origin;
    async function session(email) {
        const context = await browser.newContext(email ? { extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt(email) } } : {});
        contexts.push(context);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        if (email) await page.goto(base);
        return page;
    }
    async function request(page, path, method = 'GET', data) {
        return page.evaluate(async ({ path, method, data }) => {
            const token = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.slice(11);
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: data === undefined ? undefined : JSON.stringify(data) });
            return { status: response.status, body: await response.json().catch(() => null) };
        }, { path, method, data });
    }
    try {
        const owner = await session('alex@example.test');
        const outsider = await session('sam@example.test');
        const guest = await session();
        const legacy = fixture.legacy;
        const old = `${base}/share/${legacy.token}`;
        const short = (await request(owner, `/vaults/${legacy.id}/share`, 'POST')).body.data.share_url;
        const alias = Buffer.from(legacy.token.slice(0, 32), 'hex').toString('base64url');
        assert.equal(short, `${base}/share/${alias}`, 'Existing shares get a short URL without rotating their token');
        const oldData = await (await guest.request.get(old, { headers: { Accept: 'application/json' } })).json();
        const shortData = await (await guest.request.get(short, { headers: { Accept: 'application/json' } })).json();
        assert.equal(oldData.name, shortData.name);
        assert.deepEqual(oldData.nodes, shortData.nodes);
        const changed = short.slice(0, -1) + (alias.endsWith('A') ? 'Q' : 'A');
        assert.equal((await guest.request.get(changed, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await request(owner, `/vaults/${legacy.id}/share`, 'DELETE')).status, 200);
        for (const link of [old, short]) assert.equal((await guest.request.get(link, { headers: { Accept: 'application/json' } })).status(), 404);
        guest.on('request', req => { if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.url()); });
        await guest.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && !url.pathname.startsWith('/share/')) {
                blocked.push(url.pathname);
                return route.abort();
            }
            return route.continue();
        });
        const vault = (await request(owner, '/vaults', 'POST', { name: 'Public reader' })).body.data;
        const path = `/vaults/${vault.id}`, endpoint = `${path}/share`;
        assert.equal((await request(outsider, endpoint, 'POST')).status, 403);
        const create = async (name, parent_id = null, is_file = true) => {
            const response = await request(owner, `${path}/nodes`, 'POST', { name, parent_id, is_file });
            assert.equal(response.status, 200);
            return response.body.data;
        };
        const note = await create('Overview');
        const child = await create('Details', note.id);
        const media = await create('Media', null, false);
        await request(owner, `${path}/nodes/${child.id}`, 'PATCH', { content: '# Details\n\nNested public note.' });
        const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
        const csrf = decodeURIComponent((await owner.context().cookies()).find(c => c.name === 'XSRF-TOKEN').value);
        const upload = await owner.request.post(`${base}${path}/import`, { headers: { 'X-XSRF-TOKEN': csrf, Accept: 'application/json' }, multipart: { parent_id: String(media.id), 'files[]': { name: 'pixel.png', mimeType: 'image/png', buffer: picture } } });
        assert.equal(upload.status(), 200);
        const pictureNode = (await upload.json()).files[0];
        const spec = { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Public diagram', viewBox: [500, 240] }, components: [{ id: 'docs', type: 'backend', label: 'Docs', pos: [40, 80], size: [180, 64] }], connections: [], boundaries: [] };
        const source = `# Public content\n\n[Details](Overview/Details.md)\n\n![Pixel](Media/pixel.png)\n\n- [ ] Read only\n\n\`\`\`html\n<p>Rendered HTML</p><script>window.publicLeak = true</script>\n\`\`\`\n\n\`\`\`archify\n${JSON.stringify(spec)}\n\`\`\`\n`;
        assert.equal((await request(owner, `${path}/nodes/${note.id}`, 'PATCH', { content: source })).status, 200);
        await owner.goto(`${base}${path}`);
        for (const width of [320, 390, 1440]) {
            await owner.setViewportSize({ width, height: 900 });
            const toggle = owner.getByRole('button', { name: 'Toggle document tree', exact: true });
            if (width < 1024) await toggle.click();
            await owner.waitForFunction(() => document.querySelector('aside')?.getBoundingClientRect().left === 0);
            const share = owner.getByRole('button', { name: 'Collaboration', exact: true });
            await share.waitFor({ state: 'visible' });
            assert.equal(await share.locator('svg.lucide-share-2').count(), 1, 'Use the share icon, not the users icon');
            assert.equal(await share.locator('svg.lucide-users-round').count(), 0);
            const box = await share.locator('svg').boundingBox();
            assert(box.width === 14 && box.height === 14);
            const buttonBox = await share.boundingBox();
            assert(buttonBox.width === (width < 640 ? 44 : 36) && buttonBox.height === (width < 640 ? 44 : 36), 'Share button stays compact on desktop and touch-sized on phones');
            await owner.screenshot({ path: new URL(`share-icon-${width}.png`, dir).pathname, animations: 'disabled' });
            if (width < 1024) await toggle.click();
        }
        await owner.getByRole('button', { name: 'Collaboration', exact: true }).click();
        const modal = owner.getByRole('dialog', { name: 'Collaboration', exact: true });
        assert.equal(await modal.getByRole('textbox', { name: 'Public link URL' }).count(), 0);
        await owner.route(`**${endpoint}`, route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { message: 'Unavailable' } }) : route.continue());
        await modal.getByRole('button', { name: 'Create link', exact: true }).click();
        await modal.getByRole('alert').waitFor();
        assert.equal(await modal.getByRole('textbox', { name: 'Public link URL' }).count(), 0);
        await owner.unroute(`**${endpoint}`);
        const enabled = owner.waitForResponse(r => r.url() === `${base}${endpoint}` && r.request().method() === 'POST');
        await modal.getByRole('button', { name: 'Create link', exact: true }).click();
        assert.equal((await enabled).status(), 200);
        const input = modal.getByRole('textbox', { name: 'Public link URL' });
        await input.waitFor();
        const url = await input.inputValue();
        assert.match(url, new RegExp(`^${base}/share/[A-Za-z0-9_-]{22}$`));
        assert.equal((await request(owner, endpoint, 'POST')).body.data.share_url, url);
        await owner.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await modal.getByRole('button', { name: 'Copy public link', exact: true }).click();
        await modal.getByRole('button', { name: 'Link copied', exact: true }).waitFor();
        assert.equal(await owner.evaluate(() => navigator.clipboard.readText()), url);
        await owner.reload();
        await owner.getByRole('button', { name: 'Collaboration', exact: true }).click();
        assert.equal(await input.inputValue(), url);
        for (const [width, theme] of [[320, 'dark'], [390, 'light'], [1440, 'dark']]) {
            await owner.setViewportSize({ width, height: 844 });
            await owner.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
            const section = modal.getByRole('region', { name: 'Public link', exact: true });
            await owner.screenshot({ path: new URL(`public-link-modal-${width}.png`, dir).pathname, animations: 'disabled' });
            assert(await modal.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && el.scrollWidth <= el.clientWidth; }));
            const field = await input.boundingBox();
            const copy = modal.getByRole('button', { name: /^(Copy public link|Link copied)$/ });
            const open = modal.getByRole('link', { name: 'Open public link', exact: true });
            for (const control of [input, copy, open, modal.getByRole('button', { name: 'Remove link', exact: true })]) {
                const height = (await control.boundingBox()).height;
                assert(height >= 44, `${await control.getAttribute('aria-label') ?? await control.innerText()} must be touch-sized, got ${height}px`);
            }
            if (width < 640) {
                assert(field.width >= (await section.boundingBox()).width - 30, 'Give the URL its own full-width row');
                assert((await copy.boundingBox()).y >= field.y + field.height);
                assert((await open.boundingBox()).y >= field.y + field.height);
                assert.equal(await input.evaluate(el => getComputedStyle(el).fontSize), '16px', 'Avoid Safari focus zoom');
            }
        }
        await owner.setViewportSize({ width: 320, height: 844 });
        await modal.getByRole('button', { name: 'Remove link', exact: true }).click();
        const confirm = owner.getByRole('dialog', { name: 'Remove public link', exact: true });
        await confirm.waitFor();
        await owner.screenshot({ path: new URL('public-link-confirm.png', dir).pathname, animations: 'disabled' });
        await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(await input.inputValue(), url);
        assert.equal((await guest.request.get(url)).status(), 200);
        await modal.getByRole('button', { name: 'Remove link', exact: true }).click();
        await confirm.waitFor();
        await owner.keyboard.press('Escape');
        await confirm.waitFor({ state: 'hidden' });
        assert(await modal.isVisible());
        await owner.route(`**${endpoint}`, route => route.request().method() === 'DELETE' ? route.fulfill({ status: 500, json: { message: 'Unavailable' } }) : route.continue());
        await modal.getByRole('button', { name: 'Remove link', exact: true }).click();
        const failedRemoval = owner.waitForResponse(r => r.url() === `${base}${endpoint}` && r.request().method() === 'DELETE');
        await confirm.getByRole('button', { name: 'Remove link', exact: true }).click();
        assert.equal((await failedRemoval).status(), 500);
        await owner.getByRole('alert').filter({ hasText: 'could not be saved' }).first().waitFor();
        assert(await confirm.isVisible());
        assert.equal((await guest.request.get(url)).status(), 200, 'Failed removal must retain the public link');
        await owner.unroute(`**${endpoint}`);
        await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
        await confirm.waitFor({ state: 'hidden' });

        const response = await guest.goto(url);
        assert.equal(response.status(), 200);
        assert.match(response.headers()['cache-control'], /no-store/);
        const payload = await guest.request.get(url, { headers: { Accept: 'application/json' } });
        const published = await payload.json();
        assert(!published.app && !published.user && !published.collaborators);
        assert(!JSON.stringify(published).includes('@example.test'));
        assert(published.nodes.some(n => n.id === child.id && n.parent_id === note.id));
        for (const query of ['file=invalid', 'file[]=1', 'path[]=invalid']) {
            const invalid = await guest.request.get(`${url}?${query}`, { maxRedirects: 0 });
            assert.equal(invalid.status(), 404, 'Malformed links stay on the public error page');
            assert(!(await invalid.text()).includes(`${base}/build/assets/`), 'Public errors do not load private assets');
        }
        assert.equal((await guest.request.get(`${base}${path}`, { headers: { Accept: 'application/json' } })).status(), 403);
        const guestCsrf = decodeURIComponent((await guest.context().cookies()).find(c => c.name === 'XSRF-TOKEN').value);
        assert.equal((await guest.request.post(`${base}${endpoint}`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': guestCsrf } })).status(), 403);
        assert.equal((await guest.request.post(`${base}/mcp`, { headers: { Accept: 'application/json' }, data: {} })).status(), 403);
        assert.equal((await guest.request.get(`${url}/files?node=${pictureNode.id}`)).status(), 200);
        assert.equal((await guest.request.get(`${url}/files?node=${note.id}`, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await guest.request.get(`${url}/files?path=/../../config/docs.php`, { headers: { Accept: 'application/json' } })).status(), 404);
        const foreign = (await request(outsider, '/vaults', 'POST', { name: 'Private content' })).body.data;
        const foreignNote = (await request(outsider, `/vaults/${foreign.id}/nodes`, 'POST', { name: 'Secret', is_file: true })).body.data;
        const linkedSource = `${source}\n[Native absolute](${base}${path}?file=${child.id})\n\n[Native relative](${path}?file=${child.id})\n\n[Native fragment](${base}${path}?file=${child.id}#details)\n\n[Another vault](${base}/vaults/${foreign.id}?file=${foreignNote.id})\n\n[External origin](https://example.test${path}?file=${child.id})\n\n[Invalid file](${base}${path}?file=invalid)\n\n[Missing file](${base}${path}?file=99999999)\n`;
        const savedLinks = await request(owner, `${path}/nodes/${note.id}`, 'PATCH', { content: linkedSource });
        assert.equal(savedLinks.status, 200);
        assert.equal((await guest.request.get(`${url}?file=${foreignNote.id}`, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await guest.request.get(`${url}/files?node=${foreignNote.id}`, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await guest.request.patch(url, { headers: { Accept: 'application/json' }, data: { content: 'Forbidden' } })).status(), 405);

        await guest.getByRole('link', { name: 'Overview', exact: true }).click();
        const content = guest.locator('.tiptap');
        await content.getByRole('heading', { name: 'Public content', exact: true }).waitFor();
        for (const name of ['Native absolute', 'Native relative']) {
            const link = content.getByRole('link', { name, exact: true });
            assert.equal(await link.getAttribute('href'), `${url}?file=${child.id}`);
            assert.equal(await link.getAttribute('target'), '_self');
        }
        assert.equal(await content.getByRole('link', { name: 'Native fragment', exact: true }).getAttribute('href'), `${url}?file=${child.id}#details`);
        for (const [name, href] of [
            ['Another vault', `${base}/vaults/${foreign.id}?file=${foreignNote.id}`],
            ['External origin', `https://example.test${path}?file=${child.id}`],
            ['Invalid file', `${base}${path}?file=invalid`],
            ['Missing file', `${base}${path}?file=99999999`],
        ]) assert.equal(await content.getByRole('link', { name, exact: true }).getAttribute('href'), href);
        const copied = await content.getByRole('link', { name: 'Native absolute', exact: true }).getAttribute('href');
        const newTab = await guest.context().newPage();
        await newTab.goto(copied);
        await newTab.locator('.tiptap').getByText('Nested public note.', { exact: true }).waitFor();
        await newTab.close();
        await content.getByRole('link', { name: 'Native absolute', exact: true }).click();
        await guest.locator('.tiptap').getByText('Nested public note.', { exact: true }).waitFor();
        assert.equal(guest.url(), `${url}?file=${child.id}`);
        await guest.goBack();
        await content.getByRole('heading', { name: 'Public content', exact: true }).waitFor();
        await guest.goForward();
        await guest.locator('.tiptap').getByText('Nested public note.', { exact: true }).waitFor();
        await guest.goBack();
        await content.getByRole('heading', { name: 'Public content', exact: true }).waitFor();
        await content.getByRole('link', { name: 'Native relative', exact: true }).click();
        await guest.locator('.tiptap').getByText('Nested public note.', { exact: true }).waitFor();
        await guest.goBack();
        await content.getByRole('heading', { name: 'Public content', exact: true }).waitFor();
        const unchanged = await guest.request.get(`${url}?file=${note.id}`, { headers: { Accept: 'application/json' } });
        assert.equal((await unchanged.json()).selected.content, savedLinks.body.data.content, 'Reader mapping must preserve the stored Markdown');
        assert.equal(await content.getAttribute('contenteditable'), 'false');
        assert.equal(await guest.getByRole('button', { name: 'Edit document', exact: true }).count(), 0);
        await guest.waitForFunction(() => !!document.querySelector('.tiptap img')?.complete && document.querySelector('.tiptap img')?.naturalWidth > 0);
        assert((await content.locator('img').first().getAttribute('src')).startsWith(new URL(url).pathname));
        await guest.getByRole('button', { name: 'Preview HTML', exact: true }).click();
        const frame = guest.frameLocator('iframe[title="HTML preview"]');
        await frame.getByText('Rendered HTML', { exact: true }).waitFor();
        assert.equal(await guest.locator('iframe[title="HTML preview"]').getAttribute('sandbox'), '');
        assert.equal(await frame.locator('script').count(), 0);
        await guest.locator('.diagram svg[role="img"]').waitFor();
        await guest.getByRole('button', { name: 'Expand diagram', exact: true }).click();
        await guest.getByRole('dialog', { name: 'Public diagram', exact: true }).waitFor();
        await guest.getByRole('button', { name: 'Close diagram', exact: true }).click();
        for (const [width, theme] of [[320, 'dark'], [390, 'light'], [1440, 'dark']]) {
            await guest.setViewportSize({ width, height: 900 });
            if (await guest.evaluate(() => document.documentElement.classList.contains('dark')) !== (theme === 'dark')) await guest.getByRole('button', { name: 'Toggle theme', exact: true }).click();
            await guest.locator('#share-content').evaluate(el => el.scrollTo(0, 0));
            const link = content.getByRole('link', { name: 'Native absolute', exact: true });
            await guest.mouse.move(0, 0);
            assert.equal(await link.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
            await link.hover();
            assert.equal(await link.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
            await link.focus();
            assert.equal(await link.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
            assert(await link.evaluate(el => getComputedStyle(el).color !== getComputedStyle(el.closest('.tiptap')).color));
            await guest.locator('#share-content').evaluate(el => el.scrollTo(0, 0));
            assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            assert((await content.getByRole('heading', { name: 'Public content', exact: true }).boundingBox()).y >= 60, 'Content stays below the navbar');
            await guest.screenshot({ path: new URL(`public-${width}.png`, dir).pathname });
            if (width < 640) {
                await guest.getByRole('button', { name: 'Toggle document list', exact: true }).click();
                await guest.screenshot({ path: new URL(`public-list-${width}.png`, dir).pathname });
                await guest.getByRole('button', { name: 'Toggle document list', exact: true }).click();
            }
        }
        await content.getByText('Details', { exact: true }).click();
        await guest.locator('.tiptap').getByText('Nested public note.', { exact: true }).waitFor();
        await guest.getByRole('link', { name: 'Details', exact: true }).waitFor();
        await guest.goBack();
        await guest.locator('.tiptap').getByRole('heading', { name: 'Public content', exact: true }).waitFor();
        await guest.goForward();
        await guest.locator('.tiptap').getByText('Nested public note.', { exact: true }).waitFor();
        assert.deepEqual(blocked, [], 'Guest assets and navigation must stay beneath /share/');
        assert.deepEqual(writes, [], 'The public reader must not issue writes');

        assert.equal((await request(owner, `${path}/collaborations`, 'POST', { email: 'sam@example.test' })).status, 200);
        await modal.getByRole('button', { name: 'Remove link', exact: true }).click();
        await confirm.getByRole('button', { name: 'Remove link', exact: true }).click();
        await confirm.waitFor({ state: 'hidden' });
        await modal.getByRole('button', { name: 'Create link', exact: true }).waitFor();
        assert.equal(await input.count(), 0);
        assert.equal((await guest.request.get(url, { headers: { Accept: 'application/json' } })).status(), 404);
        await modal.getByRole('button', { name: 'Create link', exact: true }).click();
        await input.waitFor();
        const renewed = await input.inputValue();
        assert.notEqual(renewed, url);
        assert.equal((await request(outsider, endpoint, 'DELETE')).status, 200, 'Existing members may revoke a public link');
        assert.equal((await guest.request.get(renewed, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await guest.request.get(url, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await guest.request.get(`${url}/files?node=${pictureNode.id}`, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await guest.reload()).status(), 404);
        await guest.getByRole('alert').filter({ hasText: 'no longer available' }).waitFor();
        const next = (await request(outsider, endpoint, 'POST')).body.data.share_url;
        assert.notEqual(next, url);
        assert.equal((await guest.request.get(next)).status(), 200);
        assert.equal((await guest.request.get(url, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.equal((await request(owner, `${path}/nodes/${child.id}`, 'DELETE')).status, 200);
        assert.equal((await guest.request.get(`${next}?file=${child.id}`, { headers: { Accept: 'application/json' } })).status(), 404);
        const deleted = await request(owner, path, 'DELETE');
        assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
        assert.equal((await guest.request.get(next, { headers: { Accept: 'application/json' } })).status(), 404);
        assert.deepEqual(errors, []);
        return 'Anonymous read-only vault links load exclusively under /share, including nested navigation, images, sandboxed HTML and interactive diagrams at 320/390/1440px; authenticated opt-in/copy/revoke, failed saves, scoped files, blocked writes and rotated/deleted links work';
    } finally {
        for (const context of contexts) await context.close();
    }
}

// Verify the real Access boundary without publishing or reading any user vault.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const base = process.argv[2];
    assert(base, 'Usage: node tests/e2e/public.mjs https://docs.x44ylan.com');
    const checks = [];
    async function get(path) {
        const response = await fetch(new URL(path, base), {
            redirect: 'manual',
            headers: { Accept: 'text/html' },
            signal: AbortSignal.timeout(15000),
        });
        checks.push({ path, status: response.status, type: response.headers.get('content-type') });
        return response;
    }
    const response = await get(`/share/${'0'.repeat(22)}`);
    assert.equal(response.status, 404, 'The public reader must not require Cloudflare login');
    assert.match(response.headers.get('cache-control'), /no-store/);
    const html = await response.text();
    assert(html.includes('share-data') && html.includes('This link is no longer available.'));
    const legacy = await get(`/share/${'0'.repeat(64)}`);
    assert.equal(legacy.status, 404, 'Legacy public routes must remain accessible');
    assert((await legacy.text()).includes('share-data'));
    const assets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => new URL(match[1], base));
    assert(assets.some(asset => asset.pathname.endsWith('.js')));
    assert(assets.some(asset => asset.pathname.endsWith('.css')));
    for (const asset of assets) {
        // Cloudflare injects its analytics beacon independently of the Docs bundle.
        if (asset.origin === 'https://static.cloudflareinsights.com') continue;
        assert.equal(asset.origin, new URL(base).origin);
        assert(asset.pathname.startsWith('/share/'));
        const response = await get(asset.pathname + asset.search);
        assert.equal(response.status, 200, asset.pathname);
        assert.match(response.headers.get('content-type'), /javascript|css|image\//, asset.pathname);
    }
    for (const path of ['/', '/vaults', '/mcp']) {
        assert([302, 401, 403].includes((await get(path)).status), `${path} must remain authenticated`);
    }
    const dir = new URL('../../artifacts/e2e/', import.meta.url);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('public-edge.json', dir), JSON.stringify({ status: 'passed', checks }, null, 2));
    console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
}
