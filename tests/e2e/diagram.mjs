import { options } from './editor.mjs';
import assert from 'node:assert/strict';

export async function diagram(page, dir) {
    const spec = {
        schema_version: 1, diagram_type: 'architecture',
        meta: { title: 'Docs architecture', viewBox: [760, 390] },
        components: [
            { id: 'browser', type: 'external', label: 'Browser', sublabel: 'Your workspace', pos: [40, 80], size: [180, 64] },
            { id: 'docs', type: 'backend', label: 'Docs', sublabel: 'Notes + collaboration', pos: [300, 80], size: [180, 64] },
            { id: 'db', type: 'database', label: 'SQLite', sublabel: 'Persistent storage', pos: [560, 80], size: [160, 64] },
            { id: 'agent', type: 'security', label: 'MCP agent', sublabel: 'Same identity', pos: [300, 270], size: [180, 64] },
        ],
        connections: [
            { from: 'browser', to: 'docs', label: 'Access' },
            { from: 'docs', to: 'db', label: 'Read / write' },
            { from: 'agent', to: 'docs', label: 'OAuth', labelAt: [427, 214] },
        ],
        boundaries: [{ kind: 'region', label: 'Private workspace', wraps: ['docs', 'db'], pad: 24 }],
    };
    const source = JSON.stringify(spec, null, 2);
    const markdown = `# Diagrams\n\n\`\`\`archify\n${source}\n\`\`\`\n\nAfter diagram.`;
    async function mode(name) {
        await options(page);
        await page.getByRole('menuitem', { name, exact: true }).click();
    }
    async function setSource(value) {
        await mode('Markdown source');
        const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/nodes/'));
        // Keep a slow/missing textbox from turning the pending response timeout
        // into an unhandled rejection before the runner can record evidence.
        saved.catch(() => {});
        await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill(value);
        assert.equal((await saved).status(), 200);
        await mode('Rich text editor');
        const previews = page.getByRole('button', { name: 'Preview diagram', exact: true });
        while (await previews.count()) await previews.first().click();
    }
    await setSource(markdown);
    const panel = page.locator('.diagram').first();
    const canvas = panel.locator('svg[role="img"]');
    await canvas.waitFor();
    assert.equal(await panel.getByText('SQLite', { exact: true }).count(), 1);
    const initial = await canvas.getAttribute('viewBox');
    await panel.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert.notEqual(await canvas.getAttribute('viewBox'), initial);
    await panel.getByRole('button', { name: 'Reset view', exact: true }).click();

    // Browser-dispatched touch events exercise real pointer capture and pinch.
    const touch = await page.context().newCDPSession(page);
    const touchBox = await canvas.boundingBox();
    const center = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: center.x - 20, y: center.y }, { id: 2, x: center.x + 20, y: center.y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: center.x - 45, y: center.y }, { id: 2, x: center.x + 45, y: center.y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    assert.notEqual(await canvas.getAttribute('viewBox'), initial, 'Pinch zoom updates the viewport');
    await panel.getByRole('button', { name: 'Reset view', exact: true }).click();
    assert.equal(await canvas.getAttribute('viewBox'), initial);
    await panel.locator('.diagram-stage').focus();
    await page.keyboard.press('+');
    assert.notEqual(await canvas.getAttribute('viewBox'), initial);
    await page.keyboard.press('0');
    assert.equal(await canvas.getAttribute('viewBox'), initial);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 60, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await canvas.getAttribute('viewBox'), initial);
    await panel.getByRole('button', { name: 'Reset view', exact: true }).click();

    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
            await panel.scrollIntoViewIfNeeded();
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: new URL(`diagram-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
            await panel.getByRole('button', { name: 'Expand diagram', exact: true }).click();
            const modal = page.getByRole('dialog', { name: 'Docs architecture', exact: true });
            await modal.waitFor();
            assert(await modal.evaluate(el => {
                const b = el.getBoundingClientRect();
                return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
            }));
            await page.keyboard.press('Tab');
            assert(await modal.evaluate(el => el.contains(document.activeElement)), 'Modal traps focus');
            await page.screenshot({ path: new URL(`diagram-modal-${width}-${theme}.png`, dir).pathname, animations: 'disabled' });
            await page.keyboard.press('Escape');
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert(await panel.getByRole('button', { name: 'Expand diagram', exact: true }).evaluate(el => el === document.activeElement));
        }
    }
    await page.getByRole('button', { name: 'Show diagram code', exact: true }).click();
    assert.equal(await page.locator('code.language-archify').textContent(), source);
    await page.reload();
    await canvas.waitFor();
    await page.getByRole('button', { name: 'Read document', exact: true }).click();
    await panel.getByRole('button', { name: 'Expand diagram', exact: true }).click();
    await page.getByRole('button', { name: 'Close diagram', exact: true }).click();
    await page.getByRole('button', { name: 'Edit document', exact: true }).click();
    await mode('Markdown source');
    const persisted = await page.getByRole('textbox', { name: 'Markdown source', exact: true }).inputValue();
    assert(persisted.includes(source), 'JSON survives save/reload and read mode');
    assert(!persisted.includes('<svg'), 'Diagram UI is not serialized');
    await mode('Rich text editor');

    for (const invalid of ['{', JSON.stringify({ ...spec, diagram_type: 'unknown' }), JSON.stringify({ ...spec, components: [spec.components[0], spec.components[0]] }), JSON.stringify({ ...spec, connections: [{ from: 'missing', to: 'docs' }] }), JSON.stringify({ ...spec, components: Array(151).fill(spec.components[0]) })]) {
        await setSource(`\`\`\`archify\n${invalid}\n\`\`\``);
        await page.locator('.diagram [role="alert"]').waitFor();
        await page.getByRole('button', { name: 'Show diagram code', exact: true }).click();
        assert.equal(await page.locator('code.language-archify').textContent(), invalid);
    }
    const literal = structuredClone(spec);
    literal.components[0].label = '<b>Literal label</b>';
    await setSource(`\`\`\`archify\n${JSON.stringify(literal)}\n\`\`\`\n\n\`\`\`archify\n${source}\n\`\`\`\n\n\`\`\`json\n${source}\n\`\`\``);
    assert.equal(await page.locator('.diagram').count(), 2);
    await page.locator('.diagram').first().getByText('<b>Literal label</b>', { exact: true }).waitFor();
    assert.equal(await page.locator('.diagram b, .diagram script, .diagram iframe, .diagram a').count(), 0);
    const ids = await page.locator('.diagram marker').evaluateAll(els => els.map(el => el.id));
    assert(ids.length > 0);
    assert.equal(new Set(ids).size, ids.length);
    const second = page.locator('.diagram').nth(1).locator('svg[role="img"]');
    const secondView = await second.getAttribute('viewBox');
    await panel.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert.equal(await second.getAttribute('viewBox'), secondView);
    await setSource(markdown);
    await page.setViewportSize({ width: 320, height: 900 });
}
