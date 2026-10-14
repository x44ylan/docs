// SQLite is the source of truth. Markdown files under /data/files are a
// readable mirror written by the app; they are never read back.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export const dataDir = process.env.DOCS_DATA ?? '/data';
export const filesDir = join(dataDir, 'files');
export const blobsDir = join(dataDir, 'blobs');
mkdirSync(filesDir, { recursive: true });
mkdirSync(blobsDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'db.sqlite'));
db.exec(`
pragma journal_mode = wal;
pragma synchronous = normal;
pragma foreign_keys = on;
pragma busy_timeout = 5000;

create table if not exists users (
    id integer primary key,
    email text not null unique collate nocase,
    name text not null,
    created_at text not null default (datetime('now'))
);
create table if not exists vaults (
    id integer primary key,
    name text not null,
    owner_id integer not null references users(id),
    public integer not null default 0,
    share_token text unique,
    created_at text not null default (datetime('now'))
);
create table if not exists members (
    vault_id integer not null references vaults(id) on delete cascade,
    user_id integer not null references users(id) on delete cascade,
    primary key (vault_id, user_id)
);
create table if not exists nodes (
    id integer primary key,
    vault_id integer not null references vaults(id) on delete cascade,
    parent_id integer references nodes(id) on delete cascade,
    name text not null,
    kind text not null check (kind in ('note', 'folder', 'file')),
    ext text,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    deleted_at text,
    deleted_by integer references users(id),
    trash_root integer
);
create index if not exists nodes_parent on nodes (vault_id, parent_id);
create table if not exists docs (
    node_id integer primary key references nodes(id) on delete cascade,
    markdown text not null default '',
    state blob,
    epoch text,
    editor_id integer references users(id)
);
create table if not exists versions (
    id integer primary key,
    node_id integer not null references nodes(id) on delete cascade,
    markdown text not null,
    author_id integer references users(id),
    source text not null check (source in ('web', 'mcp', 'restore', 'import')),
    created_at text not null default (datetime('now'))
);
create index if not exists versions_node on versions (node_id, created_at);
create table if not exists links (
    source_id integer not null references nodes(id) on delete cascade,
    target_id integer not null references nodes(id) on delete cascade,
    primary key (source_id, target_id)
);
create index if not exists links_target on links (target_id);
create table if not exists pins (
    user_id integer not null references users(id) on delete cascade,
    node_id integer not null references nodes(id) on delete cascade,
    created_at text not null default (datetime('now')),
    primary key (user_id, node_id)
);
create virtual table if not exists search using fts5 (name, body, node_id unindexed, tokenize = 'porter unicode61');
`);

const statements = new Map<string, StatementSync>();
const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) statements.set(sql, (statement = db.prepare(sql)));
    return statement;
};
export const all = <T>(sql: string, ...args: SQLInputValue[]) => prepare(sql).all(...args) as T[];
export const get = <T>(sql: string, ...args: SQLInputValue[]) => prepare(sql).get(...args) as T | undefined;
export const run = (sql: string, ...args: SQLInputValue[]) => prepare(sql).run(...args);

let depth = 0;
export function tx<T>(fn: () => T): T {
    if (depth) return fn();
    db.exec('begin immediate');
    depth++;
    try {
        const result = fn();
        db.exec('commit');
        return result;
    } catch (error) {
        db.exec('rollback');
        throw error;
    } finally {
        depth--;
    }
}

export class HttpError extends Error {
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503;
    constructor(status: HttpError['status'], message = 'Request failed.') {
        super(message);
        this.status = status;
    }
}
