// Vaults, the note tree, trash, links, search and history. Every write goes
// through here so SQLite, the Markdown mirror and the search index agree.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { all, filesDir, get, HttpError, run, tx } from './db.ts';
import type { User } from './auth.ts';

export type Kind = 'note' | 'folder' | 'file';
export type Node = {
    id: number; vault_id: number; parent_id: number | null; name: string; kind: Kind; ext: string | null;
    updated_at: string; deleted_at: string | null;
};
const columns = 'id, vault_id, parent_id, name, kind, ext, updated_at, deleted_at';

export const node = (id: number) => get<Node>(`select ${columns} from nodes where id = ?`, id);

export function liveNode(id: number, vaultId?: number): Node {
    const found = node(id);
    if (!found || found.deleted_at || (vaultId !== undefined && found.vault_id !== vaultId)) throw new HttpError(404, 'Note unavailable.');
    return found;
}

export const tree = (vaultId: number) =>
    all<Node>(`select ${columns} from nodes where vault_id = ? and deleted_at is null order by name collate nocase`, vaultId);

// Names stay valid file names on every platform and in Markdown links.
export function cleanName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
    if (!name || name.length > 255 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^\.+$/.test(name)) {
        throw new HttpError(400, 'Use a name without / \\ : * ? " < > |.');
    }
    return name;
}

// Siblings share a namespace per kind; duplicates get `-2`, `-3`, ...
export function freeName(vaultId: number, parentId: number | null, kind: Kind, name: string, ignore = 0): string {
    const taken = new Set(all<{ name: string }>(
        'select name from nodes where vault_id = ? and parent_id is ? and kind = ? and id != ? and deleted_at is null',
        vaultId, parentId, kind, ignore,
    ).map(row => row.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    let n = 2;
    while (taken.has(`${name}-${n}`.toLowerCase())) n++;
    return `${name}-${n}`;
}

export function path(id: number): string {
    const parts: string[] = [];
    for (let current = node(id); current; current = current.parent_id ? node(current.parent_id) : undefined) {
        parts.unshift(current.kind === 'folder' ? current.name : `${current.name}${current.kind === 'note' ? '.md' : current.ext ? `.${current.ext}` : ''}`);
    }
    // A note's sub-notes live in a folder next to it: `A.md` and `A/B.md`.
    return '/' + parts.map((part, i) => (i < parts.length - 1 ? part.replace(/\.md$/, '') : part)).join('/');
}

function assertParent(vaultId: number, parentId: number | null, moving?: number) {
    if (parentId === null) return;
    const parent = liveNode(parentId, vaultId);
    if (parent.kind === 'file') throw new HttpError(400, 'Files cannot contain notes.');
    for (let current: Node | undefined = parent; current; current = current.parent_id ? node(current.parent_id) : undefined) {
        if (current.id === moving) throw new HttpError(400, 'A note cannot move inside itself.');
    }
}

// --- Markdown mirror -------------------------------------------------------

const mirrorPath = (vaultId: number, id: number) => join(filesDir, String(vaultId), path(id));

function writeMirror(vaultId: number, id: number, markdown: string) {
    const target = mirrorPath(vaultId, id);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.tmp`, markdown);
    renameSync(`${target}.tmp`, target);
}

// Rebuild one vault's mirror from SQLite after renames, moves and deletes.
export function mirrorVault(vaultId: number) {
    const root = join(filesDir, String(vaultId));
    const staging = `${root}.next`;
    rmSync(staging, { recursive: true, force: true });
    for (const note of all<{ id: number; markdown: string }>(
        `select n.id, d.markdown from nodes n join docs d on d.node_id = n.id where n.vault_id = ? and n.kind = 'note' and n.deleted_at is null`,
        vaultId,
    )) {
        const target = join(staging, path(note.id));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, note.markdown);
    }
    mkdirSync(staging, { recursive: true });
    rmSync(root, { recursive: true, force: true });
    renameSync(staging, root);
}

// --- Links -----------------------------------------------------------------

// Vault links are absolute (`/A/B.md`) or relative to the note's folder.
export function resolveLink(fromId: number, href: string): Node | undefined {
    if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href)) return;
    let target = href.split('#')[0];
    try { target = decodeURI(target); } catch { /* keep raw */ }
    if (!target.endsWith('.md')) return;
    const from = node(fromId)!;
    const full = posix.normalize(target.startsWith('/') ? target : posix.join(posix.dirname(path(fromId)), target));
    const parts = full.split('/').filter(Boolean);
    let parent: number | null = null;
    let found: Node | undefined;
    for (const [i, part] of parts.entries()) {
        const last = i === parts.length - 1;
        const name = last ? part.replace(/\.md$/, '') : part;
        found = get<Node>(
            `select ${columns} from nodes where vault_id = ? and parent_id is ? and name = ? collate nocase and deleted_at is null
             order by kind = ? desc limit 1`,
            from.vault_id, parent, name, last ? 'note' : 'folder',
        );
        if (!found || (last && found.kind !== 'note')) return;
        parent = found.id;
    }
    return found;
}

const hrefs = (markdown: string) => [...markdown.matchAll(/\]\(<?([^)>\s]+(?: [^)">]*?)?)>?(?:\s+"[^"]*")?\)/g)].map(m => m[1]);

export function indexNote(id: number, markdown: string) {
    const note = node(id)!;
    run('delete from links where source_id = ?', id);
    for (const href of hrefs(markdown)) {
        const target = resolveLink(id, href);
        if (target && target.id !== id) run('insert or ignore into links (source_id, target_id) values (?, ?)', id, target.id);
    }
    run('delete from search where node_id = ?', id);
    if (!note.deleted_at) run('insert into search (name, body, node_id) values (?, ?, ?)', note.name, markdown, id);
}

export const backlinks = (id: number) =>
    all<{ id: number; name: string }>(
        `select n.id, n.name from links l join nodes n on n.id = l.source_id where l.target_id = ? and n.deleted_at is null order by n.name`,
        id,
    );

// Renames and moves change paths. Record what every affected link resolves to
// beforehand, then rewrite the hrefs that no longer reach the same note.
export type LinkRecord = { source: number; href: string; target: number };
export function captureLinks(id: number): LinkRecord[] {
    const moved = subtree(id);
    const marks = moved.map(() => '?').join(',');
    const sources = all<{ id: number }>(
        `select distinct source_id id from links where target_id in (${marks}) or source_id in (${marks})`,
        ...moved, ...moved,
    );
    return sources.flatMap(({ id: source }) =>
        hrefs(markdownOf(source)).flatMap(href => {
            const target = resolveLink(source, href);
            return target ? [{ source, href, target: target.id }] : [];
        }),
    );
}

export function brokenLinks(records: LinkRecord[]) {
    const changes = new Map<number, Map<string, string>>();
    for (const { source, href, target } of records) {
        if (resolveLink(source, href)?.id === target || node(source)?.deleted_at) continue;
        const next = path(target);
        const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
        const map = changes.get(source) ?? new Map<string, string>();
        map.set(href, (/%[0-9a-f]{2}/i.test(href) ? encodeURI(next) : next) + hash);
        changes.set(source, map);
    }
    return changes;
}

export const replaceHrefs = (markdown: string, map: Map<string, string>) =>
    markdown.replace(/\]\((<?)([^)>\s]+(?: [^)">]*?)?)(>?(?:\s+"[^"]*")?\))/g, (match, open, href, close) =>
        map.has(href) ? `](${open}${map.get(href)}${close}` : match);

// --- Notes -----------------------------------------------------------------

export function markdownOf(id: number) {
    return get<{ markdown: string }>('select markdown from docs where node_id = ?', id)?.markdown ?? '';
}

// Called by sync after edits settle, and by MCP/import for direct writes.
export function saveMarkdown(id: number, markdown: string, user: User | null, state?: Uint8Array) {
    tx(() => {
        const before = get<{ markdown: string }>('select markdown from docs where node_id = ?', id);
        if (before?.markdown === markdown && !state) return;
        run(
            `insert into docs (node_id, markdown, state, editor_id) values (?, ?, ?, ?)
             on conflict (node_id) do update set markdown = excluded.markdown, state = coalesce(excluded.state, docs.state), editor_id = excluded.editor_id`,
            id, markdown, state ?? null, user?.id ?? null,
        );
        if (before?.markdown === markdown) return;
        run(`update nodes set updated_at = datetime('now') where id = ?`, id);
        indexNote(id, markdown);
    });
    const note = node(id)!;
    if (!note.deleted_at) writeMirror(note.vault_id, id, markdown);
}

export function create(vaultId: number, parentId: number | null, kind: Exclude<Kind, 'file'>, rawName: unknown, markdown = '', user: User | null = null) {
    const id = tx(() => {
        assertParent(vaultId, parentId);
        const name = freeName(vaultId, parentId, kind, cleanName(rawName));
        const id = Number(run('insert into nodes (vault_id, parent_id, name, kind) values (?, ?, ?, ?)', vaultId, parentId, name, kind).lastInsertRowid);
        if (kind === 'note') {
            run('insert into docs (node_id, markdown, editor_id) values (?, ?, ?)', id, markdown, user?.id ?? null);
            indexNote(id, markdown);
            if (markdown) snapshot(id, markdown, user, 'import');
        }
        return id;
    });
    if (kind === 'note') writeMirror(vaultId, id, markdown);
    return node(id)!;
}

export function rename(id: number, rawName: unknown) {
    const current = liveNode(id);
    return tx(() => {
        const name = freeName(current.vault_id, current.parent_id, current.kind, cleanName(rawName), id);
        run(`update nodes set name = ?, updated_at = datetime('now') where id = ?`, name, id);
        if (current.kind === 'note') indexNote(id, markdownOf(id));
        return node(id)!;
    });
}

export function move(id: number, parentId: number | null) {
    const current = liveNode(id);
    return tx(() => {
        assertParent(current.vault_id, parentId, id);
        const name = freeName(current.vault_id, parentId, current.kind, current.name, id);
        run(`update nodes set parent_id = ?, name = ?, updated_at = datetime('now') where id = ?`, parentId, name, id);
        return node(id)!;
    });
}

const subtree = (id: number) =>
    all<{ id: number }>(
        `with recursive t(id) as (select ? union all select n.id from nodes n join t on n.parent_id = t.id) select id from t`,
        id,
    ).map(row => row.id);

// Deleting moves a note and everything under it to trash; links stay.
export function trash(id: number, user: User) {
    const current = liveNode(id);
    tx(() => {
        // Only live descendants join this trash entry; earlier deletions keep their own.
        for (const nodeId of subtree(id).filter(nodeId => !node(nodeId)!.deleted_at)) {
            const markdown = get<{ markdown: string }>('select markdown from docs where node_id = ?', nodeId)?.markdown;
            if (markdown) snapshot(nodeId, markdown, user, 'web');
            run(`update nodes set deleted_at = datetime('now'), deleted_by = ?, trash_root = ? where id = ?`, user.id, id, nodeId);
            run('delete from search where node_id = ?', nodeId);
            run('delete from pins where node_id = ?', nodeId);
        }
    });
    return current;
}

export const trashed = (vaultId: number) =>
    all<{ id: number; name: string; kind: Kind; deleted_at: string; deleted_by: string | null; count: number }>(
        `select n.id, n.name, n.kind, n.deleted_at, u.name deleted_by,
            (select count(*) from nodes c where c.trash_root = n.id) count
         from nodes n left join users u on u.id = n.deleted_by
         where n.vault_id = ? and n.trash_root = n.id order by n.deleted_at desc`,
        vaultId,
    );

export function restore(id: number) {
    const root = node(id);
    if (!root || get<{ r: number }>('select trash_root r from nodes where id = ?', id)?.r !== id) throw new HttpError(404, 'Not in trash.');
    return tx(() => {
        // The original parent may itself be gone; fall back to the vault root.
        const parent = root.parent_id ? node(root.parent_id) : undefined;
        const parentId = parent && !parent.deleted_at ? parent.id : null;
        const name = freeName(root.vault_id, parentId, root.kind, root.name, id);
        for (const nodeId of all<{ id: number }>('select id from nodes where trash_root = ?', id).map(row => row.id)) {
            run('update nodes set deleted_at = null, deleted_by = null, trash_root = null where id = ?', nodeId);
            const markdown = get<{ markdown: string }>('select markdown from docs where node_id = ?', nodeId)?.markdown;
            if (markdown !== undefined) indexNote(nodeId, markdown);
        }
        run('update nodes set parent_id = ?, name = ? where id = ?', parentId, name, id);
        return node(id)!;
    });
}

export function purge(id: number) {
    if (get<{ r: number }>('select trash_root r from nodes where id = ?', id)?.r !== id) throw new HttpError(404, 'Not in trash.');
    tx(() => {
        // Notes trashed separately earlier stay in trash; detach them first so
        // the cascade does not take them along. They restore to the vault root.
        for (const nodeId of subtree(id)) {
            if (nodeId !== id && get<{ r: number }>('select trash_root r from nodes where id = ?', nodeId)?.r === nodeId) {
                run('update nodes set parent_id = null where id = ?', nodeId);
            }
        }
        run('delete from nodes where id = ?', id);
    });
}

// --- History ---------------------------------------------------------------

export function snapshot(id: number, markdown: string, user: User | null, source: 'web' | 'mcp' | 'restore' | 'import') {
    const last = get<{ markdown: string }>('select markdown from versions where node_id = ? order by id desc limit 1', id);
    if (last?.markdown === markdown) return;
    run('insert into versions (node_id, markdown, author_id, source) values (?, ?, ?, ?)', id, markdown, user?.id ?? null, source);
}

export const versions = (id: number) =>
    all<{ id: number; created_at: string; source: string; author: string | null; size: number }>(
        `select v.id, v.created_at, v.source, u.name author, length(v.markdown) size
         from versions v left join users u on u.id = v.author_id where v.node_id = ? order by v.id desc limit 200`,
        id,
    );

export const version = (noteId: number, id: number) =>
    get<{ markdown: string; created_at: string }>('select markdown, created_at from versions where node_id = ? and id = ?', noteId, id);

// Keep everything for 7 days, one per day to 90 days, then one per week.
// Trash is purged after 30 days.
export function prune() {
    run(`delete from versions where created_at < datetime('now', '-7 days') and id not in (
        select max(id) from versions where created_at < datetime('now', '-7 days')
        group by node_id, case when created_at >= datetime('now', '-90 days') then date(created_at) else strftime('%Y-%W', created_at) end)`);
    for (const { id } of all<{ id: number }>(`select id from nodes where trash_root = id and deleted_at < datetime('now', '-30 days')`)) {
        if (node(id)) purge(id);
    }
}

// --- Search, recent, pins --------------------------------------------------

export function search(user: User, query: string, vaultId?: number) {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8).map(term => `"${term.replace(/"/g, '""')}"*`).join(' ');
    if (!terms) return [];
    return all<{ id: number; vault_id: number; vault: string; name: string; parent_id: number | null; snippet: string }>(
        `select n.id, n.vault_id, v.name vault, n.name, n.parent_id, snippet(search, 1, '', '', '…', 12) snippet
         from search s join nodes n on n.id = s.node_id join vaults v on v.id = n.vault_id
         where search match ? and n.deleted_at is null and (? is null or n.vault_id = ?)
           and (v.owner_id = ? or v.public = 1 or exists (select 1 from members m where m.vault_id = v.id and m.user_id = ?))
         order by rank limit 50`,
        terms, vaultId ?? null, vaultId ?? null, user.id, user.id,
    );
}

export const visibleVaults = (user: User) =>
    all<{ id: number; name: string; owner_id: number; public: number; shared: number; notes: number }>(
        `select v.id, v.name, v.owner_id, v.public,
            (select count(*) from members m where m.vault_id = v.id) shared,
            (select count(*) from nodes n where n.vault_id = v.id and n.kind = 'note' and n.deleted_at is null) notes
         from vaults v where v.owner_id = ? or v.public = 1 or exists (select 1 from members m where m.vault_id = v.id and m.user_id = ?)
         order by v.name collate nocase`,
        user.id, user.id,
    );

export const recent = (user: User) =>
    all<{ id: number; vault_id: number; vault: string; name: string; updated_at: string }>(
        `select n.id, n.vault_id, v.name vault, n.name, n.updated_at from nodes n join vaults v on v.id = n.vault_id
         where n.kind = 'note' and n.deleted_at is null
           and (v.owner_id = ? or v.public = 1 or exists (select 1 from members m where m.vault_id = v.id and m.user_id = ?))
         order by n.updated_at desc limit 6`,
        user.id, user.id,
    );

export const pins = (user: User, vaultId?: number) =>
    all<{ id: number; vault_id: number; vault: string; name: string }>(
        `select n.id, n.vault_id, v.name vault, n.name from pins p join nodes n on n.id = p.node_id join vaults v on v.id = n.vault_id
         where p.user_id = ? and n.deleted_at is null and (? is null or n.vault_id = ?)
           and (v.owner_id = ? or v.public = 1 or exists (select 1 from members m where m.vault_id = v.id and m.user_id = ?))
         order by n.name collate nocase`,
        user.id, vaultId ?? null, vaultId ?? null, user.id, user.id,
    );

// The vault's main note shares its name and sits at the root.
export const mainNote = (vaultId: number) =>
    get<{ id: number }>(
        `select n.id from nodes n join vaults v on v.id = n.vault_id
         where n.vault_id = ? and n.parent_id is null and n.kind = 'note' and n.deleted_at is null and n.name = v.name collate nocase`,
        vaultId,
    )?.id ?? null;
