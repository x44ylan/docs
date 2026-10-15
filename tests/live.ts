// Post-deploy check against the real site through Cloudflare, using a Codex
// MCP OAuth token (Managed OAuth). Read-only except a scratch note that is
// created in the first vault, edited live, then moved to trash.
//   node tests/live.ts
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

const origin = 'https://docs.x44ylan.com';
type Credential = { server_url: string; issuer: string; client_id: string; access_token: string; refresh_token?: string; expires_at: number };
const file = `${process.env.HOME}/.codex/.credentials.json`;
const creds = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Credential>;
const entry = Object.entries(creds).find(([, c]) => c.server_url === `${origin}/mcp`);
assert.ok(entry, 'Sign in first: codex mcp login docs');
const [key, credential] = entry;
// Access tokens last 15 minutes; refresh like Codex does and save the result.
if (credential.expires_at < Date.now() + 60_000) {
    assert.ok(credential.refresh_token, 'Token expired: codex mcp login docs');
    const response = await fetch(`${credential.issuer}/cdn-cgi/access/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refresh_token, client_id: credential.client_id }),
    });
    assert.equal(response.status, 200, `refresh failed: ${await response.clone().text()}`);
    const fresh = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
    creds[key] = { ...credential, access_token: fresh.access_token, refresh_token: fresh.refresh_token ?? credential.refresh_token, expires_at: Date.now() + fresh.expires_in * 1000 };
    writeFileSync(file, JSON.stringify(creds), { mode: 0o600 });
}
const token = creds[key].access_token;
const headers = { Authorization: `Bearer ${token}` };

async function mcp(name: string, args: unknown) {
    const r = await fetch(`${origin}/mcp`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(r.status, 200);
    const { result } = await r.json();
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
}

const me = await mcp('me', {});
console.log('signed in as', me.email);
const vault = (await mcp('vaults', {})).data[0];
const note = await mcp('create', { vaultId: vault.id, name: `live-check-${Date.now()}`, content: 'start\n' });
try {
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: `wss://docs.x44ylan.com/sync`, WebSocketPolyfill: class extends WebSocket { constructor(url: string) { super(url, { headers }); } } });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: `note:${note.id}`, document: doc, token: 'access' });
    provider.attach();
    await new Promise<void>((resolve, reject) => { provider.on('synced', () => resolve()); provider.on('authenticationFailed', () => reject(new Error('sync denied'))); setTimeout(() => reject(new Error('sync timeout')), 15000); });
    console.log('live sync connected through Cloudflare');
    await mcp('update', { noteId: note.id, content: 'from agent\n' });
    await new Promise(r => setTimeout(r, 1500));
    assert.match(doc.getXmlFragment('default').toString(), /from agent/);
    console.log('agent edit arrived live');
    provider.destroy();
    socket.destroy();
} finally {
    await mcp('delete', { noteId: note.id });
    console.log('scratch note moved to trash');
}
process.exit(0);
