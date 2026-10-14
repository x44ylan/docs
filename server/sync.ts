// Live co-editing. Each note is a Yjs document `note:<id>`; each vault has a
// read-only channel `vault:<id>` that tells open clients when the tree changes.
// Browsers, MCP and link rewrites all edit through the same document, so
// concurrent changes merge instead of overwriting each other.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Hocuspocus, type Document } from '@hocuspocus/server';
import { Node as PMNode } from '@tiptap/pm/model';
import { prosemirrorJSONToYDoc, updateYFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { markdown, schema } from '../shared/schema.ts';
import { assertAccess, assertion, identify, type User } from './auth.ts';
import { get, HttpError, run } from './db.ts';
import { liveNode, markdownOf, saveMarkdown, snapshot } from './notes.ts';

type Context = { user: User; source?: 'web' | 'mcp' | 'restore' };
const field = 'default';

const toMarkdown = (doc: Y.Doc) => markdown.serialize(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(field)));

function setMarkdown(doc: Y.Doc, text: string) {
    const next = PMNode.fromJSON(schema, markdown.parse(text));
    updateYFragment(doc, doc.getXmlFragment(field), next, { mapping: new Map(), isOMark: new Map() });
}

const parse = (name: string) => {
    const match = /^(note|vault):([1-9]\d*)$/.exec(name);
    if (!match) throw new HttpError(404);
    return { kind: match[1] as 'note' | 'vault', id: Number(match[2]) };
};

// Snapshot when an editing session has been quiet for 5 minutes, or ends.
const quiet = new Map<number, NodeJS.Timeout>();
function snapshotLater(id: number, user: User | null) {
    clearTimeout(quiet.get(id));
    quiet.set(id, setTimeout(() => {
        quiet.delete(id);
        snapshot(id, markdownOf(id), user, 'web');
    }, 5 * 60_000).unref());
}

export const hocuspocus = new Hocuspocus<Context>({
    name: 'docs',
    quiet: true,
    debounce: 2000,
    maxDebounce: 10_000,
    async onAuthenticate({ documentName, context, connectionConfig }) {
        const { kind, id } = parse(documentName);
        assertAccess(context.user, kind === 'vault' ? id : liveNode(id).vault_id);
        if (kind === 'vault') connectionConfig.readOnly = true;
    },
    async onLoadDocument({ documentName, document }) {
        const { kind, id } = parse(documentName);
        if (kind === 'vault') return document;
        const row = get<{ state: Uint8Array | null; markdown: string }>('select state, markdown from docs where node_id = ?', id);
        if (row?.state) {
            Y.applyUpdate(document, row.state);
        } else {
            // First open after import: build the shared state from Markdown once.
            Y.applyUpdate(document, Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, markdown.parse(row?.markdown ?? ''), field)));
            // A new epoch tells browsers to drop any offline copy of an older state.
            run('update docs set state = ?, epoch = ? where node_id = ?', Y.encodeStateAsUpdate(document), randomUUID(), id);
        }
        return document;
    },
    async onStoreDocument({ documentName, document, lastContext }) {
        const { kind, id } = parse(documentName);
        if (kind === 'vault' || !liveNode(id)) return;
        saveMarkdown(id, toMarkdown(document), lastContext?.user ?? null, Y.encodeStateAsUpdate(document));
        if (lastContext?.source !== 'mcp') snapshotLater(id, lastContext?.user ?? null);
    },
    async afterUnloadDocument({ documentName }) {
        const { kind, id } = parse(documentName);
        if (kind === 'note' && quiet.has(id)) {
            clearTimeout(quiet.get(id));
            quiet.delete(id);
            snapshot(id, markdownOf(id), null, 'web');
        }
    },
});

// Server-side edit (MCP, restore, link rewrite): applied as a normal edit so
// open editors see it live. `change` receives the current Markdown.
export async function edit(id: number, user: User, source: 'mcp' | 'restore' | 'web', change: (current: string) => string) {
    liveNode(id);
    const connection = await hocuspocus.openDirectConnection(`note:${id}`, { user, source });
    let result = '';
    try {
        await connection.transact(doc => {
            const current = toMarkdown(doc);
            if (source !== 'web') snapshot(id, current, null, source === 'mcp' ? 'mcp' : 'restore');
            result = change(current);
            if (result.length > 1_000_000) throw new HttpError(413, 'Notes are limited to 1,000,000 characters.');
            if (result !== current) setMarkdown(doc, result);
        });
    } finally {
        await connection.disconnect();
    }
    return markdownOf(id);
}

// Tell everyone with the vault open that its tree changed.
export function treeChanged(vaultId: number) {
    hocuspocus.documents.get(`vault:${vaultId}`)?.broadcastStateless(JSON.stringify({ type: 'tree' }));
}

// Close a user's live connections to a vault after their access is removed.
export function disconnect(userId: number, vaultId: number) {
    for (const document of hocuspocus.documents.values() as Iterable<Document>) {
        const { kind, id } = parse(document.name);
        const vault = kind === 'vault' ? id : get<{ vault_id: number }>('select vault_id from nodes where id = ?', id)?.vault_id;
        if (vault !== vaultId) continue;
        for (const connection of document.getConnections()) {
            if ((connection.context as Context).user.id === userId) connection.close({ code: 4403, reason: 'Access removed' });
        }
    }
}

// WebSocket upgrade for /sync. Cloudflare Access sends its assertion on the
// upgrade request, so the socket carries the same verified identity.
const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
export async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    let user: User;
    try {
        user = await identify(assertion(request.headers['cf-access-jwt-assertion'] as string | undefined, request.headers.cookie));
    } catch {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
    }
    sockets.handleUpgrade(request, socket, head, ws => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value);
        const client = hocuspocus.handleConnection(ws, new Request(`http://localhost${request.url}`, { headers }), { user });
        const ping = setInterval(() => ws.ping(), 25_000);
        ws.on('pong', () => client.touch());
        ws.on('message', (data: Buffer) => client.handleMessage(new Uint8Array(data)));
        ws.on('close', (code, reason) => {
            clearInterval(ping);
            client.handleClose({ code, reason: reason.toString() });
        });
    });
}
