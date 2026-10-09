import assert from 'node:assert/strict';
import { options } from './editor.mjs';

// Failure cases: plain code/no preview, bad syntax blocking the editor, altered
// Markdown, stale asynchronous renders, cross-diagram state, mobile overflow,
// theme mismatch, broken public assets, injected scripts/links/network requests.
export async function mermaid({ browser, base, jwt, dir }) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], outbound = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (request.url().startsWith('http') && new URL(request.url()).origin !== base) outbound.push(request.url());
        if (request.method() === 'PATCH' && request.url().includes('/nodes/')) writes.push(request.url());
    });
    let guest;
    try {
        await page.goto(base);
        async function request(path, method, data) {
            return page.evaluate(async ({ path, method, data }) => {
                const token = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.slice(11);
                const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: JSON.stringify(data) });
                if (!response.ok) throw new Error(await response.text());
                return response.json();
            }, { path, method, data });
        }
        const vault = (await request('/vaults', 'POST', { name: 'Mermaid' })).data;
        const note = (await request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Mermaid', parent_id: null, is_file: true })).data;
        const path = `/vaults/${vault.id}/nodes/${note.id}`;
        const source = 'flowchart LR\n  Browser --> Docs\n  Docs --> SQLite';
        const sequence = 'sequenceDiagram\n  Alice->>Bob: Hello';
        const fence = text => `\`\`\`mermaid\n${text}\n\`\`\``;
        const markdown = `# Mermaid\n\n${fence(source)}\n\n${fence(sequence)}\n\nAfter diagrams.`;
        await request(path, 'PATCH', { content: markdown });
        await page.goto(`${base}/vaults/${vault.id}?file=${note.id}`);
        const panel = page.locator('.mermaid').first();
        const frame = panel.frameLocator('iframe');
        await frame.locator('svg').waitFor();
        await frame.getByText('SQLite', { exact: true }).waitFor();
        await page.locator('.mermaid').nth(1).frameLocator('iframe').locator('svg').waitFor();
        writes.length = 0;
        const initial = await frame.locator('svg').getAttribute('viewBox');
        await panel.getByRole('button', { name: 'Zoom in', exact: true }).click();
        await frame.locator('svg').evaluate((el, initial) => new Promise(resolve => {
            const check = () => el.getAttribute('viewBox') !== initial ? resolve(true) : requestAnimationFrame(check);
            check();
        }), initial);
        await panel.getByRole('button', { name: 'Reset view', exact: true }).click();
        for (const width of [320, 390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            for (const theme of ['light', 'dark']) {
                await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
                await frame.locator(`body[data-theme="${theme}"] svg`).waitFor();
                await panel.scrollIntoViewIfNeeded();
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: new URL(`mermaid-${width}-${theme}.png`, dir).pathname });
                await panel.getByRole('button', { name: 'Expand Mermaid', exact: true }).click();
                const modal = page.getByRole('dialog', { name: 'Mermaid', exact: true });
                await modal.frameLocator('iframe').locator('svg').waitFor();
                assert(await modal.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
                await page.keyboard.press('Escape');
                await panel.getByRole('button', { name: 'Expand Mermaid', exact: true }).waitFor();
            }
        }
        assert.equal(writes.length, 0, 'Rendering/zoom/theme must not save the document');
        await page.setViewportSize({ width: 1440, height: 900 });
        await panel.getByRole('button', { name: 'Show Mermaid code', exact: true }).click();
        assert.equal(await page.locator('code.language-mermaid').first().textContent(), source);
        await page.getByRole('button', { name: 'Preview Mermaid', exact: true }).click();
        await frame.locator('svg').waitFor();
        await page.getByRole('button', { name: 'Read document', exact: true }).click();
        await frame.locator('svg').waitFor();
        await page.reload();
        await frame.locator('svg').waitFor();
        const edit = page.getByRole('button', { name: 'Edit document', exact: true });
        if (await edit.isVisible()) await edit.click();
        async function mode(name) {
            await options(page);
            await page.getByRole('menuitem', { name, exact: true }).click();
        }
        await mode('Markdown source');
        assert.equal(await page.getByRole('textbox', { name: 'Markdown source', exact: true }).inputValue(), markdown);
        async function setSource(value) {
            const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(path));
            await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill(value);
            assert.equal((await saved).status(), 200);
            await mode('Rich text editor');
            const previews = page.getByRole('button', { name: 'Preview Mermaid', exact: true });
            while (await previews.count()) await previews.first().click();
        }
        await setSource(fence('not a diagram'));
        await panel.getByRole('alert').waitFor();
        await panel.getByRole('button', { name: 'Show Mermaid code', exact: true }).click();
        assert.equal(await page.locator('code.language-mermaid').textContent(), 'not a diagram');
        await mode('Markdown source');
        await setSource(fence(source));
        await frame.locator('svg').waitFor();
        // Exercise rich-text code edits and make sure the newest source renders.
        await panel.getByRole('button', { name: 'Show Mermaid code', exact: true }).click();
        const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(path));
        saved.catch(() => {});
        await page.locator('code.language-mermaid').evaluate(code => {
            const editor = code.closest('.tiptap').editor;
            const from = editor.view.posAtDOM(code, 0);
            editor.chain().focus().setTextSelection({ from, to: from + code.textContent.length }).run();
        });
        await page.waitForFunction(() => document.activeElement?.classList.contains('tiptap'));
        await page.keyboard.type('flowchart TD');
        await page.keyboard.press('Enter');
        await page.keyboard.type('  Current --> Result');
        assert.equal((await saved).status(), 200);
        await page.getByRole('button', { name: 'Preview Mermaid', exact: true }).click();
        await frame.getByText('Current', { exact: true }).waitFor();
        await mode('Markdown source');
        await setSource(fence('%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A["<img src=https://example.test/leak onerror=parent.hacked=1>"] --> B\n click B "https://example.test/leak"'));
        await frame.locator('svg').waitFor();
        assert.equal(await panel.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
        assert.equal(await panel.locator('iframe').evaluate(el => el.contentDocument), null, 'No same-origin access');
        assert.equal(await frame.locator('a[href], script:not([nonce]), [onclick], [onerror]').count(), 0);
        assert.equal(await page.evaluate(() => window.hacked), undefined);
        assert.deepEqual(outbound, [], 'Diagram text cannot fetch remote resources');
        await mode('Markdown source');
        await setSource(markdown);
        const share = (await request(`/vaults/${vault.id}/share`, 'POST', {})).data.share_url;
        guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const publicPage = await guest.newPage();
        await publicPage.goto(share);
        await publicPage.locator('.mermaid').first().frameLocator('iframe').locator('svg').waitFor();
        assert.equal(await publicPage.locator('.mermaid').count(), 2);
        assert.deepEqual(errors, []);
        return 'Mermaid flowcharts/sequence diagrams render in edit/read/public views; code round trips, error recovery, zoom/modal, theme/mobile layouts, multiple blocks and sandbox isolation pass';
    } catch (error) {
        await page.screenshot({ path: new URL('mermaid-failure.png', dir).pathname }).catch(() => {});
        throw error;
    } finally {
        await guest?.close();
        await context.close();
    }
}
