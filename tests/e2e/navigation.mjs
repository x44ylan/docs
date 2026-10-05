import { options } from './editor.mjs';
import assert from 'node:assert/strict';

export async function navigation({ browser, base, jwt, dir }) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(base);
        const request = (path, method, data) => page.evaluate(async ({ path, method, data }) => {
            const token = document.cookie.split('; ').find(v => v.startsWith('XSRF-TOKEN='))?.slice(11);
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: JSON.stringify(data) });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }, { path, method, data });
        // Reproduce Labs' encoded TOC with disposable content only.
        const labsVault = (await request('/vaults', 'POST', { name: 'TOC' })).data;
        const labsPath = `/vaults/${labsVault.id}`;
        const labs = (await request(`${labsPath}/nodes`, 'POST', { name: 'Labs', parent_id: null, is_file: true })).data;
        const topics = ['Dynamic Programming', 'Harness Architecture', 'Mobile App', 'Software Design'];
        const toc = [];
        for (const name of topics) {
            const note = (await request(`${labsPath}/nodes`, 'POST', { name, parent_id: labs.id, is_file: true })).data;
            await request(`${labsPath}/nodes/${note.id}`, 'PATCH', { content: `# ${name}\n\n[Back](../Labs.md)` });
            toc.push(`- [${name}](/Labs/${encodeURIComponent(name)}.md)`);
        }
        await request(`${labsPath}/nodes/${labs.id}`, 'PATCH', { content: `# Labs\n\n${toc.join('\n')}\n\n[External](https://example.test/a%20b?q=c%2Fd)` });
        for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${base}${labsPath}?file=${labs.id}`);
            await page.locator('.tiptap').getByRole('heading', { name: 'Labs', exact: true }).waitFor();
            await page.evaluate(() => { window.tocHeader = document.querySelector('#app-header'); });
            for (const mode of ['read', 'edit']) {
                await page.getByRole('button', { name: mode === 'read' ? 'Read document' : 'Edit document', exact: true }).click();
                for (const name of topics) {
                    const link = page.locator('.tiptap a').filter({ hasText: new RegExp(`^${name}$`) });
                    assert.equal(await link.getAttribute('data-href'), `/Labs/${encodeURIComponent(name)}.md`, 'TOC escapes must not be double-encoded');
                    await link.click();
                    await page.waitForFunction(name => document.querySelector('[aria-label="Document title"]')?.value === name, name);
                    await page.locator('.tiptap a').filter({ hasText: /^Back$/ }).click();
                    await page.locator('.tiptap').getByRole('heading', { name: 'Labs', exact: true }).waitFor();
                    assert(await page.evaluate(() => window.tocHeader === document.querySelector('#app-header')), 'TOC navigation stays in the SPA');
                }
            }
            assert.equal(await page.locator('.tiptap a').filter({ hasText: /^External$/ }).getAttribute('href'), 'https://example.test/a%20b?q=c%2Fd');
        }
        await page.locator('.tiptap').press('ControlOrMeta+End');
        const tocSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/nodes/${labs.id}`));
        await page.keyboard.press('Enter');
        await page.keyboard.type('A saved edit');
        assert.equal((await tocSaved).status(), 200);
        await page.reload();
        await page.locator('.tiptap a').filter({ hasText: /^Dynamic Programming$/ }).click();
        await page.waitForFunction(() => document.querySelector('[aria-label="Document title"]')?.value === 'Dynamic Programming');
        const vault = (await request('/vaults', 'POST', { name: 'Navigation' })).data;
        const path = `/vaults/${vault.id}`;
        const create = async (name, parent_id = null) => (await request(`${path}/nodes`, 'POST', { name, parent_id, is_file: true })).data;
        const parent = await create('Project');
        const a = await create('Alpha', parent.id);
        const b = await create('Bravo');
        const c = await create('Charlie');
        await request(`${path}/nodes/${b.id}`, 'PATCH', { content: 'Bravo original' });
        await request(`${path}/nodes/${c.id}`, 'PATCH', { content: 'Charlie original' });
        // Landing is the vault's own root note, never an arbitrary recent file.
        await create('Navigation', parent.id);
        const main = await create('navigation');
        await request(`${path}/nodes/${main.id}`, 'PATCH', { content: '# Vault overview\n\n[Bravo](Bravo.md)' });
        for (let i = 0; i < 11; i++) await create(`Later ${i}`);
        for (const width of [320, 390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${base}${path}`);
            await page.locator('.tiptap').getByRole('heading', { name: 'Vault overview', exact: true }).waitFor();
            assert.equal(await page.getByRole('textbox', { name: 'Document title', exact: true }).inputValue(), 'navigation');
            assert.equal(await page.getByText('Recent files', { exact: true }).count(), 0);
            const link = page.locator('.tiptap a').filter({ hasText: /^Bravo$/ });
            for (const theme of ['light', 'dark']) {
                await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
                await page.mouse.move(0, 0);
                assert.equal(await link.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
                await link.hover();
                assert.equal(await link.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
                assert(await link.evaluate(el => getComputedStyle(el).color !== getComputedStyle(el.closest('.tiptap')).color));
                await page.screenshot({ path: new URL(`links-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: new URL(`vault-main-${width}.png`, dir).pathname, animations: 'disabled' });
        }
        await page.reload();
        await page.locator('.tiptap').getByRole('heading', { name: 'Vault overview', exact: true }).waitFor();
        await page.locator('.tiptap a').filter({ hasText: /^Bravo$/ }).click();
        await page.waitForFunction(() => document.querySelector('[aria-label="Document title"]')?.value === 'Bravo');
        assert.equal((await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } })).status, 403);
        const share = (await request(`${path}/share`, 'POST')).data.share_url;
        assert.equal((await (await fetch(share, { headers: { Accept: 'application/json' } })).json()).selected.id, main.id, 'Public vaults open the same main note read-only');
        assert.equal((await (await fetch(`${share}?file=${b.id}`, { headers: { Accept: 'application/json' } })).json()).selected.id, b.id);
        // Index fallback failures: nested index selected, name-note priority lost,
        // explicit links overridden, editing exposed publicly, stale rename/delete.
        const indexed = (await request('/vaults', 'POST', { name: 'Indexed library' })).data;
        const indexedPath = `/vaults/${indexed.id}`;
        const indexNode = async (name, parent_id = null) => (await request(`${indexedPath}/nodes`, 'POST', { name, parent_id, is_file: true })).data;
        const branch = await indexNode('Branch');
        await indexNode('index', branch.id);
        await page.goto(`${base}${indexedPath}`);
        await page.getByText('Select a note', { exact: true }).waitFor();
        const index = await indexNode('INDEX');
        await request(`${indexedPath}/nodes/${index.id}`, 'PATCH', { content: '# Library index\n\n[Branch](Branch.md)' });
        const named = await indexNode('Indexed library');
        await request(`${indexedPath}/nodes/${named.id}`, 'PATCH', { content: '# Named overview' });
        await page.goto(`${base}${indexedPath}`);
        await page.locator('.tiptap').getByRole('heading', { name: 'Named overview', exact: true }).waitFor();
        await request(`${indexedPath}/nodes/${named.id}`, 'DELETE');
        const indexShare = (await request(`${indexedPath}/share`, 'POST')).data.share_url;
        const anonymous = await browser.newContext();
        try {
            const reader = await anonymous.newPage();
            for (const width of [390, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                await page.goto(`${base}${indexedPath}`);
                await page.locator('.tiptap').getByRole('heading', { name: 'Library index', exact: true }).waitFor();
                await reader.setViewportSize({ width, height: 900 });
                await reader.goto(indexShare);
                await reader.locator('.tiptap').getByRole('heading', { name: 'Library index', exact: true }).waitFor();
                assert.equal(await reader.locator('.tiptap').getAttribute('contenteditable'), 'false');
                assert(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            }
            await reader.reload();
            await reader.locator('.tiptap').getByRole('heading', { name: 'Library index', exact: true }).waitFor();
            assert.equal((await (await fetch(`${indexShare}?file=${branch.id}`, { headers: { Accept: 'application/json' } })).json()).selected.id, branch.id);
            await request(`${indexedPath}/nodes/${index.id}`, 'PATCH', { name: 'Renamed index' });
            assert.equal((await (await fetch(indexShare, { headers: { Accept: 'application/json' } })).json()).selected, null);
            await request(`${indexedPath}/nodes/${index.id}`, 'DELETE');
            assert.equal((await (await fetch(indexShare, { headers: { Accept: 'application/json' } })).json()).selected, null);
        } finally {
            await anonymous.close();
        }
        const empty = (await request('/vaults', 'POST', { name: 'Empty' })).data;
        const emptyPath = `/vaults/${empty.id}`;
        await page.goto(`${base}${emptyPath}`);
        await page.getByText('Select a note', { exact: true }).waitFor();
        assert.equal((await request(`${emptyPath}/nodes`, 'GET')).children.length, 0, 'Opening a vault must not create content');
        assert.equal((await page.request.get(`${base}${emptyPath}?file=${main.id}`)).status(), 404, 'Explicit note links remain vault-scoped');
        await request(`${path}/nodes/${main.id}`, 'PATCH', { name: 'Renamed overview' });
        await page.goto(`${base}${path}`);
        await page.getByText('Select a note', { exact: true }).waitFor();
        assert.equal(await page.getByText('Recent files', { exact: true }).count(), 0);
        await request(`${path}/nodes/${main.id}`, 'PATCH', { name: 'navigation' });
        await page.goto(`${base}${path}?file=${a.id}`);
        await page.locator('.tiptap').waitFor();
        const title = page.getByRole('textbox', { name: 'Document title', exact: true });
        const editor = page.locator('.tiptap');
        const open = name => page.locator('aside').getByTitle(name, { exact: true }).click();
        const ready = async (name, content) => {
            await page.waitForFunction(name => document.querySelector('[aria-label="Document title"]')?.value === name && !document.querySelector('[aria-label="Loading document"]'), name);
            if (content) await page.waitForFunction(content => document.querySelector('.tiptap')?.textContent.includes(content), content);
        };
        const visits = [];
        page.on('request', r => { if (r.headers()['x-inertia']) visits.push(r); });
        await page.evaluate(() => {
            window.navigationProbe = { header: document.querySelector('#app-header'), aside: document.querySelector('aside'), loads: performance.getEntriesByType('navigation').length, overlay: false };
            new MutationObserver(() => { if (document.querySelector('[aria-label="Loading"]')) window.navigationProbe.overlay = true; }).observe(document.body, { childList: true, subtree: true });
        });
        await title.fill('Alpha renamed');
        await editor.fill('Alpha draft saved before switching');
        await open('Bravo');
        await ready('Bravo', 'Bravo original');
        assert.equal(visits.length, 1);
        assert.equal(visits[0].headers()['x-inertia-partial-data'], 'openedFile');
        assert(await page.evaluate(() => window.navigationProbe.header === document.querySelector('#app-header') && window.navigationProbe.aside === document.querySelector('aside')));
        assert.equal(await page.getByRole('button', { name: 'Collapse Project', exact: true }).count(), 1);
        await editor.press('Control+z');
        assert(!(await editor.innerText()).includes('Alpha draft'), 'Undo cannot cross documents');
        await open('Alpha renamed');
        await ready('Alpha renamed', 'Alpha draft saved before switching');
        const count = visits.length;
        await open('Alpha renamed');
        await page.waitForTimeout(150);
        assert.equal(visits.length, count, 'Active document is a no-op');

        // Markdown is serialized after a typing pause; opening the source must flush it first.
        await editor.press('Control+End');
        await page.keyboard.type(' typed just now');
        const mode = async name => {
            await options(page);
            await page.getByRole('menuitem', { name, exact: true }).click();
        };
        await mode('Markdown source');
        assert.match(await page.getByRole('textbox', { name: 'Markdown source', exact: true }).inputValue(), /typed just now$/, 'Source view shows unsynced rich-text edits');
        await mode('Rich text editor');

        // A failed save preserves the draft and prevents switching. Retrying flushes it.
        await page.route(`**/nodes/${a.id}`, route => route.fulfill({ status: 503, json: { message: 'Try again' } }));
        await editor.fill('Unsaved draft survives a failure');
        await open('Bravo');
        await page.getByText('The service is temporarily unavailable. Try again shortly.').waitFor();
        assert.equal(await title.inputValue(), 'Alpha renamed');
        assert((await editor.innerText()).includes('Unsaved draft survives a failure'));
        await page.unroute(`**/nodes/${a.id}`);
        await open('Bravo');
        await ready('Bravo');
        await page.goBack();
        await ready('Alpha renamed', 'Unsaved draft survives a failure');
        const historyCount = visits.length;
        await page.goForward();
        await ready('Bravo', 'Bravo original');
        assert.equal(visits.length, historyCount, 'History restores locally, without a second reload');
        assert.equal(await page.getByRole('button', { name: 'Collapse Project', exact: true }).count(), 1);

        // A slow old visit must not win over the next click; sidebar remains usable.
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route(`**${path}?file=${a.id}`, async route => {
            await held;
            await route.continue().catch(() => {});
        });
        const pending = page.waitForRequest(r => r.url().endsWith(`?file=${a.id}`));
        await open('Alpha renamed');
        await pending;
        await page.getByRole('status', { name: 'Loading document', exact: true }).waitFor();
        assert.equal(await page.getByRole('status', { name: 'Loading', exact: true }).count(), 0);
        await open('Charlie');
        release();
        await ready('Charlie', 'Charlie original');
        await page.unroute(`**${path}?file=${a.id}`);
        const beforeClose = visits.length;
        await editor.fill('Charlie draft saved on return');
        await page.evaluate(() => { window.mainReturnProbe = { header: document.querySelector('#app-header'), aside: document.querySelector('aside') }; });
        await options(page);
        await page.getByRole('menuitem', { name: 'Close file', exact: true }).click();
        await ready('navigation', 'Vault overview');
        assert.equal(visits.length, beforeClose + 1, 'Returning to the vault fetches only its main note');
        assert.equal(visits.at(-1).headers()['x-inertia-partial-data'], 'openedFile');
        assert(await page.evaluate(() => window.mainReturnProbe.header === document.querySelector('#app-header') && window.mainReturnProbe.aside === document.querySelector('aside')));
        await page.goBack();
        await ready('Charlie', 'Charlie draft saved on return');

        // Leaf notes stay openable and accept children, but have no empty expander.
        const arrow = name => page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) });
        assert.equal(await arrow('Bravo').count(), 0);
        assert.equal(await arrow('Charlie').count(), 0);
        assert.equal(await arrow('Alpha renamed').count(), 0);
        await page.getByRole('button', { name: 'Actions for Charlie', exact: true }).click();
        await page.getByRole('button', { name: 'New sub-note', exact: true }).click();
        await page.getByRole('textbox', { name: 'Document name' }).fill('Temporary');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await ready('Temporary');
        await page.getByRole('button', { name: 'Collapse Charlie', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Actions for Temporary', exact: true }).click();
        await page.getByRole('button', { name: 'Move to…', exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Move to', exact: true });
        await picker.getByRole('button', { name: 'Open Bravo', exact: true }).click();
        await picker.getByRole('button', { name: 'Move here', exact: true }).click();
        await picker.waitFor({ state: 'hidden' });
        assert.equal(await arrow('Charlie').count(), 0, 'Moving the last child hides its old parent arrow');
        await page.getByRole('button', { name: 'Collapse Bravo', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Actions for Temporary', exact: true }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByRole('dialog', { name: 'Delete file', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
        await ready('navigation', 'Vault overview');
        assert.equal(await arrow('Bravo').count(), 0, 'Deleting the last child hides its parent arrow');
        assert.equal(await page.locator('aside').getByText('No sub-notes', { exact: true }).count(), 0, 'Empty branches do not leave placeholder rows');
        await open('Charlie');
        await ready('Charlie', 'Charlie draft saved on return');

        // Branch arrows still expand by keyboard and touch.
        const collapse = page.getByRole('button', { name: 'Collapse Project', exact: true });
        assert.equal(await collapse.locator('svg').count(), 1);
        await collapse.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Expand Project', exact: true }).waitFor();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Collapse Project', exact: true }).waitFor();
        await page.screenshot({ path: new URL('navigation-1440.png', dir).pathname });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: 'Toggle document tree' }).tap();
        await page.getByRole('button', { name: 'Collapse Project', exact: true }).tap();
        await page.getByRole('button', { name: 'Expand Project', exact: true }).tap();
        await page.screenshot({ path: new URL('navigation-390.png', dir).pathname });
        await page.locator('aside').getByTitle('Alpha renamed', { exact: true }).tap();
        await ready('Alpha renamed', 'Unsaved draft survives a failure');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.evaluate(() => window.navigationProbe.overlay), false);
        assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), 1);
        await request(`${path}/nodes/${main.id}`, 'DELETE');
        await page.goto(`${base}${path}`);
        await page.getByText('Select a note', { exact: true }).waitFor();
        assert.equal(await page.getByText('Recent files', { exact: true }).count(), 0);
        assert.equal((await (await fetch(share, { headers: { Accept: 'application/json' } })).json()).selected, null);
        assert.deepEqual(errors, []);
        return 'Labs-style encoded TOC links open all four children in edit/read modes at 390/1440px without reloads; relative return links, external URL escapes and save/reload work. Vault main note opens at 320/390/1440px and in public links; root index fallback opens anonymously at 390/1440px, keeps named-note priority and explicit links, excludes nested indexes and handles rename/delete. Missing main notes and empty vaults are safe. SPA shell, save-before-return/switch, failure/retry, note links beyond recents, isolated undo, latest-click wins, history and branch-only arrows work';
    } catch (error) {
        await page.screenshot({ path: new URL('navigation-failure.png', dir).pathname }).catch(() => {});
        throw error;
    } finally {
        await context.close();
    }
}
