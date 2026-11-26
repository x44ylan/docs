// E2E for the host-only MCP bridge. Starts the app with a private socket, then
// drives the stdio bridge exactly as Codex would.
//   node tests/local-mcp.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { env, token } from './access.ts';

const data = mkdtempSync('/tmp/docs-local-mcp-');
const socket = `${data}/mcp.sock`;
const port = 3970 + Math.floor(Math.random() * 9);
const base = `http://127.0.0.1:${port}`;
const appEnv = { ...process.env, ...env, DOCS_DATA: data, PORT: String(port), APP_URL: base, DOCS_MCP_SOCKET: socket, DOCS_LOCAL_EMAIL: 'owner@example.test' };
const app = spawn('node', ['server/main.ts'], { env: appEnv, stdio: ['ignore', 'ignore', 'inherit'] });
const results: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => { await fn(); results.push(`ok   ${name}`); console.log(`ok   ${name}`); };

try {
    for (let i = 0; i < 100 && !existsSync(socket); i++) await new Promise(r => setTimeout(r, 100));
    const owner = await token('owner@example.test', { name: 'Owner' });
    const call = (path: string, init: RequestInit = {}) => fetch(`${base}/api${path}`, { ...init, headers: { 'cf-access-jwt-assertion': owner, 'content-type': 'application/json' } });

    await step('socket exists, private, with no extra TCP listener', async () => {
        assert.ok(existsSync(socket));
        assert.equal(statSync(socket).mode & 0o777, 0o600);
    });

    const bridge = spawn('node', ['server/local-mcp.ts'], { env: appEnv, stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = createInterface({ input: bridge.stdout! })[Symbol.asyncIterator]();
    let next = 1;
    const rpc = async (method: string, params: unknown = {}) => {
        const id = next++;
        bridge.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        const reply = JSON.parse((await lines.next()).value as string);
        assert.equal(reply.id, id);
        return reply;
    };
    const tool = async (name: string, args: unknown = {}) => {
        const reply = await rpc('tools/call', { name, arguments: args });
        return reply.result.isError ? { error: reply.result.content[0].text } : JSON.parse(reply.result.content[0].text);
    };

    await step('before the owner signs in, the bridge reports a clear error', async () => {
        const reply = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
        assert.match(reply.error.message, /has not signed in/);
    });

    // First browser/API visit creates the owner account and a vault.
    const vault = await (await call('/vaults', { method: 'POST', body: JSON.stringify({ name: 'Local' }) })).json();
    const stranger = await token('stranger@example.test');
    const hidden = await (await fetch(`${base}/api/vaults`, { method: 'POST', headers: { 'cf-access-jwt-assertion': stranger, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Hidden' }) })).json();

    await step('initialize and list tools without signing in', async () => {
        const reply = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
        assert.equal(reply.result.serverInfo.name, 'Docs');
        bridge.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const listed = await rpc('tools/list');
        for (const retired of ['open_item', 'move_item', 'trash_item']) {
            assert.ok(!listed.result.tools.some((t: { name: string }) => t.name === retired));
        }
        assert.ok(listed.result.tools.some((t: { name: string }) => t.name === 'me'));
    });

    await step('acts as the configured owner with the same vault access', async () => {
        assert.equal((await tool('me')).email, 'owner@example.test');
        const vaults = await tool('vaults');
        assert.ok(vaults.data.some((v: { id: number }) => v.id === vault.id));
        assert.ok(!vaults.data.some((v: { id: number }) => v.id === hidden.id));
        assert.match((await tool('list', { vaultId: hidden.id })).error, /unavailable|denied/);
    });

    await step('create, update and read through the bridge', async () => {
        const note = await tool('create', { vaultId: vault.id, name: 'From Codex', content: '# From Codex\n' });
        await tool('update', { noteId: note.id, content: 'Added locally.\n' });
        assert.match((await tool('read', { noteId: note.id })).content, /Added locally/);
    });

    await step('manage vaults, trees and history through MCP and verify in the browser API', async () => {
        const created = await tool('create_vault', { name: 'Notebook' });
        const v = { vaultId: created.id };
        const opened = await tool('open_vault', v);
        assert.equal(opened.open.name, 'Notebook');
        assert.equal((await tool('home')).vaults.some((item: { id: number }) => item.id === created.id), true);
        assert.equal((await tool('rename_vault', { ...v, name: 'Journal' })).name, 'Journal');
        const folder = await tool('create_folder', { ...v, name: 'Year' });
        const doc = await tool('create', { ...v, parentId: folder.id, name: 'First', content: '# Title\n\n## Detail\n\nOriginal text.' });
        const item = { ...v, nodeId: doc.id };
        const note = { noteId: doc.id };
        assert.equal((await tool('rename_item', { ...item, name: 'Second' })).name, 'Second');
        assert.equal((await tool('move', { noteId: doc.id, parentId: opened.main })).parent_id, opened.main);
        await tool('set_pin', { ...item, pinned: true });
        assert.equal((await (await call(`/vaults/${v.vaultId}/nodes/${doc.id}`)).json()).pinned, true);
        assert.equal((await tool('read', { noteId: doc.id })).name, 'Second');
        assert.equal((await tool('note_contents', note))[1].text, 'Detail');
        assert.match((await tool('preview_note', note)).html, /<h2>Detail/);
        assert.deepEqual(await tool('note_presence', note), []);
        assert.equal((await tool('find_in_note', { ...note, query: 'ORIGINAL' })).data[0].line, 5);
        const view = await tool('view_link', { ...v, ...note, theme: 'dark', mode: 'read', sidebar: 'closed' });
        assert.equal(new URL(view.url).searchParams.get('file'), String(doc.id));
        assert.deepEqual(await tool('code_blocks', note), []);
        assert.equal((await tool('edit_selection', { ...note, original: 'Original text.', replacement: '**Original text.**' })).updated, true);
        assert.ok((await tool('edit_selection', { ...note, original: 'Stale text.', replacement: 'x' })).error);
        await tool('update', { ...note, content: 'Changed.', operation: 'replace' });
        const history = await tool('list_versions', item);
        const versions = await Promise.all(history.map(async (entry: { id: number }) => ({
            versionId: entry.id, ...await tool('read_version', { ...item, versionId: entry.id }),
        })));
        const prior = { ...item, versionId: versions.find(v => v.markdown.includes('Original text.')).versionId };
        assert.ok((await tool('compare_version', prior)).some((part: { added?: boolean }) => part.added));
        assert.equal((await tool('restore_version', prior)).ok, true);
        assert.match((await tool('read', note)).content, /Original text/);

        const file = await tool('upload_file', { ...item, filename: 'sample.png', base64: 'AQID' });
        assert.equal((await tool('download_file', { ...v, fromId: doc.id, path: file.src })).base64, 'AQID');
        const archive = await tool('export_vault', v);
        const imported = await tool('import_vault', { filename: 'Imported.zip', base64: archive.base64 });
        assert.ok((await tool('open_vault', { vaultId: imported.id })).nodes.some((n: { name: string }) => n.name === 'Second'));
        assert.equal((await tool('delete_vault', { vaultId: imported.id })).ok, true);

        const folderItem = { ...v, nodeId: folder.id };
        assert.equal((await tool('read', { noteId: folder.id })).kind, 'folder');
        assert.equal((await tool('move', { noteId: folder.id, parentId: opened.main })).parent_id, opened.main);
        assert.equal((await tool('read', { noteId: file.id })).kind, 'file');
        assert.equal((await tool('move', { noteId: file.id, parentId: folder.id })).parent_id, folder.id);
        await tool('delete', { noteId: folder.id });
        assert.ok((await tool('list_trash', v)).some((n: { id: number }) => n.id === folder.id));
        assert.equal((await tool('restore_item', folderItem)).id, folder.id);
        await tool('delete', { noteId: folder.id });
        assert.equal((await tool('purge_item', folderItem)).ok, true);
        assert.ok((await tool('leave_vault', v)).error);
        assert.equal((await tool('delete_vault', v)).ok, true);
    });

    await step('share and revoke access with the same identity and boundaries as the UI', async () => {
        const v = { vaultId: vault.id };
        const people = await tool('find_people', { ...v, query: 'stranger' });
        assert.equal(people[0].email, 'stranger@example.test');
        assert.ok((await tool('rename_vault', { vaultId: hidden.id, name: 'Denied' })).error);
        assert.ok((await tool('set_sharing', { vaultId: hidden.id, link: true })).error);
        assert.ok((await tool('export_vault', { vaultId: hidden.id })).error);
        assert.equal((await tool('add_member', { ...v, email: people[0].email })).ok, true);
        assert.ok((await tool('list_members', v)).some((u: { id: number }) => u.id === people[0].id));
        const shared = await tool('set_sharing', { ...v, link: true });
        const publicPage = () => fetch(shared.url, { headers: { accept: 'application/json' } });
        assert.equal((await publicPage()).status, 200);
        assert.equal((await tool('get_sharing', v)).url, shared.url);
        await tool('set_sharing', { ...v, link: false });
        assert.equal((await publicPage()).status, 404);
        assert.equal((await tool('remove_member', { ...v, userId: people[0].id })).ok, true);
        assert.equal((await tool('rename_profile', { name: 'Account owner' })).name, 'Account owner');
        assert.equal((await tool('me')).name, 'Account owner');
    });

    await step('the public /mcp still requires Cloudflare Access', async () => {
        const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
        assert.equal(r.status, 401);
        assert.equal((await fetch(`${base}/mcp-local`)).status, 200 /* SPA shell, not MCP */);
    });

    bridge.stdin!.end();
    writeFileSync('artifacts/e2e/local-mcp.txt', results.join('\n') + '\n');
} finally {
    app.kill('SIGTERM');
}
console.log(`\n${results.length} steps passed`);
process.exit(0);
