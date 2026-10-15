// Post-deploy check against the real site through Cloudflare, using a Codex
// MCP OAuth token (Managed OAuth). Read-only except a scratch note that is
// created in the first vault, edited live, then moved to trash.
//   node tests/live.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

const origin = 'https://docs.x44ylan.com';
const creds = JSON.parse(readFileSync(`${process.env.HOME}/.codex/.credentials.json`, 'utf8'));
const token = Object.values<{ server_url: string; access_token: string }>(creds).find(c => c.server_url === `${origin}/mcp`)?.access_token;
assert.ok(token, 'Sign in first: codex mcp login docs');
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
