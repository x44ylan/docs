// JSON API for the browser. Every route runs as the Cloudflare Access user.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Hono, type Context } from 'hono';
import { assertAccess, assertion, identify, type User } from './auth.ts';
import { all, blobsDir, get, HttpError, run, tx } from './db.ts';
import * as notes from './notes.ts';
import { disconnect, edit, treeChanged } from './sync.ts';

type Env = { Variables: { user: User } };
export const api = new Hono<Env>();

api.use(async (c, next) => {
    c.set('user', await identify(assertion(c.req.header('cf-access-jwt-assertion'), c.req.header('cookie'))));
    await next();
    c.header('Cache-Control', 'no-store');
});

const id = (c: Context<Env>, key: string) => {
    const value = Number(c.req.param(key));
    if (!Number.isSafeInteger(value) || value < 1) throw new HttpError(404);
    return value;
};
const body = async <T = Record<string, unknown>>(c: Context<Env>) => {
    try { return (await c.req.json()) as T; } catch { throw new HttpError(400, 'Invalid JSON.'); }
};
const vaultOf = (c: Context<Env>) => {
    const vaultId = id(c, 'vault');
    assertAccess(c.get('user'), vaultId);
    return vaultId;
};
const noteIn = (c: Context<Env>) => notes.liveNode(id(c, 'node'), vaultOf(c));
const nullableId = (value: unknown) => {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, 'Invalid parent.');
    return value as number;
};

// Renames and moves change paths: rewrite affected links live, then refresh
// the mirror and tell open clients.
async function relocate(vaultId: number, nodeId: number, user: User, change: () => void) {
    const records = notes.captureLinks(nodeId);
    change();
    for (const [source, map] of notes.brokenLinks(records)) {
        await edit(source, user, 'web', text => notes.replaceHrefs(text, map));
    }
    for (const record of records) notes.indexNote(record.source, notes.markdownOf(record.source));
    notes.mirrorVault(vaultId);
    treeChanged(vaultId);
}

// --- Home ------------------------------------------------------------------

api.get('/home', c => {
    const user = c.get('user');
    return c.json({ user, vaults: notes.visibleVaults(user), pins: notes.pins(user), recent: notes.recent(user) });
});

api.patch('/me', async c => {
    const { name } = await body<{ name?: unknown }>(c);
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean || clean.length > 255) throw new HttpError(400, 'Enter a name.');
    run('update users set name = ? where id = ?', clean, c.get('user').id);
    return c.json({ name: clean });
});

// --- Vaults ----------------------------------------------------------------

api.post('/vaults', async c => {
    const user = c.get('user');
    const name = notes.cleanName((await body(c)).name);
    const vaultId = tx(() => {
        const taken = new Set(all<{ name: string }>('select name from vaults where owner_id = ?', user.id).map(v => v.name.toLowerCase()));
        let free = name;
        for (let n = 2; taken.has(free.toLowerCase()); n++) free = `${name}-${n}`;
        return Number(run('insert into vaults (name, owner_id) values (?, ?)', free, user.id).lastInsertRowid);
    });
    const vault = get<{ name: string }>('select name from vaults where id = ?', vaultId)!;
    notes.create(vaultId, null, 'note', vault.name, '', user);
    return c.json({ id: vaultId, name: vault.name }, 201);
});

api.get('/vaults/:vault', c => {
    const vaultId = vaultOf(c);
    const user = c.get('user');
    const vault = get<{ id: number; name: string; owner_id: number; public: number; share_token: string | null }>(
        'select id, name, owner_id, public, share_token from vaults where id = ?', vaultId)!;
    return c.json({ ...vault, main: notes.mainNote(vaultId), nodes: notes.tree(vaultId), pins: notes.pins(user, vaultId).map(p => p.id) });
});

api.patch('/vaults/:vault', async c => {
    const vaultId = vaultOf(c);
    const name = notes.cleanName((await body(c)).name);
    run('update vaults set name = ? where id = ?', name, vaultId);
    treeChanged(vaultId);
    return c.json({ name });
});

api.delete('/vaults/:vault', c => {
    const vaultId = vaultOf(c);
    const user = c.get('user');
    if (!get('select 1 from vaults where id = ? and owner_id = ?', vaultId, user.id)) {
        // Members leave a shared vault instead of deleting it.
        run('delete from members where vault_id = ? and user_id = ?', vaultId, user.id);
        disconnect(user.id, vaultId);
        return c.body(null, 204);
    }
    run('delete from vaults where id = ?', vaultId);
    treeChanged(vaultId);
    return c.body(null, 204);
});

// --- Sharing ---------------------------------------------------------------

api.get('/vaults/:vault/members', c => {
    const vaultId = vaultOf(c);
    return c.json(all<User & { owner: number }>(
        `select u.id, u.name, u.email, 1 owner from vaults v join users u on u.id = v.owner_id where v.id = ?
         union all select u.id, u.name, u.email, 0 from members m join users u on u.id = m.user_id where m.vault_id = ? order by owner desc, name`,
        vaultId, vaultId,
    ));
});

// Lookup while typing: people who have signed in to Docs and are not members.
api.get('/vaults/:vault/people', c => {
    const vaultId = vaultOf(c);
    const q = `%${(c.req.query('q') ?? '').trim().toLowerCase().replace(/[%_!]/g, '!$&')}%`;
    return c.json(all<User>(
        `select id, name, email from users u where (lower(name) like ? escape '!' or lower(email) like ? escape '!')
         and u.id != (select owner_id from vaults where id = ?) and not exists (select 1 from members m where m.vault_id = ? and m.user_id = u.id)
         order by name limit 8`,
        q, q, vaultId, vaultId,
    ));
});

api.post('/vaults/:vault/members', async c => {
    const vaultId = vaultOf(c);
    const email = String((await body(c)).email ?? '').trim().toLowerCase();
    const user = get<{ id: number }>('select id from users where email = ?', email);
    if (!user) throw new HttpError(404, 'They need to sign in to Docs once before you can share with them.');
    if (get('select 1 from vaults where id = ? and owner_id = ?', vaultId, user.id)) throw new HttpError(409, 'They already own this vault.');
    run('insert or ignore into members (vault_id, user_id) values (?, ?)', vaultId, user.id);
    return c.body(null, 204);
});

api.delete('/vaults/:vault/members/:user', c => {
    const vaultId = vaultOf(c);
    const userId = id(c, 'user');
    run('delete from members where vault_id = ? and user_id = ?', vaultId, userId);
    disconnect(userId, vaultId);
    return c.body(null, 204);
});

// `public`: everyone signed in to Docs. `link`: read-only link for anyone.
api.get('/vaults/:vault/share', c => c.json(get('select public, share_token from vaults where id = ?', vaultOf(c))));
api.patch('/vaults/:vault/share', async c => {
    const vaultId = vaultOf(c);
    const { public: open, link } = await body<{ public?: boolean; link?: boolean }>(c);
    if (typeof open === 'boolean') run('update vaults set public = ? where id = ?', open ? 1 : 0, vaultId);
    if (link === true) run('update vaults set share_token = coalesce(share_token, ?) where id = ?', randomBytes(16).toString('base64url').slice(0, 22), vaultId);
    if (link === false) run('update vaults set share_token = null where id = ?', vaultId);
    return c.json(get('select public, share_token from vaults where id = ?', vaultId));
});

// --- Nodes -----------------------------------------------------------------

api.post('/vaults/:vault/nodes', async c => {
    const vaultId = vaultOf(c);
    const input = await body<{ name?: unknown; parent_id?: unknown; kind?: unknown }>(c);
    const kind = input.kind === 'folder' ? 'folder' : 'note';
    const created = notes.create(vaultId, nullableId(input.parent_id), kind, input.name, '', c.get('user'));
    treeChanged(vaultId);
    return c.json(created, 201);
});

api.get('/vaults/:vault/nodes/:node', c => {
    const found = noteIn(c);
    const user = c.get('user');
    return c.json({
        ...found,
        path: notes.path(found.id),
        markdown: found.kind === 'note' ? notes.markdownOf(found.id) : '',
        epoch: get<{ epoch: string | null }>('select epoch from docs where node_id = ?', found.id)?.epoch ?? null,
        backlinks: notes.backlinks(found.id),
        pinned: !!get('select 1 from pins where user_id = ? and node_id = ?', user.id, found.id),
    });
});

api.patch('/vaults/:vault/nodes/:node', async c => {
    const found = noteIn(c);
    const input = await body<{ name?: unknown; parent_id?: unknown }>(c);
    await relocate(found.vault_id, found.id, c.get('user'), () => {
        if ('parent_id' in input) notes.move(found.id, nullableId(input.parent_id));
        if ('name' in input) notes.rename(found.id, input.name);
    });
    return c.json(notes.node(found.id));
});

api.delete('/vaults/:vault/nodes/:node', c => {
    const found = noteIn(c);
    notes.trash(found.id, c.get('user'));
    notes.mirrorVault(found.vault_id);
    treeChanged(found.vault_id);
    return c.body(null, 204);
});

api.put('/vaults/:vault/nodes/:node/pin', c => {
    const found = noteIn(c);
    run('insert or ignore into pins (user_id, node_id) values (?, ?)', c.get('user').id, found.id);
    return c.body(null, 204);
});
api.delete('/vaults/:vault/nodes/:node/pin', c => {
    run('delete from pins where user_id = ? and node_id = ?', c.get('user').id, noteIn(c).id);
    return c.body(null, 204);
});

// --- History ---------------------------------------------------------------

api.get('/vaults/:vault/nodes/:node/versions', c => c.json(notes.versions(noteIn(c).id)));
api.get('/vaults/:vault/nodes/:node/versions/:version', c => {
    const found = notes.version(noteIn(c).id, id(c, 'version'));
    if (!found) throw new HttpError(404);
    return c.json(found);
});
api.post('/vaults/:vault/nodes/:node/versions/:version/restore', async c => {
    const found = noteIn(c);
    const target = notes.version(found.id, id(c, 'version'));
    if (!target) throw new HttpError(404);
    await edit(found.id, c.get('user'), 'restore', () => target.markdown);
    return c.body(null, 204);
});

// --- Trash -----------------------------------------------------------------

api.get('/vaults/:vault/trash', c => c.json(notes.trashed(vaultOf(c))));
api.post('/vaults/:vault/trash/:node', c => {
    const vaultId = vaultOf(c);
    if (notes.node(id(c, 'node'))?.vault_id !== vaultId) throw new HttpError(404);
    const restored = notes.restore(id(c, 'node'));
    notes.mirrorVault(vaultId);
    treeChanged(vaultId);
    return c.json(restored);
});
api.delete('/vaults/:vault/trash/:node', c => {
    const vaultId = vaultOf(c);
    if (notes.node(id(c, 'node'))?.vault_id !== vaultId) throw new HttpError(404);
    notes.purge(id(c, 'node'));
    return c.body(null, 204);
});

// --- Search ----------------------------------------------------------------

api.get('/search', c => {
    const vault = c.req.query('vault');
    return c.json(notes.search(c.get('user'), (c.req.query('q') ?? '').slice(0, 200), vault ? Number(vault) : undefined));
});

// --- Attachments -----------------------------------------------------------

const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
    pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
export const blob = (nodeId: number) => join(blobsDir, String(nodeId));

// Files referenced from a note resolve relative to the note, like links.
export function fileAt(vaultId: number, fromId: number | null, href: string) {
    let target = href;
    try { target = decodeURIComponent(href); } catch { /* raw */ }
    const base = fromId ? posix.dirname(notes.path(fromId)) : '/';
    const parts = posix.normalize(target.startsWith('/') ? target : posix.join(base, target)).split('/').filter(Boolean);
    let parent: number | null = null;
    let found: notes.Node | undefined;
    for (const [i, part] of parts.entries()) {
        const last = i === parts.length - 1;
        const ext = last ? extname(part).slice(1).toLowerCase() : '';
        found = last
            ? get<notes.Node>(`select * from nodes where vault_id = ? and parent_id is ? and kind = 'file' and name = ? collate nocase and ext = ? and deleted_at is null`,
                vaultId, parent, part.slice(0, part.length - ext.length - 1), ext)
            : get<notes.Node>(`select * from nodes where vault_id = ? and parent_id is ? and kind != 'file' and name = ? collate nocase and deleted_at is null order by kind = 'folder' desc`,
                vaultId, parent, part);
        if (!found) return;
        parent = found.id;
    }
    return found?.kind === 'file' && existsSync(blob(found.id)) ? found : undefined;
}

export const sendFile = (c: Context, file: notes.Node) =>
    c.body(readFileSync(blob(file.id)), 200, {
        'Content-Type': types[file.ext ?? ''] ?? 'application/octet-stream',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
    });

api.get('/vaults/:vault/files', c => {
    const vaultId = vaultOf(c);
    const from = c.req.query('from');
    const file = fileAt(vaultId, from ? notes.liveNode(Number(from), vaultId).id : null, c.req.query('path') ?? '');
    if (!file) throw new HttpError(404);
    return sendFile(c, file);
});

// Upload into the note's sub-note folder; returns the relative path to insert.
api.post('/vaults/:vault/nodes/:node/files', async c => {
    const found = noteIn(c);
    const form = await c.req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) throw new HttpError(400, 'Choose a file.');
    if (upload.size > 500 * 1024 * 1024) throw new HttpError(413, 'Files are limited to 500 MB.');
    const ext = extname(upload.name).slice(1).toLowerCase();
    if (!types[ext]) throw new HttpError(400, 'This file type is not supported.');
    const stem = notes.cleanName(upload.name.slice(0, upload.name.length - ext.length - 1) || 'file');
    const parentId = found.kind === 'note' ? found.parent_id : found.id;
    const created = tx(() => {
        const name = notes.freeName(found.vault_id, parentId, 'file', stem);
        return Number(run('insert into nodes (vault_id, parent_id, name, kind, ext) values (?, ?, ?, ?, ?)', found.vault_id, parentId, name, 'file', ext).lastInsertRowid);
    });
    writeFileSync(blob(created), new Uint8Array(await upload.arrayBuffer()));
    const node = notes.node(created)!;
    treeChanged(found.vault_id);
    return c.json({ id: created, name: node.name, src: encodeURI(`${node.name}.${ext}`) }, 201);
});

// --- Import / export -------------------------------------------------------

api.get('/vaults/:vault/export', c => {
    const vaultId = vaultOf(c);
    const files: Record<string, Uint8Array> = {};
    for (const n of notes.tree(vaultId)) {
        const at = notes.path(n.id).slice(1);
        if (n.kind === 'note') files[at] = strToU8(notes.markdownOf(n.id));
        if (n.kind === 'file' && existsSync(blob(n.id))) files[at] = readFileSync(blob(n.id));
    }
    const name = get<{ name: string }>('select name from vaults where id = ?', vaultId)!.name;
    return c.body(zipSync(files), 200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
    });
});

api.post('/import', async c => {
    const user = c.get('user');
    const form = await c.req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File) || !upload.name.toLowerCase().endsWith('.zip')) throw new HttpError(400, 'Choose a .zip file.');
    if (upload.size > 256 * 1024 * 1024) throw new HttpError(413, 'Archives are limited to 256 MB.');
    let entries: Record<string, Uint8Array>;
    let total = 0;
    try {
        entries = unzipSync(new Uint8Array(await upload.arrayBuffer()), {
            filter: file => {
                total += file.originalSize;
                if (total > 256 * 1024 * 1024) throw new Error('too large');
                return !file.name.endsWith('/') && !/(^|\/)(\.|__MACOSX)/.test(file.name);
            },
        });
    } catch {
        throw new HttpError(400, 'Could not read the archive.');
    }
    const name = notes.cleanName(upload.name.replace(/\.zip$/i, ''));
    const vaultId = Number(run('insert into vaults (name, owner_id) values (?, ?)', name, user.id).lastInsertRowid);
    // `A.md` + `A/B.md` becomes note A with sub-note B; other folders stay folders.
    const paths = Object.keys(entries).filter(p => p.split('/').length <= 64).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const ids = new Map<string, number>();
    const parentFor = (dir: string): number | null => {
        if (dir === '.' || dir === '') return null;
        const existing = ids.get(`${dir}.md`) ?? ids.get(dir);
        if (existing) return existing;
        const folder = notes.create(vaultId, parentFor(posix.dirname(dir)), 'folder', posix.basename(dir), '', user).id;
        ids.set(dir, folder);
        return folder;
    };
    for (const at of paths.filter(p => p.toLowerCase().endsWith('.md'))) {
        const created = notes.create(vaultId, parentFor(posix.dirname(at)), 'note', posix.basename(at).slice(0, -3), strFromU8(entries[at]), user);
        ids.set(at, created.id);
    }
    for (const at of paths.filter(p => types[extname(p).slice(1).toLowerCase()])) {
        const ext = extname(at).slice(1).toLowerCase();
        const parentId = parentFor(posix.dirname(at));
        const stem = posix.basename(at).slice(0, -ext.length - 1);
        const file = Number(run('insert into nodes (vault_id, parent_id, name, kind, ext) values (?, ?, ?, ?, ?)',
            vaultId, parentId, notes.freeName(vaultId, parentId, 'file', notes.cleanName(stem)), 'file', ext).lastInsertRowid);
        writeFileSync(blob(file), entries[at]);
    }
    for (const note of notes.tree(vaultId).filter(n => n.kind === 'note')) notes.indexNote(note.id, notes.markdownOf(note.id));
    mkdirSync(blobsDir, { recursive: true });
    return c.json({ id: vaultId, name }, 201);
});
