import assert from 'node:assert/strict';

export async function mcp({ browser, base, jwt, dir, fixture }) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const rpc = async (method, params = {}, email = 'alex@example.test') => {
        const response = await fetch(`${base}/mcp`, {
            method: 'POST',
            headers: { 'Cf-Access-Jwt-Assertion': jwt(email), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert(!body.error);
        return body.result;
    };
    const call = (name, args, email) => rpc('tools/call', { name, arguments: args }, email);
    const data = result => {
        assert(!result.isError, result.content[0].text);
        return JSON.parse(result.content[0].text);
    };
    try {
        const tool = (await rpc('tools/list')).tools.find(tool => tool.name === 'move');
        assert(tool, 'MCP must advertise the move tool');
        assert.deepEqual(tool.inputSchema.required, ['noteId', 'parentId']);
        assert.deepEqual(tool.inputSchema.properties.parentId.type, ['integer', 'null']);
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.equal(tool.annotations.readOnlyHint, false);
        assert.equal(tool.annotations.destructiveHint, false);
        await page.goto(base);
        const request = (path, method, body) => page.evaluate(async ({ path, method, body }) => {
            const token = document.cookie.split('; ').find(value => value.startsWith('XSRF-TOKEN='))?.slice(11);
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: body === undefined ? undefined : JSON.stringify(body) });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }, { path, method, body });
        const vault = (await request('/vaults', 'POST', { name: 'MCP moves' })).data;
        const path = `/vaults/${vault.id}`;
        const create = async (name, content, parentId) => data(await call('create', { vaultId: vault.id, name, content, ...(parentId === undefined ? {} : { parentId }) }));
        const parent = await create('Project', '# Project');
        const note = await create('Guide', '# Move me\n\nContent survives.');
        const child = await create('Details', '# Child content', note.id);
        const reference = await create('Reference', '[Guide](/Guide.md)\n\n[Details](/Guide/Details.md)');
        const collision = await create('Guide', 'Do not overwrite.', parent.id);
        const csrf = decodeURIComponent((await context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN').value);
        const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
        const upload = await context.request.post(`${base}${path}/import`, { headers: { 'X-XSRF-TOKEN': csrf, Accept: 'application/json' }, multipart: { parent_id: String(child.id), 'files[]': { name: 'pixel.png', mimeType: 'image/png', buffer: picture } } });
        assert.equal(upload.status(), 200);
        const attachment = (await upload.json()).files[0];
        const moved = data(await call('move', { noteId: note.id, parentId: parent.id }));
        assert.equal(moved.id, note.id);
        assert.equal(moved.vault_id, vault.id);
        assert.equal(moved.parent_id, parent.id);
        assert.equal(moved.name, 'Guide-1', 'Use the browser collision-safe filename');
        assert.equal(moved.content, note.content);
        assert.equal(data(await call('read', { noteId: collision.id })).content, 'Do not overwrite.');
        assert.equal(data(await call('read', { noteId: child.id })).content, child.content);
        assert(data(await call('list', { vaultId: vault.id })).data.some(item => item.id === child.id && item.parent_id === note.id));
        const links = data(await call('read', { noteId: reference.id })).content;
        assert(links.includes('/Project/Guide-1.md'));
        assert(links.includes('/Project/Guide-1/Details.md'));
        const file = async location => {
            const response = await context.request.get(`${base}/files/${vault.id}?path=${encodeURIComponent(location)}`);
            assert.equal(response.status(), 200);
            assert.deepEqual(await response.body(), picture);
        };
        await file('/Project/Guide-1/Details/pixel.png');
        assert.equal(data(await call('move', { noteId: note.id, parentId: parent.id })).name, moved.name, 'Retry must not rename again');
        const foreign = data(await call('create', { vaultId: fixture.vaults[1], name: 'Foreign parent', content: '' }));
        const privateNote = data(await call('list', { vaultId: fixture.vaults[5] }, 'sam@example.test')).data[0];
        const sharedParent = data(await call('create', { vaultId: fixture.vaults[4], name: 'Shared parent', content: '' }, 'sam@example.test'));
        const sharedNote = data(await call('create', { vaultId: fixture.vaults[4], name: 'Shared note', content: '# Shared' }, 'sam@example.test'));
        assert.equal(data(await call('move', { noteId: sharedNote.id, parentId: sharedParent.id })).parent_id, sharedParent.id, 'Accepted collaborators can move notes');
        for (const args of [
            { noteId: note.id }, { parentId: parent.id }, { noteId: null, parentId: parent.id },
            { noteId: note.id, parentId: String(parent.id) }, { noteId: String(note.id), parentId: parent.id },
            { noteId: note.id, parentId: 0 }, { noteId: note.id, parentId: true },
            { noteId: note.id, parentId: [] }, { noteId: note.id, parentId: 1.5 },
            { noteId: note.id, parentId: parent.id, extra: true },
            { noteId: note.id, parentId: note.id }, { noteId: note.id, parentId: child.id },
            { noteId: note.id, parentId: attachment.id }, { noteId: note.id, parentId: foreign.id },
            { noteId: note.id, parentId: privateNote.id }, { noteId: note.id, parentId: 999999 },
            { noteId: privateNote.id, parentId: null }, { noteId: attachment.id, parentId: parent.id },
            { noteId: 999999, parentId: null }
        ]) assert((await call('move', args)).isError, `Must reject ${JSON.stringify(args)}`);
        assert((await call('move', { noteId: note.id, parentId: null }, 'sam@example.test')).isError);
        assert(data(await call('list', { vaultId: vault.id })).data.some(item => item.id === note.id && item.parent_id === parent.id && item.name === moved.name), 'Failed requests leave the note in place');
        assert.equal(data(await call('read', { noteId: note.id })).content, note.content);
        // Revoking access applies to MCP immediately; restore the fixture afterwards.
        const owner = data(await call('me', {}));
        await request(`/vaults/${fixture.vaults[4]}/collaborations/${owner.id}`, 'DELETE');
        assert((await call('move', { noteId: sharedNote.id, parentId: null })).isError);
        const sam = await browser.newContext({ extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('sam@example.test') } });
        try {
            await sam.request.get(`${base}/vaults/${fixture.vaults[4]}`);
            const token = decodeURIComponent((await sam.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN').value);
            assert.equal((await sam.request.post(`${base}/vaults/${fixture.vaults[4]}/collaborations`, { headers: { 'X-XSRF-TOKEN': token, Accept: 'application/json' }, data: { email: 'alex@example.test' } })).status(), 200);
        } finally {
            await sam.close();
        }
        for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${base}${path}?file=${note.id}`);
            await page.locator('.tiptap').getByRole('heading', { name: 'Move me', exact: true }).waitFor();
            const toggle = page.getByRole('button', { name: 'Toggle document tree' });
            if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
            await page.getByRole('button', { name: 'Expand Guide-1', exact: true }).click();
            await page.locator(`[data-node="${parent.id}"] [data-node="${note.id}"] [data-node="${child.id}"]`).waitFor({ state: 'visible' });
            await page.screenshot({ path: new URL(`mcp-${width}.png`, dir).pathname, animations: 'disabled' });
        }
        const root = data(await call('move', { noteId: note.id, parentId: null }));
        assert.equal(root.parent_id, null);
        assert.equal(root.content, note.content);
        await file('/Guide-1/Details/pixel.png');
        assert(data(await call('read', { noteId: reference.id })).content.includes('/Guide-1/Details.md'));
        const folder = (await request(`${path}/nodes`, 'POST', { name: 'Archive', is_file: false })).data;
        assert.equal(data(await call('move', { noteId: note.id, parentId: folder.id })).parent_id, folder.id);
        await file('/Archive/Guide-1/Details/pixel.png');
        assert.equal(data(await call('read', { noteId: child.id })).content, child.content);
        assert.deepEqual(errors, []);
        return 'MCP move: explicit nullable destination, same-vault parenting, root/folder moves, safe retries, collision-safe names, preserved children/attachments/backlinks, rejected cycles/invalid arguments, shared and revoked permissions, phone/desktop editor';
    } catch (error) {
        await page.screenshot({ path: new URL('mcp-failure.png', dir).pathname });
        throw error;
    } finally {
        await context.close();
    }
}
