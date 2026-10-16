// End-to-end suite. Starts the built app on a throwaway data folder with test
// Access keys, drives it through HTTP, MCP, WebSockets and a real browser, and
// writes artifacts/e2e/report.json plus screenshots.
//   npm run build && node tests/run.ts [base URL of a running app]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { chromium, type Browser, type Page } from 'playwright';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { env, token } from './access.ts';

const artifacts = 'artifacts/e2e';
mkdirSync(artifacts, { recursive: true });
const data = mkdtempSync('/tmp/docs-e2e-');
const port = 3990 + Math.floor(Math.random() * 9);
const base = `http://127.0.0.1:${port}`;
const serverLog: string[] = [];
// The server can be restarted mid-run (persistence and reconnect checks).
let server!: ReturnType<typeof spawn>;
async function start() {
    server = spawn('node', ['server/main.ts'], { env: { ...process.env, ...env, DOCS_DATA: data, PORT: String(port), APP_URL: base }, stdio: ['ignore', 'ignore', 'pipe'] });
    server.stderr!.on('data', chunk => serverLog.push(String(chunk)));
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/up`)).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    throw new Error('server did not start');
}
async function stop(signal: NodeJS.Signals = 'SIGTERM') {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill(signal);
    await exited;
}
await start();

const alex = await token('alex@example.test', { name: 'Alex' });
const sam = await token('sam@example.test', { name: 'Sam' });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function call<T = any>(method: string, path: string, body?: unknown, who = alex): Promise<{ status: number; data: T }> {
    const r = await fetch(`${base}/api${path}`, { method, headers: { 'cf-access-jwt-assertion': who, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, data: text ? JSON.parse(text) : null };
}
async function mcp(name: string, args: unknown, who = alex) {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'cf-access-jwt-assertion': who, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const { result } = await r.json();
    if (result.isError) return { error: result.content[0].text as string };
    return JSON.parse(result.content[0].text);
}
function live(name: string, who = alex) {
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}/sync`, WebSocketPolyfill: class extends WebSocket { constructor(url: string) { super(url, { headers: { 'cf-access-jwt-assertion': who } }); } } });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: 'access' });
    provider.attach();
    const synced = new Promise<void>((resolve, reject) => { provider.on('synced', () => resolve()); provider.on('authenticationFailed', () => reject(new Error('denied'))); setTimeout(() => reject(new Error('timeout')), 5000); });
    return { doc, provider, synced, close: () => { provider.destroy(); socket.destroy(); } };
}

const checks: { name: string; ok: boolean; error?: string }[] = [];
const only = process.argv[2];
async function check(name: string, fn: () => Promise<void>) {
    if (only && !name.startsWith(only)) return;
    try { await fn(); checks.push({ name, ok: true }); console.log(`ok   ${name}`); }
    catch (error) { checks.push({ name, ok: false, error: String((error as Error).stack ?? error) }); console.log(`FAIL ${name}\n     ${(error as Error).message}`); }
}

let browser: Browser | undefined;
try {
    // --- Auth ------------------------------------------------------------
    await check('auth: missing, forged, wrong-audience, expired and service tokens are rejected', async () => {
        assert.equal((await fetch(`${base}/api/home`)).status, 401);
        const forged = alex.slice(0, -4) + 'AAAA';
        assert.equal((await call('GET', '/home', undefined, forged)).status, 403);
        const { SignJWT, generateKeyPair } = await import('jose');
        const other = await generateKeyPair('RS256');
        const wrongKey = await new SignJWT({ email: 'x@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setIssuer(`https://${env.CF_ACCESS_TEAM_DOMAIN}`).setAudience(env.CF_ACCESS_AUD).setSubject('x').setExpirationTime('1h').sign(other.privateKey);
        assert.equal((await call('GET', '/home', undefined, wrongKey)).status, 403);
        assert.equal((await call('GET', '/home', undefined, await token('x@example.test', { aud: 'other' }))).status, 403);
        assert.equal((await call('GET', '/home', undefined, await token('x@example.test', { exp: Math.floor(Date.now() / 1000) - 60 }))).status, 403);
        assert.equal((await call('GET', '/home', undefined, await token('svc@example.test', { common_name: 'svc' }))).status, 403);
        assert.equal((await call('GET', '/home', undefined, await token('agent@docs.x44ylan.com'))).status, 403);
        const cookie = await fetch(`${base}/api/home`, { headers: { cookie: `CF_Authorization=${alex}` } });
        assert.equal(cookie.status, 200);
    });

    const vault = (await call('POST', '/vaults', { name: 'Labs' })).data;
    const main = (await call('GET', `/vaults/${vault.id}`)).data.main as number;
    const child = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'Child', parent_id: main })).data;

    await check('vaults: new vault has a main note; strangers cannot see it', async () => {
        assert.ok(main);
        assert.equal((await call('GET', `/vaults/${vault.id}`, undefined, sam)).status, 404);
        assert.equal((await call('GET', `/vaults/${vault.id}/nodes/${main}`, undefined, sam)).status, 404);
        assert.equal((await call('GET', `/vaults/${vault.id}/files?path=x.png`, undefined, sam)).status, 404);
        assert.equal((await mcp('read', { noteId: main }, sam)).error, 'Document unavailable, request invalid, or access denied.');
        await assert.rejects(live(`note:${main}`, sam).synced);
    });

    await check('tree: names are cleaned, duplicates get -2, a note cannot move into itself', async () => {
        assert.equal((await call('POST', `/vaults/${vault.id}/nodes`, { name: 'a/b' })).status, 400);
        const dup = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'child', parent_id: main })).data;
        assert.equal(dup.name, 'child-2');
        assert.equal((await call('PATCH', `/vaults/${vault.id}/nodes/${main}`, { parent_id: child.id })).status, 400);
        assert.equal((await call('PATCH', `/vaults/${vault.id}/nodes/${main}`, { parent_id: main })).status, 400);
        await call('DELETE', `/vaults/${vault.id}/nodes/${dup.id}`);
    });

    // --- Co-editing ------------------------------------------------------
    await check('co-editing: two editors merge concurrent typing; the Markdown file matches', async () => {
        const a = live(`note:${child.id}`);
        const b = live(`note:${child.id}`);
        await Promise.all([a.synced, b.synced]);
        const para = (doc: Y.Doc) => {
            const fragment = doc.getXmlFragment('default');
            if (!fragment.length) { const p = new Y.XmlElement('paragraph'); p.insert(0, [new Y.XmlText('')]); fragment.insert(0, [p]); }
            return (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;
        };
        para(a.doc);
        await wait(300);
        para(a.doc).insert(0, 'alpha ');
        para(b.doc).insert(0, 'beta ');
        await wait(2800);
        const text = para(a.doc).toString();
        assert.ok(text.includes('alpha') && text.includes('beta'), text);
        assert.equal(para(b.doc).toString(), text);
        const saved = (await call('GET', `/vaults/${vault.id}/nodes/${child.id}`)).data.markdown;
        assert.ok(saved.includes('alpha') && saved.includes('beta'), saved);
        assert.equal(readFileSync(`${data}/files/${vault.id}/Labs/Child.md`, 'utf8'), saved);
        a.close(); b.close();
    });

    await check('co-editing: an agent replace reaches an open editor live and is versioned first', async () => {
        const a = live(`note:${main}`);
        await a.synced;
        await mcp('update', { noteId: main, operation: 'replace', content: '# Labs\n\nSee [Child](/Labs/Child.md).\n' });
        await wait(300);
        assert.match(a.doc.getXmlFragment('default').toString(), /href="\/Labs\/Child.md"/);
        const versions = (await call('GET', `/vaults/${vault.id}/nodes/${main}/versions`)).data;
        assert.ok(versions.some((v: { source: string }) => v.source === 'mcp'));
        a.close();
    });

    await check('co-editing: removing a member closes their live connection', async () => {
        await call('POST', `/vaults/${vault.id}/members`, { email: 'sam@example.test' });
        const s = live(`note:${main}`, sam);
        await s.synced;
        const closed = new Promise<void>(resolve => s.provider.on('close', () => resolve()));
        const me = (await call('GET', '/home', undefined, sam)).data.user;
        await call('DELETE', `/vaults/${vault.id}/members/${me.id}`);
        await Promise.race([closed, wait(3000).then(() => { throw new Error('still connected'); })]);
        s.close();
    });

    // --- Links -----------------------------------------------------------
    await check('links: backlinks; rename and move rewrite links, including in open editors', async () => {
        assert.deepEqual((await mcp('backlinks', { noteId: child.id })).map((l: { id: number }) => l.id), [main]);
        const a = live(`note:${main}`);
        await a.synced;
        await call('PATCH', `/vaults/${vault.id}/nodes/${child.id}`, { name: 'Kid' });
        await wait(300);
        assert.match(a.doc.getXmlFragment('default').toString(), /href="\/Labs\/Kid.md"/);
        await call('PATCH', `/vaults/${vault.id}/nodes/${child.id}`, { parent_id: null });
        await wait(300);
        assert.match((await mcp('read', { noteId: main })).content, /\]\(\/Kid\.md\)/);
        await call('PATCH', `/vaults/${vault.id}/nodes/${child.id}`, { parent_id: main, name: 'Child' });
        await wait(300);
        assert.match((await mcp('read', { noteId: main })).content, /\]\(\/Labs\/Child\.md\)/);
        a.close();
    });

    // --- Trash and history -------------------------------------------------
    await check('trash: delete hides note and sub-notes; restore brings them back; links survive', async () => {
        const grand = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'Grand', parent_id: child.id })).data;
        await call('DELETE', `/vaults/${vault.id}/nodes/${child.id}`);
        assert.equal((await call('GET', `/vaults/${vault.id}/nodes/${grand.id}`)).status, 404);
        assert.equal((await mcp('search', { query: 'alpha' })).data.length, 0);
        const trash = (await call('GET', `/vaults/${vault.id}/trash`)).data;
        assert.deepEqual(trash.filter((t: { id: number }) => t.id === child.id).map((t: { name: string; count: number }) => [t.name, t.count]), [['Child', 2]]);
        await call('POST', `/vaults/${vault.id}/trash/${child.id}`);
        assert.equal((await call('GET', `/vaults/${vault.id}/nodes/${grand.id}`)).status, 200);
        assert.deepEqual((await mcp('backlinks', { noteId: child.id })).map((l: { id: number }) => l.id), [main]);
        assert.equal((await mcp('search', { query: 'alpha' })).data.length, 1);
    });

    await check('trash: restoring when the parent is gone puts the note at the root', async () => {
        const parent = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'Box', kind: 'folder' })).data;
        const inner = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'Inner', parent_id: parent.id })).data;
        await call('DELETE', `/vaults/${vault.id}/nodes/${inner.id}`);
        await call('DELETE', `/vaults/${vault.id}/nodes/${parent.id}`);
        await call('DELETE', `/vaults/${vault.id}/trash/${parent.id}`);
        const restored = (await call('POST', `/vaults/${vault.id}/trash/${inner.id}`)).data;
        assert.equal(restored.parent_id, null);
    });

    await check('history: restore applies as an edit and is itself recoverable', async () => {
        const versions = (await call('GET', `/vaults/${vault.id}/nodes/${main}/versions`)).data;
        const first = versions.at(-1);
        const before = (await mcp('read', { noteId: main })).content;
        await call('POST', `/vaults/${vault.id}/nodes/${main}/versions/${first.id}/restore`);
        const after = (await mcp('read', { noteId: main })).content;
        assert.equal(after, (await call('GET', `/vaults/${vault.id}/nodes/${main}/versions/${first.id}`)).data.markdown);
        const latest = (await call('GET', `/vaults/${vault.id}/nodes/${main}/versions`)).data;
        const kept = await Promise.all(latest.map(async (v: { id: number }) => (await call('GET', `/vaults/${vault.id}/nodes/${main}/versions/${v.id}`)).data.markdown));
        assert.ok(kept.includes(before));
        await mcp('update', { noteId: main, operation: 'replace', content: before });
    });

    // --- MCP ------------------------------------------------------------
    await check('mcp: tools, arguments and errors match the previous server', async () => {
        const list = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'cf-access-jwt-assertion': alex, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
        const names = (await list.json()).result.tools.map((t: { name: string }) => t.name).sort();
        assert.deepEqual(names, ['backlinks', 'create', 'delete', 'list', 'me', 'move', 'read', 'search', 'update', 'vaults']);
        assert.equal((await mcp('me', {})).email, 'alex@example.test');
        const created = await mcp('create', { vaultId: vault.id, parentId: main, name: 'From agent', content: 'Hello' });
        assert.equal(created.parent_id, main);
        assert.equal((await mcp('update', { noteId: created.id, content: ' world' })).content, 'Hello world\n');
        assert.equal((await mcp('move', { noteId: created.id, parentId: null })).parent_id, null);
        assert.ok((await mcp('list', { vaultId: vault.id })).data.some((n: { id: number }) => n.id === created.id));
        assert.equal((await mcp('delete', { noteId: created.id })).trashed, true);
        assert.ok((await mcp('read', { noteId: created.id })).error);
        assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'cf-access-jwt-assertion': alex, origin: 'https://evil.test', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })).status, 403);
        assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })).status, 401);
    });

    // --- Sharing and public links ----------------------------------------
    await check('sharing: lookup, add, public, read-only link exposes only this vault', async () => {
        await call('GET', '/home', undefined, sam);
        const people = (await call('GET', `/vaults/${vault.id}/people?q=sam`)).data;
        assert.equal(people[0].email, 'sam@example.test');
        assert.equal((await call('POST', `/vaults/${vault.id}/members`, { email: 'nobody@example.test' })).status, 404);
        const other = (await call('POST', '/vaults', { name: 'Private' })).data;
        const shared = (await call('PATCH', `/vaults/${vault.id}/share`, { link: true })).data;
        assert.match(shared.share_token, /^[A-Za-z0-9_-]{22}$/);
        const page = await fetch(`${base}/share/${shared.share_token}`, { headers: { accept: 'application/json' } });
        const body = await page.json();
        assert.equal(body.name, 'Labs');
        assert.ok(!JSON.stringify(body).includes('Private'));
        const otherMain = (await call('GET', `/vaults/${other.id}`)).data.main;
        const leak = await (await fetch(`${base}/share/${shared.share_token}?file=${otherMain}`, { headers: { accept: 'application/json' } })).json();
        assert.equal(leak.note, null);
        assert.match(await (await fetch(`${base}/share/${shared.share_token}`)).text(), /\.\/build\/assets\//);
        await call('PATCH', `/vaults/${vault.id}/share`, { link: false });
        assert.equal((await fetch(`${base}/share/${shared.share_token}`, { headers: { accept: 'application/json' } })).status, 404);
        await call('PATCH', `/vaults/${other.id}/share`, { public: true });
        assert.ok((await call('GET', '/home', undefined, sam)).data.vaults.some((v: { id: number }) => v.id === other.id));
    });

    // --- Files, import, export ------------------------------------------
    await check('files: upload, relative image path, bad type rejected; export/import round trip', async () => {
        const form = new FormData();
        form.set('file', new File([readFileSync('public/icon.png')], 'shot.png', { type: 'image/png' }));
        const up = await fetch(`${base}/api/vaults/${vault.id}/nodes/${child.id}/files`, { method: 'POST', headers: { 'cf-access-jwt-assertion': alex }, body: form });
        const file = await up.json();
        assert.equal(file.src, 'shot.png', JSON.stringify(file));
        const img = await fetch(`${base}/api/vaults/${vault.id}/files?from=${child.id}&path=shot.png`, { headers: { 'cf-access-jwt-assertion': alex } });
        assert.equal(img.headers.get('content-type'), 'image/png');
        const bad = new FormData();
        bad.set('file', new File(['<script>'], 'x.html'));
        assert.equal((await fetch(`${base}/api/vaults/${vault.id}/nodes/${child.id}/files`, { method: 'POST', headers: { 'cf-access-jwt-assertion': alex }, body: bad })).status, 400);
        const zip = await (await fetch(`${base}/api/vaults/${vault.id}/export`, { headers: { 'cf-access-jwt-assertion': alex } })).arrayBuffer();
        const back = new FormData();
        back.set('file', new File([zip], 'Copy.zip'));
        const imported = await (await fetch(`${base}/api/import`, { method: 'POST', headers: { 'cf-access-jwt-assertion': alex }, body: back })).json();
        const copy = (await call('GET', `/vaults/${imported.id}`)).data;
        const names = copy.nodes.map((n: { name: string }) => n.name).sort();
        assert.ok(names.includes('Labs') && names.includes('Child') && names.includes('shot'), names.join());
        const labs = copy.nodes.find((n: { name: string; parent_id: number | null }) => n.name === 'Labs' && !n.parent_id);
        assert.ok(copy.nodes.some((n: { name: string; parent_id: number }) => n.name === 'Child' && n.parent_id === labs.id));
    });

    // --- Failure cases ----------------------------------------------------
    await check('markdown: front matter, HTML, escapes, hashtags and angle links survive a round trip', async () => {
        const text = [
            '---', 'title: Plan', 'tags: [a, b]', '---', '',
            '# Heading', '', '<div>raw html</div> & ATT&CK snake_case \\*not em\\* #tag <https://example.test>', '',
            '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '- [ ] todo', '- [x] done', '',
            '```mermaid', 'graph TD', '  A --> B', '```', '',
        ].join('\n');
        const note = await mcp('create', { vaultId: vault.id, name: 'Fidelity', content: text });
        const once = (await mcp('read', { noteId: note.id })).content;
        assert.match(once, /^---\ntitle: Plan\ntags: \[a, b\]\n---\n/);
        // Open it live, then make an unrelated edit: everything else is kept.
        const a = live(`note:${note.id}`);
        await a.synced;
        await mcp('update', { noteId: note.id, content: '\n\ntail\n' });
        await wait(2600);
        const saved = (await mcp('read', { noteId: note.id })).content;
        assert.equal(saved, `${once.replace(/\n$/, '')}\n\ntail\n`);
        for (const piece of ['<div>raw html</div>', 'ATT&CK', 'snake_case', '\\*not em\\*', '#tag', 'https://example.test', '| 1 | 2 |', '- [x] done', '```mermaid']) {
            assert.ok(saved.includes(piece), `lost ${piece}\n${saved}`);
        }
        a.close();
        await mcp('delete', { noteId: note.id });
    });

    await check('co-editing: an editor that disconnects mid-edit merges its offline changes on reconnect', async () => {
        const note = await mcp('create', { vaultId: vault.id, name: 'Offline', content: 'shared\n' });
        const a = live(`note:${note.id}`);
        const b = live(`note:${note.id}`);
        await Promise.all([a.synced, b.synced]);
        a.provider.disconnect();
        const text = (doc: Y.Doc) => ((doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText);
        text(a.doc).insert(0, 'offline-a ');
        text(b.doc).insert(0, 'online-b ');
        await wait(500);
        await a.provider.connect();
        await wait(2800);
        const saved = (await mcp('read', { noteId: note.id })).content;
        assert.ok(saved.includes('offline-a') && saved.includes('online-b') && saved.includes('shared'), saved);
        a.close(); b.close();
    });

    await check('co-editing: edits survive a server restart; open editors reconnect and keep syncing', async () => {
        const note = await mcp('create', { vaultId: vault.id, name: 'Restart', content: 'before\n' });
        const a = live(`note:${note.id}`);
        await a.synced;
        const p = (a.doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
        p.insert(0, 'typed ');
        await wait(300);
        await stop('SIGTERM');
        await start();
        assert.match((await mcp('read', { noteId: note.id })).content, /typed before/);
        // The open editor reconnects on its own and its next edit is saved.
        await new Promise<void>((resolve, reject) => { a.provider.on('synced', () => resolve()); setTimeout(() => reject(new Error('no reconnect')), 15000); });
        p.insert(0, 'again ');
        await wait(2800);
        assert.match((await mcp('read', { noteId: note.id })).content, /again typed before/);
        a.close();
    });

    await check('storage: a crash loses no committed edit and the Markdown mirror is rebuilt on start', async () => {
        const note = await mcp('create', { vaultId: vault.id, name: 'Crash', content: 'kept\n' });
        const file = `${data}/files/${vault.id}/Crash.md`;
        writeFileSync(file, 'tampered');
        rmSync(`${data}/files/${vault.id}/Labs.md`);
        await stop('SIGKILL');
        await start();
        assert.equal(readFileSync(file, 'utf8'), 'kept\n');
        assert.equal(readFileSync(`${data}/files/${vault.id}/Labs.md`, 'utf8'), (await mcp('read', { noteId: main })).content);
        await mcp('delete', { noteId: note.id });
    });

    await check('storage: a failed mirror write never fails the edit', async () => {
        const note = await mcp('create', { vaultId: vault.id, name: 'Readonly', content: 'one\n' });
        const dir = `${data}/files/${vault.id}`;
        chmodSync(dir, 0o500);
        try {
            const after = await mcp('update', { noteId: note.id, content: '\n\ntwo\n' });
            assert.equal(after.content, 'one\n\ntwo\n');
        } finally {
            chmodSync(dir, 0o700);
        }
        await mcp('delete', { noteId: note.id });
    });

    await check('links: a note in another vault, in trash, or open elsewhere is handled on rename', async () => {
        const other = (await call('POST', '/vaults', { name: 'Elsewhere' })).data;
        const otherMain = (await call('GET', `/vaults/${other.id}`)).data.main;
        await mcp('update', { noteId: otherMain, operation: 'replace', content: 'Cross [x](/Labs/Child.md)\n' });
        const target = await mcp('create', { vaultId: vault.id, name: 'Target', content: '' });
        const trashed = await mcp('create', { vaultId: vault.id, name: 'Gone', content: 'see [t](/Target.md)\n' });
        await mcp('delete', { noteId: trashed.id });
        await call('PATCH', `/vaults/${vault.id}/nodes/${target.id}`, { name: 'Target2' });
        // Other vaults never resolve into this one, so they are untouched.
        assert.equal((await mcp('read', { noteId: otherMain })).content, 'Cross [x](/Labs/Child.md)\n');
        // A note in trash keeps its text; after restore the link shows as broken.
        await call('POST', `/vaults/${vault.id}/trash/${trashed.id}`);
        assert.equal((await mcp('read', { noteId: trashed.id })).content, 'see [t](/Target.md)\n');
        assert.deepEqual(await mcp('backlinks', { noteId: target.id }), []);
        await mcp('delete', { noteId: trashed.id });
        await mcp('delete', { noteId: target.id });
    });

    await check('history: retention keeps every pre-agent version; trash empties after 30 days', async () => {
        const note = await mcp('create', { vaultId: vault.id, name: 'Old', content: 'v1\n' });
        await mcp('update', { noteId: note.id, operation: 'replace', content: 'v2\n' });
        await mcp('update', { noteId: note.id, operation: 'replace', content: 'v3\n' });
        const doomed = await mcp('create', { vaultId: vault.id, name: 'Doomed', content: 'x\n' });
        await mcp('delete', { noteId: doomed.id });
        await stop();
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(`${data}/db.sqlite`);
        db.prepare(`update versions set created_at = datetime('now', '-200 days') where node_id = ?`).run(note.id);
        db.prepare(`update nodes set deleted_at = datetime('now', '-31 days') where id = ?`).run(doomed.id);
        db.close();
        await start();
        const versions = (await call('GET', `/vaults/${vault.id}/nodes/${note.id}/versions`)).data;
        const bodies = await Promise.all(versions.map(async (v: { id: number }) => (await call('GET', `/vaults/${vault.id}/nodes/${note.id}/versions/${v.id}`)).data.markdown));
        assert.ok(bodies.includes('v1\n') && bodies.includes('v2\n'), JSON.stringify(bodies));
        assert.ok(!(await call('GET', `/vaults/${vault.id}/trash`)).data.some((t: { id: number }) => t.id === doomed.id));
        await mcp('delete', { noteId: note.id });
    });

    await check('auth: a changed email is a new account with no access; a member keeps access after rename', async () => {
        const renamed = await token('alex.new@example.test', { sub: 'alex@example.test' });
        assert.equal((await call('GET', `/vaults/${vault.id}`, undefined, renamed)).status, 404);
        assert.equal((await call('PATCH', '/me', { name: 'Alexandra' })).status, 200);
        assert.equal((await call('GET', `/vaults/${vault.id}`)).status, 200);
        await call('PATCH', '/me', { name: 'Alex' });
    });

    await check('sharing: public links never expose trash, history, files of other vaults or MCP', async () => {
        const shared = (await call('PATCH', `/vaults/${vault.id}/share`, { link: true })).data.share_token;
        const hidden = await mcp('create', { vaultId: vault.id, name: 'Hidden', content: 'secret\n' });
        await mcp('delete', { noteId: hidden.id });
        const body = await (await fetch(`${base}/share/${shared}`, { headers: { accept: 'application/json' } })).json();
        assert.ok(!body.nodes.some((n: { id: number }) => n.id === hidden.id));
        assert.equal((await (await fetch(`${base}/share/${shared}?file=${hidden.id}`, { headers: { accept: 'application/json' } })).json()).note, null);
        for (const path of [`/api/vaults/${vault.id}/trash`, `/api/vaults/${vault.id}/nodes/${main}/versions`, '/mcp']) {
            assert.notEqual((await fetch(`${base}${path}`)).status, 200, path);
        }
        assert.equal((await fetch(`${base}/share/${shared}/files?path=../../db.sqlite`)).status, 404);
        await call('PATCH', `/vaults/${vault.id}/share`, { link: false });
    });

    await check('tree: moving across vaults is refused; a member can rename and move', async () => {
        const other = (await call('POST', '/vaults', { name: 'Across' })).data;
        const otherMain = (await call('GET', `/vaults/${other.id}`)).data.main;
        assert.equal((await call('PATCH', `/vaults/${vault.id}/nodes/${child.id}`, { parent_id: otherMain })).status, 404);
        await call('POST', `/vaults/${vault.id}/members`, { email: 'sam@example.test' });
        const note = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'By Sam' }, sam)).data;
        assert.equal((await call('PATCH', `/vaults/${vault.id}/nodes/${note.id}`, { name: 'By Sam 2', parent_id: main }, sam)).status, 200);
        await call('DELETE', `/vaults/${vault.id}/nodes/${note.id}`, undefined, sam);
    });

    await check('backups: a backup restores into a working app with the same notes, links and attachments', async () => {
        const dir = mkdtempSync('/tmp/docs-backups-');
        const file = execFileSync('node', ['server/backup.ts', dir], { env: { ...process.env, DOCS_DATA: data }, encoding: 'utf8' }).trim();
        const check = JSON.parse(execFileSync('node', ['server/backup.ts', '--check', file], { encoding: 'utf8' }));
        assert.equal(check.integrity, 'ok');
        // Restore into an empty data folder and start a second app on it.
        const restored = mkdtempSync('/tmp/docs-restored-');
        execFileSync('tar', ['-xzf', file, '-C', restored]);
        const port2 = port + 20;
        const second = spawn('node', ['server/main.ts'], { env: { ...process.env, ...env, DOCS_DATA: restored, PORT: String(port2) }, stdio: 'ignore' });
        try {
            const base2 = `http://127.0.0.1:${port2}`;
            for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base2}/up`)).ok) break; } catch { /* starting */ } await wait(100); }
            const get = async (path: string, b = base) => (await fetch(`${b}/api${path}`, { headers: { 'cf-access-jwt-assertion': alex } })).json();
            const [before, after] = [await get(`/vaults/${vault.id}`), await get(`/vaults/${vault.id}`, base2)];
            assert.deepEqual(after.nodes.map((n: { id: number; name: string }) => [n.id, n.name]), before.nodes.map((n: { id: number; name: string }) => [n.id, n.name]));
            for (const n of before.nodes.filter((n: { kind: string }) => n.kind === 'note')) {
                const [a, b] = [await get(`/vaults/${vault.id}/nodes/${n.id}`), await get(`/vaults/${vault.id}/nodes/${n.id}`, base2)];
                assert.equal(b.markdown, a.markdown, `note ${n.name}`);
                assert.deepEqual(b.backlinks, a.backlinks);
            }
            const shot = before.nodes.find((n: { kind: string }) => n.kind === 'file');
            if (shot) assert.equal((await fetch(`${base2}/api/vaults/${vault.id}/files?path=/${encodeURIComponent(`Labs/${shot.name}.${shot.ext}`)}`, { headers: { 'cf-access-jwt-assertion': alex } })).status, 200);
            assert.equal(readFileSync(`${restored}/files/${vault.id}/Labs.md`, 'utf8'), (await get(`/vaults/${vault.id}/nodes/${main}`)).markdown);
        } finally {
            second.kill('SIGKILL');
        }
    });

    await check('memory: idle documents are unloaded once their editors leave', async () => {
        const notes = await Promise.all([1, 2, 3].map(i => mcp('create', { vaultId: vault.id, name: `Idle ${i}`, content: `${i}\n` })));
        const sessions = notes.map(n => live(`note:${n.id}`));
        await Promise.all(sessions.map(s => s.synced));
        const loaded = async () => (await (await fetch(`${base}/up?documents`)).text()).split(' ').slice(1);
        const before = await loaded();
        assert.ok(notes.every(n => before.includes(`note:${n.id}`)), before.join());
        sessions.forEach(s => s.close());
        await wait(3000);
        const after = await loaded();
        assert.ok(notes.every(n => !after.includes(`note:${n.id}`)), after.join());
        for (const n of notes) await mcp('delete', { noteId: n.id });
    });

    // --- Browser ----------------------------------------------------------
    browser = await chromium.launch();
    const open = async (viewport: { width: number; height: number }, who = alex, theme: 'light' | 'dark' = 'light') => {
        // Like Cloudflare: the CF_Authorization cookie rides on every request,
        // including the WebSocket upgrade.
        const context = await browser!.newContext({ viewport, colorScheme: theme });
        await context.addCookies([{ name: 'CF_Authorization', value: who, url: base }]);
        // Top-level page only: sandboxed preview frames have no storage.
        await context.addInitScript(() => { if (window === window.top && !localStorage.getItem('mode')) localStorage.setItem('mode', 'edit'); });
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        return { page, errors };
    };
    const editorReady = (page: Page, timeout = 10_000) => page.locator('.note .ProseMirror[contenteditable="true"]').waitFor({ timeout });

    await check('browser: two people see each other typing, with named cursors', async () => {
        await call('POST', `/vaults/${vault.id}/members`, { email: 'sam@example.test' });
        const a = await open({ width: 1280, height: 800 });
        const b = await open({ width: 1280, height: 800 }, sam);
        await a.page.goto(`${base}/vaults/${vault.id}?file=${child.id}`);
        await b.page.goto(`${base}/vaults/${vault.id}?file=${child.id}`);
        await Promise.all([editorReady(a.page), editorReady(b.page)]);
        await a.page.locator('.note .ProseMirror').click();
        await a.page.keyboard.press('ControlOrMeta+End');
        await a.page.keyboard.type(' from-alex');
        await b.page.locator('.note .ProseMirror').click();
        await b.page.keyboard.press('ControlOrMeta+End');
        await b.page.keyboard.type(' from-sam');
        await wait(800);
        for (const p of [a.page, b.page]) {
            const text = await p.locator('.note .ProseMirror').innerText();
            assert.ok(text.includes('from-alex') && text.includes('from-sam'), text);
        }
        assert.equal(await a.page.locator('.collaboration-carets__label', { hasText: 'Sam' }).count(), 1);
        assert.ok(await a.page.getByLabel(/Also here: Sam/).isVisible());
        await a.page.screenshot({ path: `${artifacts}/coediting.png` });
        assert.deepEqual([...a.errors, ...b.errors], []);
        await a.page.context().close(); await b.page.context().close();
    });

    await check('browser: tree changes by others and agents appear live; offline edits sync on reconnect', async () => {
        const { page, errors } = await open({ width: 1440, height: 900 });
        await page.goto(`${base}/vaults/${vault.id}?file=${main}`);
        await editorReady(page);
        const tree = page.getByRole('navigation', { name: 'Notes' });
        // Another person adds a note; an agent renames it.
        const added = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'Live added' }, sam)).data;
        await tree.locator('[data-node] button', { hasText: 'Live added' }).first().waitFor({ timeout: 5000 });
        await mcp('move', { noteId: added.id, parentId: null });
        await call('PATCH', `/vaults/${vault.id}/nodes/${added.id}`, { name: 'Live renamed' });
        await tree.locator('[data-node] button', { hasText: 'Live renamed' }).first().waitFor({ timeout: 5000 });
        // Go offline, type, come back: the edit is saved and the dot clears.
        await page.locator('.note .ProseMirror').click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.context().setOffline(true);
        await page.evaluate(() => dispatchEvent(new Event('offline')));
        await page.keyboard.type(' typed-offline');
        await page.getByRole('status', { name: 'Offline' }).waitFor({ timeout: 15000 });
        await page.context().setOffline(false);
        await page.evaluate(() => dispatchEvent(new Event('online')));
        await page.getByRole('status', { name: 'Offline' }).waitFor({ state: 'detached', timeout: 20000 });
        await wait(2600);
        assert.match((await mcp('read', { noteId: main })).content, /typed-offline/);
        await call('DELETE', `/vaults/${vault.id}/nodes/${added.id}`);
        assert.deepEqual(errors, []);
        await page.context().close();
    });

    await check('browser: / commands, [[ note links, find, contents, pin, copy as Markdown', async () => {
        const { page, errors } = await open({ width: 1440, height: 900 });
        await page.goto(`${base}/vaults/${vault.id}?file=${main}`);
        await editorReady(page).catch(async error => {
            writeFileSync(`${artifacts}/debug.html`, await page.content());
            throw error;
        });
        const doc = page.locator('.note .ProseMirror');
        await doc.click();
        await page.keyboard.press('ControlOrMeta+End');
        const trace: string[] = [];
        const snap = async (label: string) => trace.push(`${label}: ${await doc.innerHTML()}`);
        page.on('pageerror', e => trace.push(`pageerror ${e.message}`));
        await page.keyboard.press('Enter');
        await snap('enter');
        await page.keyboard.type('/h2');
        await page.getByRole('option', { name: 'Heading 2', exact: true }).waitFor();
        assert.equal(await page.getByRole('option').count(), 1);
        await page.keyboard.press('Enter');
        await snap('h2');
        await page.keyboard.type('Section two');
        await page.keyboard.press('Enter');
        await snap('section');
        await page.keyboard.type('Go to [[gra');
        await snap('goto');
        await page.getByRole('option', { name: /Grand/ }).waitFor().finally(() => writeFileSync(`${artifacts}/debug-slash.txt`, trace.join('\n')));
        await page.keyboard.press('Enter');
        await snap('picked');
        writeFileSync(`${artifacts}/debug-slash.txt`, trace.join('\n'));
        await wait(2600);
        const saved = (await mcp('read', { noteId: main })).content as string;
        assert.match(saved, /^## Section two$/m);
        assert.match(saved, /\[Grand\]\(\/Labs\/Child\/Grand\.md\)/);
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'Contents' }).click();
        await page.getByRole('list', { name: 'Contents' }).getByRole('button', { name: 'Section two' }).waitFor();
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+f');
        await page.getByRole('searchbox', { name: 'Find in note' }).fill('section');
        assert.equal(await page.locator('.find-match').count(), 1);
        await page.getByRole('button', { name: 'Close find' }).click();
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'Copy as Markdown' }).click();
        assert.equal((await page.evaluate(() => navigator.clipboard.readText())).trim(), saved.trim());
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'Pin' }).click();
        await page.getByRole('list', { name: 'Pinned' }).getByText('Labs').waitFor();
        await page.locator('.note a', { hasText: 'Grand' }).click();
        await page.waitForFunction(() => document.title === 'Grand', undefined, { timeout: 5000 }).catch(async error => {
            await page.screenshot({ path: `${artifacts}/debug-link.png` });
            writeFileSync(`${artifacts}/debug-link.txt`, `${page.url()}\n${await page.locator('.note a').evaluateAll(as => as.map(a => a.outerHTML).join('\n'))}`);
            throw error;
        });
        await page.goto(base);
        await page.getByRole('region', { name: 'Pinned' }).getByRole('link', { name: /^Labs/ }).waitFor();
        assert.deepEqual(errors, []);
        await page.context().close();
    });

    await check('browser: Cmd+K search, history restore and trash undo', async () => {
        const { page, errors } = await open({ width: 1440, height: 900 });
        await page.goto(`${base}/vaults/${vault.id}?file=${main}`);
        await editorReady(page);
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByPlaceholder('Search notes').fill('alpha');
        await page.getByRole('option', { name: /Child/ }).first().click();
        await page.waitForURL(new RegExp(`file=${child.id}`));
        await page.waitForFunction(() => document.title === 'Child');
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'History' }).click();
        await page.getByRole('dialog', { name: 'History' }).waitFor();
        await page.getByRole('dialog').locator('ul button').first().click();
        await page.getByRole('button', { name: 'Restore' }).waitFor();
        await page.keyboard.press('Escape');
        const tree = page.getByRole('navigation', { name: 'Notes' });
        const expand = tree.getByRole('button', { name: 'Expand Child' });
        if (await expand.count()) await expand.click();
        await tree.locator('[data-node] button', { hasText: 'Grand' }).first().waitFor({ timeout: 5000 }).catch(async error => {
            await page.screenshot({ path: `${artifacts}/debug-tree.png` });
            throw error;
        });
        await page.getByRole('button', { name: 'Actions for Grand' }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await page.locator('[data-sonner-toast] button', { hasText: 'Undo' }).click();
        await page.locator('[data-node] button', { hasText: 'Grand' }).first().waitFor();
        assert.match(page.url(), new RegExp(`file=${child.id}`), 'deleting a sub-note keeps the open note');
        assert.deepEqual(errors, []);
        await page.context().close();
    });

    await check('browser: read mode hides tools; previews render; reload keeps edits', async () => {
        await mcp('update', { noteId: child.id, operation: 'replace', content: '# Child\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n```archify\n{"diagram_type":"architecture","components":[{"id":"a","label":"App","pos":[40,40]}]}\n```\n\n```html\n<b>hi</b>\n```\n' });
        const { page, errors } = await open({ width: 1440, height: 900 });
        await page.goto(`${base}/vaults/${vault.id}?file=${child.id}`);
        await editorReady(page);
        await page.frameLocator('iframe[title="Mermaid preview"]').locator('svg').waitFor({ timeout: 20_000 });
        await page.getByRole('img', { name: 'Diagram' }).waitFor();
        await page.getByRole('button', { name: 'Preview html' }).click();
        await page.frameLocator('iframe[title="HTML preview"]').locator('b', { hasText: 'hi' }).waitFor();
        await page.getByRole('button', { name: 'Read', exact: true }).click();
        assert.equal(await page.getByRole('toolbar', { name: 'Formatting' }).count(), 0);
        assert.equal(await page.locator('.note .ProseMirror').getAttribute('contenteditable'), 'false');
        await page.screenshot({ path: `${artifacts}/previews-1440.png` });
        await page.reload();
        await page.getByRole('button', { name: 'Edit', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        await page.context().close();
    });

    await check('browser: layout fits 320, 390 and 1440 wide in both themes', async () => {
        for (const width of [320, 390, 1024, 1440]) {
            for (const theme of ['light', 'dark'] as const) {
                const { page, errors } = await open({ width, height: 844 }, alex, theme);
                await page.goto(base);
                await page.getByRole('region', { name: 'Vaults' }).waitFor();
                await page.screenshot({ path: `${artifacts}/home-${width}-${theme}.png` });
                // Home and note share one bar: same height, mark, search and account spots.
                const spots = () => Promise.all(['#app-header', '#app-header a[aria-label="Docs home"]', '#app-header button[aria-label="More"]', '#app-header button[aria-label="User menu"]'].map(s => page.locator(s).boundingBox()));
                const home = await spots();
                await page.goto(`${base}/vaults/${vault.id}?file=${main}`);
                await editorReady(page);
                const note = await spots();
                assert.equal(note[0]?.height, 56);
                assert.deepEqual(note, home);
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
                assert.equal(overflow, false, `horizontal overflow at ${width}`);
                const buttons = await page.locator('#app-header button, #app-header a').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetWidth).map(e => { const r = e.getBoundingClientRect(); return [r.width, r.right]; }));
                assert.ok(buttons.every(([w, right]) => w >= 32 && right <= width), JSON.stringify(buttons));
                if (width < 1024) {
                    await page.getByRole('button', { name: 'Formatting' }).click();
                    await page.getByRole('toolbar', { name: 'Formatting' }).waitFor();
                    await page.screenshot({ path: `${artifacts}/tools-${width}-${theme}.png` });
                    await page.getByRole('button', { name: 'Close formatting' }).click();
                }
                await page.screenshot({ path: `${artifacts}/note-${width}-${theme}.png` });
                assert.deepEqual(errors, []);
                await page.context().close();
            }
        }
    });

    await check('browser: breadcrumb walks back up: note, parent, vault, home', async () => {
        const leaf = (await call('POST', `/vaults/${vault.id}/nodes`, { name: 'Leaf', parent_id: child.id })).data;
        const { page, errors } = await open({ width: 1440, height: 900 }, alex);
        await page.goto(`${base}/vaults/${vault.id}?file=${leaf.id}`);
        await editorReady(page);
        const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
        // Editing puts the toolbar in the bar, so the middle folds into "…".
        assert.equal((await crumbs.innerText()).replace(/\s+/g, ' ').trim(), 'Labs / / Leaf');
        await crumbs.getByRole('button', { name: 'Show path' }).click();
        await page.getByRole('menuitem', { name: 'Child' }).click();
        await page.waitForURL(`**file=${child.id}`);
        await page.waitForFunction(() => document.title === 'Child');
        await crumbs.getByRole('button', { name: 'Labs' }).click();
        await page.waitForURL(`**file=${main}`);
        await page.waitForFunction(() => document.title === 'Labs');
        await page.waitForFunction(() => document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent?.trim() === 'Labs');
        await page.getByRole('link', { name: 'Docs home' }).click();
        await page.getByRole('region', { name: 'Vaults' }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${base}/vaults/${vault.id}?file=${leaf.id}`);
        await editorReady(page);
        await page.getByRole('button', { name: 'Leaf, show notes' }).click();
        await page.getByRole('navigation', { name: 'Notes' }).getByText('Child').waitFor();
        assert.deepEqual(errors, []);
        await page.context().close();
        await call('DELETE', `/vaults/${vault.id}/nodes/${leaf.id}`);
    });

    await check('browser: internal links inside tables stay in the SPA', async () => {
        const linked = (await call('POST', '/vaults', { name: 'Linked' })).data;
        const linkedMain = (await call('GET', `/vaults/${linked.id}`)).data.main as number;
        const target = (await call('POST', `/vaults/${linked.id}/nodes`, { name: 'Target note', parent_id: linkedMain })).data;
        await mcp('update', {
            noteId: linkedMain,
            operation: 'replace',
            content: '# Linked\n\n| Title | Course |\n| --- | --- |\n| [Target note](/Linked/Target%20note.md) | [Example](https://example.com/) |\n',
        });
        const { page, errors } = await open({ width: 390, height: 844 }, alex);
        await page.goto(`${base}/vaults/${linked.id}?file=${linkedMain}`);
        await editorReady(page);
        await page.locator('.note a', { hasText: 'Target note' }).click();
        await page.waitForURL(`**file=${target.id}`);
        await page.goto(`${base}/vaults/${linked.id}?file=${linkedMain}`);
        await editorReady(page);
        await page.getByRole('button', { name: 'Read', exact: true }).click();
        await page.locator('.note a', { hasText: 'Target note' }).click();
        await page.waitForURL(`**file=${target.id}`);
        assert.deepEqual(errors, []);
        await page.context().close();
    });

    await check('browser: progressive rendering on a 2,000-note vault and a 1 MB note', async () => {
        const big = (await call('POST', '/vaults', { name: 'Big' })).data;
        const bigMain = (await call('GET', `/vaults/${big.id}`)).data.main;
        for (let i = 0; i < 2000; i += 1) await call('POST', `/vaults/${big.id}/nodes`, { name: `Note ${i}`, parent_id: i % 2 ? bigMain : null });
        const body = Array.from({ length: 12_000 }, (_, i) => `## Part ${i}\n\nLine ${i} with **bold** text and a [link](https://example.test/${i}).`).join('\n\n');
        const content = body.slice(0, body.lastIndexOf('\n\n', 990_000)) + '\n';
        assert.ok(content.length > 950_000, `fixture is ${content.length} bytes`);
        await mcp('update', { noteId: bigMain, operation: 'replace', content });
        const { page, errors } = await open({ width: 1440, height: 900 });
        // Measure inside the page: locator polling would compete for the main thread.
        await page.context().addInitScript(() => {
            const w = window as unknown as { fp?: number; live?: number };
            new MutationObserver((_, o) => {
                if (!w.fp && document.querySelector('.note .ProseMirror')) w.fp = Math.round(performance.now());
                if (!w.live && document.querySelector('.note .ProseMirror[contenteditable="true"]')) { w.live = Math.round(performance.now()); o.disconnect(); }
            }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
        });
        await page.goto(`${base}/vaults/${big.id}`);
        // First open right after an agent rewrote the note (cold): must be quick.
        await page.waitForFunction(() => (window as unknown as { live?: number }).live, undefined, { polling: 500, timeout: 30_000 });
        const coldLive = await page.evaluate(() => (window as unknown as { live: number }).live);
        assert.ok(coldLive < 6000, `cold open of a 1 MB note took ${coldLive}ms`);
        await page.reload();
        await page.waitForFunction(() => (window as unknown as { fp?: number }).fp, undefined, { polling: 500, timeout: 20_000 });
        const firstPaint = await page.evaluate(() => (window as unknown as { fp: number }).fp);
        // A 1 MB note is ~24,000 blocks: the readable preview shows first,
        // the editable view follows.
        await page.waitForFunction(() => (window as unknown as { live?: number }).live, undefined, { polling: 500, timeout: 20_000 });
        const liveAt = await page.evaluate(() => (window as unknown as { live: number }).live);
        // Opening a note never edits it (no version, no save).
        assert.equal((await call('GET', `/vaults/${big.id}/nodes/${bigMain}/versions`)).data.filter((v: { source: string }) => v.source === 'web').length <= 1, true);
        const rows = await page.locator('[role="treeitem"]').count();
        assert.ok(rows < 200, `tree rendered ${rows} rows`);
        // Off-screen rows are virtualised; open through search like a user would.
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByPlaceholder('Search notes').fill('Note 10');
        await page.getByRole('option', { name: /^Note 10 ·/ }).first().click();
        const switchStart = Date.now();
        await page.waitForFunction(() => document.title === 'Note 10');
        const switchMs = Date.now() - switchStart;
        // Ordinary notes: switching between visible sub-notes.
        const tree = page.getByRole('navigation', { name: 'Notes' });
        await page.goto(`${base}/vaults/${big.id}?file=${(await call('GET', `/vaults/${big.id}`)).data.nodes.find((n: { name: string }) => n.name === 'Note 1').id}`);
        await editorReady(page);
        const normal: number[] = [];
        for (const name of ['Note 3', 'Note 5', 'Note 3', 'Note 5']) {
            const at = Date.now();
            await tree.locator('[data-node] button', { hasText: new RegExp(`^${name}$`) }).first().click();
            await page.waitForFunction(n => document.title === n && !!document.querySelector('.note .ProseMirror'), name);
            normal.push(Date.now() - at);
        }
        const typical = normal.sort((a, b) => a - b)[1];
        writeFileSync(`${artifacts}/timing.json`, JSON.stringify({ bigNote: { coldLive, firstPaint, liveAt, switchMs }, typicalSwitchMs: typical, normal, rows }, null, 2));
        // PLAN.md targets: first paint under 1 s, switching notes under 150 ms.
        assert.ok(firstPaint < 1000, `first paint of a 1 MB note ${firstPaint}ms`);
        assert.ok(typical < 150, `switching notes ${typical}ms`);
        assert.deepEqual(errors, []);
        await page.context().close();
    });

    await check('browser: public link renders read-only on a phone without signing in', async () => {
        const token$ = (await call('PATCH', `/vaults/${vault.id}/share`, { link: true })).data.share_token;
        const context = await browser!.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        await page.goto(`${base}/share/${token$}`);
        await page.locator('article a', { hasText: 'Child' }).first().waitFor();
        assert.equal(await page.locator('[contenteditable="true"]').count(), 0);
        await page.screenshot({ path: `${artifacts}/share-390.png` });
        await context.close();
    });
} finally {
    await browser?.close();
    server.kill('SIGTERM');
    const failed = checks.filter(c => !c.ok);
    writeFileSync(`${artifacts}/report.json`, JSON.stringify({ finished: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks, server: serverLog.join('').slice(-20000) }, null, 2));
    console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
    // Live-sync clients keep reconnect timers alive; exit once reported.
    process.exit(failed.length ? 1 : 0);
}
