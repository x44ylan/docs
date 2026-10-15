// One process: static client, JSON API, live sync, MCP and public share links.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { serve } from '@hono/node-server';
import { generateHTML } from '@tiptap/html/server';
import { Hono } from 'hono';
import { extensions, markdown } from '../shared/schema.ts';
import { api, fileAt, sendFile } from './api.ts';
import { get, HttpError } from './db.ts';
import { mcp } from './mcp.ts';
import * as notes from './notes.ts';
import { hocuspocus, snapshotAll, upgrade } from './sync.ts';

const app = new Hono();
const dist = join(import.meta.dirname, '../dist');

app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: 'Something went wrong. Try again.' }, 500);
});

app.use(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Frame-Options', 'SAMEORIGIN');
});

// `/up?documents` also lists the live documents held in memory.
app.get('/up', c => c.text(c.req.query('documents') === undefined ? 'ok' : `ok ${[...hocuspocus.documents.keys()].sort().join(' ')}`.trim()));
app.all('/mcp', c => mcp(c.req.raw));
app.route('/api', api);

// Public read-only links. The tunnel lets only these paths skip Access:
// /share/<token>, /share/<token>/files and /share/build/assets/*.
const shared = (token: string) => {
    if (!/^([A-Za-z0-9_-]{22}|[a-f0-9]{64})$/.test(token)) throw new HttpError(404, 'This link is no longer available.');
    const vault = get<{ id: number; name: string }>('select id, name from vaults where share_token = ?', token);
    if (!vault) throw new HttpError(404, 'This link is no longer available.');
    return vault;
};
const shell = () => readFileSync(join(dist, 'index.html'), 'utf8');
app.get('/share/:token', c => {
    // The page itself: same client, assets under the bypassed /share/build/.
    if (!c.req.header('accept')?.includes('application/json')) {
        return c.html(shell().replaceAll('"./assets/', '"./build/assets/'), 200, { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
    }
    const vault = shared(c.req.param('token'));
    const nodes = notes.tree(vault.id).filter(n => n.kind !== 'file').map(({ id, parent_id, name, kind }) => ({ id, parent_id, name, kind }));
    const requested = Number(c.req.query('file') ?? notes.mainNote(vault.id) ?? nodes.find(n => n.kind === 'note')?.id);
    const note = nodes.find(n => n.id === requested && n.kind === 'note');
    return c.json({
        name: vault.name,
        nodes,
        note: note ? { id: note.id, name: note.name, path: notes.path(note.id), html: generateHTML(markdown.parse(notes.markdownOf(note.id)), extensions) } : null,
    }, 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
});
app.get('/share/:token/files', c => {
    const vault = shared(c.req.param('token'));
    const from = Number(c.req.query('from'));
    const file = fileAt(vault.id, from ? notes.liveNode(from, vault.id).id : null, c.req.query('path') ?? '');
    if (!file) throw new HttpError(404);
    return sendFile(c, file);
});

// The client is built with relative URLs, so `/vaults/assets/x.js` and
// `/share/assets/x.js` both resolve to the same build output. That keeps the
// public page's assets under the /share/ bypass.
const mime: Record<string, string> = {
    js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon',
    txt: 'text/plain; charset=utf-8', woff2: 'font/woff2', wasm: 'application/wasm', json: 'application/json',
};
const file = (path: string) => {
    const name = basename(path);
    const asset = /\/assets\/([\w.-]+)$/.exec(path)?.[1];
    const target = asset ? join(dist, 'assets', asset) : /^[\w.-]+\.(png|svg|ico|txt)$/.test(name) ? join(dist, name) : '';
    return target && existsSync(target) ? { target, immutable: !!asset && !/\.txt$/.test(name) } : undefined;
};
app.get('*', c => {
    const found = file(c.req.path);
    if (found) {
        return c.body(readFileSync(found.target), 200, {
            'Content-Type': mime[found.target.split('.').pop() ?? ''] ?? 'application/octet-stream',
            'Cache-Control': found.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
        });
    }
    if (c.req.path.includes('.')) return c.text('Not found', 404);
    // Client-side routes all load the same shell.
    return c.html(shell(), 200, { 'Cache-Control': 'no-cache' });
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, info => console.log(`docs on ${info.address}:${info.port}`));
server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname === '/sync') void upgrade(request, socket, head);
    else socket.destroy();
});

// Daily: prune history and empty trash older than 30 days.
notes.prune();
// Rebuild the Markdown mirror from SQLite on start (covers crashes and
// failed writes), and retry any failed vault every hour.
notes.repairMirrors();
setInterval(notes.prune, 24 * 60 * 60_000).unref();
setInterval(() => notes.mirrorsStale() && notes.repairMirrors(), 60 * 60_000).unref();

// Save open documents before exiting.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
        hocuspocus.flushPendingStores();
        await new Promise(resolve => setTimeout(resolve, 500));
        snapshotAll();
        server.close();
        process.exit(0);
    });
}
