import assert from 'node:assert/strict';

export async function sharing({ browser, base, jwt, dir, socketPort, layout = true }) {
    const contexts = [];
    const sockets = [];
    const errors = [];
    async function session(email) {
        const context = await browser.newContext({ extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt(email) } });
        contexts.push(context);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        return page;
    }
    async function request(page, path, method = 'GET', data) {
        return page.evaluate(async ({ path, method, data }) => {
            const token = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='));
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token.slice(11)) }, body: data === undefined ? undefined : JSON.stringify(data) });
            return { status: response.status, body: await response.json().catch(() => null) };
        }, { path, method, data });
    }
    async function home(page) {
        const response = await page.request.get(`${base}/`);
        return JSON.parse((await response.text()).match(/<script\b[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/)[1]).props;
    }
    async function call(email, name, args = {}) {
        const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt(email), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
        assert.equal(response.status, 200);
        return (await response.json()).result;
    }
    const data = result => { assert(!result.isError, result.content?.[0]?.text); return JSON.parse(result.content[0].text); };
    async function until(predicate) {
        for (let i = 0; i < 100; i++) {
            if (predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.fail('Expected WebSocket message did not arrive');
    }
    async function subscribe(page, channel) {
        const socket = new WebSocket(`ws://127.0.0.1:${socketPort}/app/fixture?protocol=7&client=js&version=8.4.0`);
        sockets.push(socket);
        const messages = [];
        socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
        await until(() => messages.some(m => m.event === 'pusher:connection_established'));
        const socketId = JSON.parse(messages.find(m => m.event === 'pusher:connection_established').data).socket_id;
        const auth = await request(page, '/broadcasting/auth', 'POST', { socket_id: socketId, channel_name: channel });
        assert.equal(auth.status, 200);
        socket.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel, auth: auth.body.auth } }));
        await until(() => messages.some(m => m.event === 'pusher_internal:subscription_succeeded'));
        return messages;
    }
    try {
        const owner = await session('sharing-owner@example.test');
        const member = await session('sharing-member@example.test');
        const guest = await session('sharing-guest@example.test');
        const guestId = (await home(guest)).app.user.id;
        const ownerId = (await home(owner)).app.user.id;
        const created = await request(owner, '/vaults', 'POST', { name: 'Sharing checks' });
        assert.equal(created.status, 200);
        const id = created.body.data.id, path = `/vaults/${id}`, access = `${path}/collaborations`;
        assert(!(await home(guest)).visibleVaults.some(v => v.id === id));
        assert.equal((await request(guest, access, 'PATCH', { is_public: true })).status, 403);
        assert.equal((await request(owner, access, 'PATCH', { is_public: 'everyone' })).status, 422);
        assert.equal((await request(owner, access, 'POST', { email: 'sharing-member@example.test' })).status, 200);

        for (const [width, theme] of (layout ? [[320, 'dark'], [390, 'light'], [1440, 'dark']] : [])) {
            await owner.setViewportSize({ width, height: 900 });
            await owner.evaluate(value => localStorage.setItem('theme', value), theme);
            await owner.goto(`${base}${path}`);
            const toggle = owner.getByRole('button', { name: 'Toggle document tree' });
            if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
            const share = owner.getByRole('button', { name: 'Collaboration', exact: true });
            const menu = owner.getByRole('button', { name: 'Vault menu', exact: true });
            await share.waitFor();
            const a = await share.boundingBox(), b = await menu.boundingBox();
            assert(a.width >= 36 && a.height >= 36 && b.width >= 44);
            assert(Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 1 && a.x + a.width <= b.x + 1);
            await menu.click();
            assert.equal(await owner.getByRole('button', { name: 'Collaboration', exact: true }).count(), 1);
            await menu.click();
            await share.focus();
            await owner.keyboard.press('Enter');
            const modal = owner.getByRole('dialog', { name: 'Collaboration', exact: true });
            await modal.waitFor();
            const picker = modal.getByRole('button', { name: 'Access', exact: true });
            assert.equal((await picker.innerText()).trim(), 'Restricted');
            assert.equal(await modal.getByText('Anyone with the link can read this vault.', { exact: true }).count(), 0);
            assert.equal(await modal.locator('select').count(), 0);
            await owner.screenshot({ path: new URL(`sharing-${width}.png`, dir).pathname });
            assert(await modal.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
            await picker.focus();
            await owner.keyboard.press('Enter');
            const choices = owner.getByRole('menu');
            await choices.waitFor();
            assert.equal(await choices.getByRole('menuitemradio', { name: 'Restricted', exact: true }).getAttribute('aria-checked'), 'true');
            assert.equal(await choices.getByRole('menuitemradio', { name: 'Public', exact: true }).getAttribute('aria-checked'), 'false');
            assert(await choices.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
            await owner.screenshot({ path: new URL(`sharing-access-${width}.png`, dir).pathname });
            await owner.keyboard.press('Escape');
            await choices.waitFor({ state: 'hidden' });
            assert(await modal.isVisible(), 'Closing the access menu must keep Collaboration open');
            await owner.waitForFunction(() => document.activeElement?.id === 'vault-access', undefined, { timeout: 3000 });
            await owner.keyboard.press('Escape');
            await modal.waitFor({ state: 'hidden' });
            await owner.screenshot({ path: new URL(`sharing-button-${width}.png`, dir).pathname });
        }

        if (!layout) {
            await owner.goto(`${base}${path}`);
            const toggle = owner.getByRole('button', { name: 'Toggle document tree' });
            if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        }
        await owner.getByRole('button', { name: 'Collaboration', exact: true }).click();
        const select = owner.getByRole('button', { name: 'Access', exact: true });
        await owner.route(`**${access}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { message: 'Unavailable' } }) : route.continue());
        await select.click();
        await owner.getByRole('menuitemradio', { name: 'Public', exact: true }).click();
        await owner.getByRole('alert').filter({ hasText: 'could not be saved' }).first().waitFor();
        assert.equal((await select.innerText()).trim(), 'Restricted');
        await owner.unroute(`**${access}`);
        const saved = owner.waitForResponse(r => r.url() === `${base}${access}` && r.request().method() === 'PATCH');
        await select.focus();
        await owner.keyboard.press('Enter');
        await owner.keyboard.press('End');
        await owner.keyboard.press('Enter');
        assert.equal((await saved).status(), 200);
        await owner.reload();
        await owner.getByRole('button', { name: 'Collaboration', exact: true }).click();
        assert.equal((await select.innerText()).trim(), 'Public');
        const publicModal = owner.getByRole('dialog', { name: 'Collaboration', exact: true });
        assert.equal(await publicModal.getByText('Everyone signed into Docs can read and edit.', { exact: true }).count(), 0);
        assert.equal(await publicModal.getByText('Anyone with the link can read this vault.', { exact: true }).count(), 0);
        await owner.screenshot({ path: new URL('sharing-public.png', dir).pathname });
        await owner.setViewportSize({ width: 320, height: 844 });
        await owner.screenshot({ path: new URL('sharing-public-mobile.png', dir).pathname });
        assert(await select.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
        assert((await home(guest)).visibleVaults.some(v => v.id === id && v.is_public));
        assert(data(await call('sharing-guest@example.test', 'vaults')).data.some(v => v.id === id));
        const first = await session('sharing-first@example.test');
        assert((await home(first)).visibleVaults.some(v => v.id === id));
        assert.equal((await guest.request.get(`${base}${path}`)).status(), 200);

        const note = data(await call('sharing-guest@example.test', 'create', { vaultId: id, name: 'Public note', content: '# Shared content' }));
        assert.equal((await request(guest, `${path}/nodes/${note.id}`, 'PATCH', { content: '# Edited by all users' })).status, 200);
        assert.equal(data(await call('sharing-first@example.test', 'read', { noteId: note.id })).content, '# Edited by all users');
        assert(data(await call('sharing-first@example.test', 'search', { query: 'Public note' })).data.some(n => n.id === note.id));
        assert.equal((await request(guest, `${path}/nodes`)).status, 200);
        assert.equal((await request(guest, `${path}/editor/search?search=Public`)).status, 200);
        assert.equal((await guest.request.get(`${base}${path}/export`)).status(), 200);
        assert((await home(guest)).recentDocuments.some(n => n.id === note.id));
        assert.equal((await request(guest, path, 'DELETE')).status, 422, 'Vault deletion stays owner-only');
        assert.equal((await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } })).status, 403);
        assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read', arguments: { noteId: note.id } } }) })).status, 403);

        const auth = (page, channel) => request(page, '/broadcasting/auth', 'POST', { socket_id: '123.456', channel_name: channel });
        assert.equal((await auth(guest, `private-Vault.${id}.${guestId}`)).status, 200);
        assert.equal((await auth(guest, `private-Vault.${id}.${ownerId}`)).status, 403);
        assert.equal((await auth(guest, `private-Vault.${id}`)).status, 403);
        const guestMessages = await subscribe(guest, `private-Vault.${id}.${guestId}`);
        const ownerMessages = await subscribe(owner, `private-Vault.${id}.${ownerId}`);
        assert.equal((await request(owner, `${path}/nodes/${note.id}`, 'PATCH', { content: '# Public broadcast' })).status, 200);
        await until(() => guestMessages.some(m => m.event.endsWith('VaultNodeUpdatedEvent') && JSON.stringify(m.data).includes('Public broadcast')));

        assert.equal((await request(member, access, 'PATCH', { is_public: false })).status, 200, 'Explicit collaborators can manage sharing');
        assert(!(await home(guest)).visibleVaults.some(v => v.id === id));
        assert((await home(member)).visibleVaults.some(v => v.id === id));
        assert(!(await home(first)).recentDocuments.some(n => n.vault_id === id));
        assert((await call('sharing-guest@example.test', 'read', { noteId: note.id })).isError);
        assert((await call('sharing-guest@example.test', 'update', { noteId: note.id, content: 'Denied' })).isError);
        for (const route of [path, `${path}/nodes`, `${path}/editor/search?search=Public`, `${path}/export`]) assert.equal((await request(guest, route)).status, 403);
        assert.equal((await request(guest, `${path}/nodes/${note.id}`, 'PATCH', { content: 'Denied' })).status, 403);
        assert.equal((await request(guest, `${path}/nodes/${note.id}`, 'DELETE')).status, 403);
        assert.equal((await request(guest, access, 'PATCH', { is_public: true })).status, 403);
        assert.equal((await auth(guest, `private-Vault.${id}.${guestId}`)).status, 403);
        const offset = guestMessages.length;
        assert.equal((await request(owner, `${path}/nodes/${note.id}`, 'PATCH', { content: '# Private broadcast' })).status, 200);
        await until(() => ownerMessages.some(m => m.event.endsWith('VaultNodeUpdatedEvent') && JSON.stringify(m.data).includes('Private broadcast')));
        await new Promise(resolve => setTimeout(resolve, 250));
        assert(!guestMessages.slice(offset).some(m => JSON.stringify(m.data).includes('Private broadcast')), 'Previously authorized sockets receive no future private content');

        assert.equal((await request(member, access, 'PATCH', { is_public: true })).status, 200);
        assert.equal((await request(first, `${path}/nodes/${note.id}`, 'DELETE')).status, 200);
        assert.equal((await request(owner, path, 'DELETE')).status, 200);
        assert(!(await home(first)).visibleVaults.some(v => v.id === id));
        assert.deepEqual(errors, []);
        return layout
            ? 'Shared themed access menu at 320/390/1440px with keyboard selection and focus recovery; direct collaboration button, public/restricted access persists across browser and MCP, anonymous access stays blocked, revocation excludes old sockets, explicit members survive and failed saves recover'
            : 'Public/restricted access persists across browser and MCP; anonymous access stays blocked, committed note edits broadcast, revocation excludes old sockets, explicit members survive, failed saves recover and deletion works';
    } finally {
        for (const socket of sockets) socket.close();
        for (const context of contexts) await context.close();
    }
}
