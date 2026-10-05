import assert from 'node:assert/strict';
import { tools, options, format } from './editor.mjs';

// Failure cases: duplicate chrome, overflow at breakpoints, unusable title,
// clipped menus, lost selection/focus, disabled formatting bypass, lost saves,
// stale tools after SPA navigation/close, or missing home/search/tree/account.
export async function header({ browser, base, jwt, dir, baseline }) {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const category = name => format(page, name);
    try {
        await page.goto(base);
        const request = (path, method, data) => page.evaluate(async ({ path, method, data }) => {
            const token = document.cookie.split('; ').find(value => value.startsWith('XSRF-TOKEN='))?.slice(11);
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: JSON.stringify(data) });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }, { path, method, data });
        const vault = (await request('/vaults', 'POST', { name: 'Header check' })).data;
        const path = `/vaults/${vault.id}`;
        const note = (await request(`${path}/nodes`, 'POST', { name: 'Header check', parent_id: null, is_file: true })).data;
        await request(`${path}/nodes/${note.id}`, 'PATCH', { content: 'Selected text stays editable.' });
        await page.goto(`${base}${path}?file=${note.id}`);
        const editor = page.locator('.tiptap');
        await editor.getByText('Selected text stays editable.').waitFor();
        const title = page.getByRole('textbox', { name: 'Document title', exact: true });
        for (const width of [320, 390, 639, 640, 768, 1023, 1024, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            for (const theme of ['light', 'dark']) {
                await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                assert.equal(await page.locator('#app-header').evaluate(el => el.parentElement.getBoundingClientRect().height), 60);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
                assert.equal(await title.evaluate(el => getComputedStyle(el).fontSize), !baseline && width >= 1024 ? '14px' : '16px');
                if (!baseline) {
                    assert(await title.evaluate(el => !!el.closest('#app-header')), 'Title belongs to the shared header');
                    if (width >= 1024) assert(await page.getByRole('group', { name: 'Document formatting' }).evaluate(el => !!el.closest('#app-header')), 'Formatting belongs to the shared header');
                    else assert(await page.getByRole('button', { name: 'Show formatting', exact: true }).isVisible());
                    assert((await title.boundingBox()).width >= 100, `${width}px title is too narrow`);
                    assert(await page.locator('#app-header').evaluate(el => {
                        const boxes = [...el.querySelectorAll('button, a, input')].map(control => control.getBoundingClientRect()).filter(box => box.width && box.height);
                        return boxes.every(box => box.left >= 0 && box.right <= innerWidth && Math.abs(box.top + box.height / 2 - 30) < 1);
                    }), `${width}px controls fit and align`);
                    assert.equal(await page.locator('main').getByRole('textbox', { name: 'Document title' }).count(), 0);
                    assert.equal(await page.locator('main').getByRole('group', { name: 'Document formatting' }).count(), 0);
                    if (width >= 1024) assert(await page.locator('#file-tools').evaluate(el => {
                        const box = el.getBoundingClientRect();
                        return Math.abs(box.left + box.width / 2 - innerWidth / 2) < 1;
                    }), 'Desktop formatting uses the centre of the header');
                }
                await page.screenshot({ path: new URL(`header-${baseline ? 'before-' : ''}${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
            }
            for (const [group, item] of [['Heading', 'Heading 2'], ['Block styles', 'Paragraph'], ['Text styles', 'Bold'], ['Lists', 'Task list'], ['Insert', 'Link'], ['Tables', 'Insert table']]) {
                await category(group);
                const action = page.getByRole('menuitem', { name: item, exact: true });
                await action.waitFor();
                await page.waitForFunction(name => {
                    const item = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === name);
                    const box = item?.getBoundingClientRect();
                    return box && box.left >= 0 && box.right <= innerWidth;
                }, item);
                assert(await action.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), `${group} fits at ${width}px`);
                if (!baseline && ['Block styles', 'Text styles'].includes(group)) {
                    await page.getByRole('menuitem', { name: 'Back to editor options', exact: true }).click();
                    await page.getByRole('menuitem', { name: group, exact: true }).waitFor();
                    assert.equal(await action.count(), 0, 'Back restores the main panel');
                }
                await page.keyboard.press('Escape');
                await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, !baseline && ['Block styles', 'Text styles'].includes(group) ? 'More editor options' : group);
            }
            if (!baseline && width < 1024) {
                await page.getByRole('button', { name: 'Close formatting', exact: true }).click();
                assert(await title.isVisible());
                assert(await page.getByRole('button', { name: 'Search documents', exact: true }).isVisible());
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await editor.focus();
        await page.keyboard.press('ControlOrMeta+a');
        assert.equal(await page.evaluate(() => window.getSelection()?.toString()), 'Selected text stays editable.', 'Keyboard selects document text');
        const [saved] = await Promise.all([
            page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/nodes/${note.id}`), { timeout: 20000 }),
            (async () => {
                await category('Text styles');
                await page.getByRole('menuitem', { name: 'Bold', exact: true }).waitFor();
                await page.screenshot({ path: new URL('header-selection.png', dir).pathname });
                await page.getByRole('menuitem', { name: 'Bold', exact: true }).click();
                await editor.locator('strong').getByText('Selected text stays editable.').waitFor();
            })(),
        ]);
        assert.equal(saved.status(), 200);
        if (!baseline) {
            assert.equal(await page.getByRole('button', { name: 'Bold', exact: true }).getAttribute('aria-pressed'), 'true');
            await page.setViewportSize({ width: 1440, height: 900 });
            await title.waitFor();
            assert.equal(await page.getByRole('button', { name: 'Bold', exact: true }).count(), 1);
            assert.equal(await page.getByRole('button', { name: 'Show formatting', exact: true }).count(), 0);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.getByRole('button', { name: 'Show formatting', exact: true }).waitFor();
            await tools(page);
        }
        await page.getByRole('button', { name: 'Read document', exact: true }).click();
        await page.locator('.tiptap[contenteditable="false"]').waitFor();
        if (baseline) assert(await page.getByRole('button', { name: 'Heading', exact: true }).isDisabled());
        else {
            assert.equal(await page.getByRole('button', { name: 'Show formatting', exact: true }).count(), 0);
            assert.equal(await page.getByRole('button', { name: 'Close formatting', exact: true }).count(), 0);
            assert.equal(await page.getByRole('group', { name: 'Document formatting' }).count(), 0);
            assert(await title.isVisible());
            assert(await page.getByRole('button', { name: 'Search documents', exact: true }).isVisible());
            await page.screenshot({ path: new URL('header-read-390.png', dir).pathname, animations: 'disabled' });
            await page.reload();
            await page.locator('.tiptap[contenteditable="false"]').waitFor();
            assert.equal(await page.getByRole('button', { name: 'Show formatting', exact: true }).count(), 0);
        }
        await page.getByRole('button', { name: 'Edit document', exact: true }).click();
        await options(page);
        await page.getByRole('menuitem', { name: 'Markdown source', exact: true }).click();
        await page.getByRole('textbox', { name: 'Markdown source', exact: true }).waitFor();
        await options(page);
        if (!baseline) assert.equal(await page.getByRole('menuitem', { name: 'Block styles', exact: true }).getAttribute('data-disabled'), '');
        await page.getByRole('menuitem', { name: 'Rich text editor', exact: true }).click();
        if (!baseline) await page.getByRole('button', { name: 'Close formatting', exact: true }).click();
        const renamed = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/nodes/${note.id}`));
        await title.fill('One header');
        assert.equal((await renamed).status(), 200);
        await page.reload();
        await editor.locator('strong').getByText('Selected text stays editable.').waitFor();
        assert.equal(await title.inputValue(), 'One header');
        if (!baseline) {
            await tools(page);
            await page.getByRole('button', { name: 'Toggle document tree', exact: true }).click();
            assert(await title.isVisible(), 'Opening the tree returns to document navigation');
            assert(await page.getByRole('button', { name: 'Show formatting', exact: true }).isVisible());
            await page.getByRole('button', { name: 'Toggle document tree', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Search documents', exact: true }).click();
        await page.getByRole('dialog', { name: 'Search', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'User menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Vaults', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        if (!baseline) {
            await options(page);
            await page.getByRole('menuitem', { name: 'Close file', exact: true }).click();
            await page.getByText('Select a note', { exact: true }).waitFor();
            assert.equal(await page.getByRole('group', { name: 'Document formatting' }).count(), 0);
            assert.equal(await title.count(), 0);
        }
        assert.deepEqual(errors, []);
        return `${baseline ? 'Existing editor baseline' : 'Single 60px header'} at eight widths/both themes; menu fit, keyboard focus, selection, rename/save/reload, read/source locks, search/account${baseline ? '' : ' and close cleanup'} verified`;
    } catch (error) {
        await page.screenshot({ path: new URL('header-failure.png', dir).pathname }).catch(() => {});
        throw error;
    } finally {
        await context.close();
    }
}
