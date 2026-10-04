import assert from 'node:assert/strict';

export async function html(page, dir) {
    const editor = page.locator('.tiptap');
    const source = `<style>body{background:#f4f4f5}.card{padding:20px;border:1px solid #aaa;border-radius:12px}h2{color:rgb(30,80,120)}</style>
<section class="card"><h2>HTML preview</h2><p>Inline CSS, saved with your document.</p><p>&lt;literal&gt; &amp; &#169;</p></section>`;
    const markdown = `# Preview example\n\n\`\`\`html\n${source}\n\`\`\`\n\n\`\`\`js\nconst value = "<literal> &amp;";\n\`\`\`\n\nInline: \`<b>&lt;</b>\`\n\n<div>Raw HTML stays text</div>\n\n<https://example.com>\n\nAfter preview.`;
    const waitSave = () =>
        page.waitForResponse(
            (response) =>
                response.request().method() === 'PATCH' && response.url().includes('/nodes/')
        );
    async function mode(name) {
        await page.getByRole('button', { name: 'More editor options', exact: true }).click();
        await page.getByRole('menuitem', { name, exact: true }).click();
    }
    async function setSource(value) {
        const showCode = page.getByRole('button', { name: 'Show HTML code', exact: true });
        if (await showCode.isVisible()) await showCode.click();
        await mode('Markdown source');
        const saved = waitSave();
        await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill(value);
        const response = await saved;
        assert.equal(response.status(), 200);
        assert.equal(
            response.request().postDataJSON().content,
            value,
            'Multiline source paste retains line breaks'
        );
        await mode('Rich text editor');
    }
    await setSource(markdown);
    const code = editor.locator('code.language-html');
    assert.equal(await code.textContent(), source);
    assert.equal(
        await editor.getByRole('button', { name: 'Preview HTML', exact: true }).count(),
        1
    );
    assert.equal(
        await editor.locator('code.language-js').textContent(),
        'const value = "<literal> &amp;";'
    );
    assert.equal(await editor.locator('p > code').textContent(), '<b>&lt;</b>');
    assert(await editor.getByText('<div>Raw HTML stays text</div>', { exact: true }).isVisible());
    assert.equal(
        await editor
            .getByRole('link', { name: 'https://example.com', exact: true })
            .getAttribute('href'),
        'https://example.com'
    );

    const background = await page
        .locator('body')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: 'Preview HTML', exact: true }).focus();
    await page.keyboard.press('Enter');
    const frame = page.frameLocator('iframe[title="HTML preview"]');
    await frame.getByRole('heading', { name: 'HTML preview' }).waitFor();
    assert.equal(await page.locator('iframe[title="HTML preview"]').getAttribute('sandbox'), '');
    assert.equal(
        await frame.locator('h2').evaluate((el) => getComputedStyle(el).color),
        'rgb(30, 80, 120)'
    );
    assert(await frame.getByText('<literal> & ©', { exact: true }).isVisible());
    assert.equal(
        await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
        background
    );
    assert.equal(await code.isVisible(), false);
    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('iframe[title="HTML preview"]').scrollIntoViewIfNeeded();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(
            await page.locator('iframe[title="HTML preview"]').evaluate((el) => {
                const box = el.getBoundingClientRect();
                return box.left >= 0 && box.right <= innerWidth;
            })
        );
        await page.screenshot({
            path: new URL(`html-${width}.png`, dir).pathname,
            animations: 'disabled'
        });
    }
    await page.getByRole('button', { name: 'Read document', exact: true }).click();
    await page.getByRole('button', { name: 'Show HTML code', exact: true }).click();
    assert.equal(await code.textContent(), source);
    await page.getByRole('button', { name: 'Preview HTML', exact: true }).click();
    await frame.locator('h2').waitFor();
    await page.getByRole('button', { name: 'Edit document', exact: true }).click();
    await page.getByRole('button', { name: 'Show HTML code', exact: true }).click();
    const saved = waitSave();
    await code.click();
    const end = await code.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return el.closest('.tiptap').editor.view.posAtDOM(range.endContainer, range.endOffset);
    });
    // selectionchange updates Tiptap asynchronously; typing earlier uses the click's caret.
    await page.waitForFunction(end => {
        const selection = document.querySelector('.tiptap').editor.state.selection;
        return selection.from === end && selection.to === end;
    }, end);
    await page.keyboard.type(' ');
    const response = await saved;
    assert.equal(response.status(), 200);
    const persisted = response.request().postDataJSON().content;
    assert(persisted.includes(source), 'HTML entities and literal source survive rich-text saves');
    assert(!persisted.includes('Content-Security-Policy'), 'Preview wrapper is never serialized');
    await page.reload();
    assert((await code.textContent()).includes(source));
    await page.getByRole('button', { name: 'Preview HTML', exact: true }).click();
    await frame.locator('h2').waitFor();

    // Benign fixtures verify that preview capabilities remain disabled.
    let requests = 0;
    await page.route('**/preview-check/**', (route) => {
        requests++;
        return route.abort();
    });
    const restricted = `<h2>Static only</h2>
<script>document.body.dataset.ran = 'yes';</script>
<a href="https://example.invalid/preview-check/link">No navigation</a>
<form action="/preview-check/form"><input><button>Submit</button></form>
<iframe src="/preview-check/frame"></iframe>
<meta http-equiv="refresh" content="0;url=/preview-check/refresh">
<img src="https://example.invalid/preview-check/image">
<style>body{background-image:url('https://example.invalid/preview-check/style')}</style>`;
    await setSource(`\`\`\`html\n${restricted}\n\`\`\``);
    await page.getByRole('button', { name: 'Preview HTML', exact: true }).click();
    await frame.getByRole('heading', { name: 'Static only' }).waitFor();
    assert.equal(await frame.locator('body').getAttribute('data-ran'), null);
    assert.equal(
        await frame
            .locator('script, form, input, button, iframe, meta[http-equiv="refresh"]')
            .count(),
        0
    );
    assert.equal(await frame.locator('a').getAttribute('href'), null);
    assert.equal(requests, 0, 'No preview network requests');
    assert.equal(
        await page.locator('iframe[title="HTML preview"]').evaluate((el) => el.contentDocument),
        null,
        'Frame has an opaque origin'
    );
    await page.unroute('**/preview-check/**');
    await setSource('```html\n\n```\n\n```html\n<h2>Second preview</h2>\n```');
    await page.getByRole('button', { name: 'Preview HTML', exact: true }).first().click();
    await page.locator('iframe[title="HTML preview"]').waitFor();
    await page.getByRole('button', { name: 'Preview HTML', exact: true }).click();
    assert.equal(await page.locator('iframe[title="HTML preview"]').count(), 2);
    await page
        .frameLocator('iframe[title="HTML preview"]')
        .nth(1)
        .getByRole('heading', { name: 'Second preview' })
        .waitFor();
    const showCode = page.getByRole('button', { name: 'Show HTML code', exact: true });
    while (await showCode.count()) {
        await showCode.first().click();
    }
    assert.equal(await page.locator('iframe[title="HTML preview"]').count(), 0);
    await setSource(markdown);
    await page.setViewportSize({ width: 320, height: 900 });
}
