import assert from 'node:assert/strict';

export async function ui({ browser, base, jwt, dir }) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(base);
        const request = (path, method, data) => page.evaluate(async ({ path, method, data }) => {
            const token = document.cookie.split('; ').find(value => value.startsWith('XSRF-TOKEN='))?.slice(11);
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: JSON.stringify(data) });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }, { path, method, data });
        const vault = (await request('/vaults', 'POST', { name: 'Design notes' })).data;
        const path = `/vaults/${vault.id}`;
        const create = async (name, parent_id = null, content = '') => {
            const node = (await request(`${path}/nodes`, 'POST', { name, parent_id, is_file: true })).data;
            if (content) await request(`${path}/nodes/${node.id}`, 'PATCH', { content });
            return { ...node, content };
        };
        const main = await create('Design notes', null, '# A calmer place to think\n\nKeep your projects, ideas and references together. Notes stay simple, connected and easy to find.\n\n## Your workspace\n\nStart with one note. Add sub-notes when an idea needs more room, and share the vault when you are ready to work together.\n\n- A compact tree for all your notes\n- Search without leaving your document\n- An editor that gets out of your way\n\n## Make it yours\n\nSwitch between light and dark, edit Markdown directly, or keep writing in the rich text editor.\n\n> Good tools leave room for your ideas.');
        const project = await create('Getting started');
        const child = await create('Architecture', project.id, '# Architecture\n\nA clear structure for the next idea.');
        await create('Decisions');
        await create('References');
        await page.goto(`${base}${path}?file=${child.id}`);
        await page.locator('.tiptap').getByRole('heading', { name: 'Architecture', exact: true }).waitFor();
        const breadcrumb = page.getByLabel('Document path', { exact: true });
        assert.match(await breadcrumb.getAttribute('title'), /Design notes.*Getting started.*Architecture/s);
        const title = page.getByRole('textbox', { name: 'Document title', exact: true });
        const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/nodes/${child.id}`));
        await title.fill('System design');
        assert.equal((await saved).status(), 200);
        await page.waitForFunction(() => document.querySelector('[aria-label="Document path"]')?.getAttribute('title').includes('System design'));
        const parents = page.getByLabel('Parent path', { exact: true });
        for (const width of [320, 390, 1024, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction(() => document.querySelector('[aria-label="Parent path"]')?.textContent.trim() === 'Design notes / Getting started');
            for (const theme of ['light', 'dark']) {
                await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
                assert(await parents.isVisible());
                assert.equal(await title.inputValue(), 'System design');
                const parentBox = await parents.boundingBox();
                const titleBox = await title.boundingBox();
                assert(parentBox.y >= 0 && parentBox.y + parentBox.height <= titleBox.y, 'Parent path sits above title');
                assert(titleBox.width >= (width < 360 ? 64 : 100) && titleBox.y + titleBox.height <= 60, 'Title remains usable inside header');
                assert.equal(await page.locator('#app-header').evaluate(el => el.parentElement.getBoundingClientRect().height), 60);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: new URL(`ui-path-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
            }
            if (width < 1024) {
                await page.getByRole('button', { name: 'Show formatting', exact: true }).click();
                assert.equal(await parents.isVisible(), false);
                await page.getByRole('button', { name: 'Close formatting', exact: true }).click();
                assert(await parents.isVisible());
            }
        }
        const longParent = 'A long parent directory name that must never push the editor controls off screen';
        await request(`${path}/nodes/${project.id}`, 'PATCH', { name: longParent });
        await page.reload();
        await parents.getByText(`Design notes / ${longParent}`, { exact: true }).waitFor();
        await page.setViewportSize({ width: 320, height: 900 });
        await page.waitForFunction(name => document.querySelector('[aria-label="Parent path"]')?.textContent.trim() === `Design notes / ${name}`, longParent);
        assert(await parents.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis'), 'Long parents truncate');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert((await title.boundingBox()).width >= 64);
        assert.match(await breadcrumb.getAttribute('title'), new RegExp(longParent));
        await request(`${path}/nodes/${project.id}`, 'PATCH', { name: 'Getting started' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForFunction(() => document.querySelector('[aria-label="Toggle document tree"]')?.getAttribute('aria-expanded') === 'true');
        await page.locator('aside').getByTitle('Design notes', { exact: true }).last().click();
        await page.locator('.tiptap').getByRole('heading', { name: 'A calmer place to think' }).waitFor();
        assert.equal(await parents.count(), 0, 'Main note has no redundant parent path');
        for (const width of [320, 390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction(small => document.querySelector('[aria-label="Toggle document tree"]')?.getAttribute('aria-expanded') === String(!small), width < 1024);
            for (const theme of ['light', 'dark']) {
                await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px document overflow`);
                assert.equal(await page.locator('#app-header').evaluate(el => el.parentElement.getBoundingClientRect().height), 60);
                const editorSize = await page.locator('.tiptap').evaluate(el => getComputedStyle(el).fontSize);
                assert.equal(editorSize, width < 640 ? '14px' : '15px');
                assert.equal(await title.evaluate(el => getComputedStyle(el).fontSize), width < 1024 ? '16px' : '14px', 'Phone title avoids Safari input zoom');
                await page.screenshot({ path: new URL(`ui-editor-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
                if (width < 1024) {
                    await page.getByRole('button', { name: 'Show formatting', exact: true }).click();
                    await page.screenshot({ path: new URL(`ui-tools-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
                    const strip = page.getByRole('group', { name: 'Document formatting' });
                    assert(await strip.evaluate(el => { const box = el.getBoundingClientRect(); return box.width >= 170 && box.left >= 0 && box.right <= innerWidth; }));
                    await page.getByRole('button', { name: 'More editor options', exact: true }).scrollIntoViewIfNeeded();
                    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                    await page.getByRole('button', { name: 'Close formatting', exact: true }).click();
                    assert(await title.isVisible());
                }
                if (width < 1024) await page.getByRole('button', { name: 'Toggle document tree' }).click();
                assert.equal(await page.getByRole('button', { name: 'Search this vault', exact: true }).count(), 0);
                const search = page.getByRole('button', { name: 'Search documents', exact: true });
                const add = page.locator('aside').getByRole('button', { name: 'New note', exact: true });
                const addBox = await add.boundingBox();
                const shareBox = await page.getByRole('button', { name: 'Collaboration', exact: true }).boundingBox();
                assert(addBox && addBox.height >= (width < 640 ? 44 : 36));
                assert(shareBox && Math.abs(addBox.y - shareBox.y) < 1, 'New note stays in the compact vault header');
                await page.screenshot({ path: new URL(`ui-tree-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
                await search.focus();
                await page.keyboard.press('Enter');
                await page.getByRole('dialog', { name: 'Search', exact: true }).waitFor();
                await page.keyboard.press('Escape');
                await page.getByRole('dialog', { name: 'Search', exact: true }).waitFor({ state: 'hidden' });
                await add.click();
                await page.getByRole('dialog', { name: 'New note', exact: true }).waitFor();
                await page.keyboard.press('Escape');
                await page.getByRole('dialog', { name: 'New note', exact: true }).waitFor({ state: 'hidden' });
                if (width < 1024) await page.getByRole('button', { name: 'Toggle document tree' }).click();
            }
        }
        const contentSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/nodes/${main.id}`));
        await page.locator('.tiptap').fill('Preview editing still saves.');
        await page.getByRole('button', { name: 'Read document', exact: true }).click();
        await page.locator('.tiptap[contenteditable="false"]').waitFor();
        assert.equal((await contentSaved).status(), 200);
        await page.reload();
        await page.locator('.tiptap').getByText('Preview editing still saves.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Edit document', exact: true }).click();
        await request(`${path}/nodes/${main.id}`, 'PATCH', { content: main.content });
        await page.goto(`${base}${path}?file=${main.id}`);
        await page.locator('.tiptap').getByRole('heading', { name: 'A calmer place to think' }).waitFor();
        assert.deepEqual(errors, []);
        return { message: 'UI screenshots at 320/390/1440px and nested paths at 1024px in both themes; visible responsive parent paths, long-name truncation, breadcrumb rename/SPA, fixed header, formatting toggle, overflow, typography, autosave and read/edit verified', path: `${path}?file=${main.id}` };
    } catch (error) {
        await page.screenshot({ path: new URL('ui-failure.png', dir).pathname }).catch(() => {});
        throw error;
    } finally {
        await context.close();
    }
}
