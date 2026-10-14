// One-time import from the Laravel app. Keeps every ID so links, MCP note IDs
// and the share link keep working. Run against an empty DOCS_DATA:
//   DOCS_DATA=/data node server/migrate.ts <old database.sqlite> <old private dir>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { blob } from './api.ts';
import { all, get, run, tx } from './db.ts';
import { indexNote, markdownOf, mirrorVault, path, tree } from './notes.ts';

const [source, files] = process.argv.slice(2);
if (!source || !files) throw new Error('Usage: node server/migrate.ts <database.sqlite> <private dir>');
if (get('select 1 from nodes limit 1')) throw new Error('DOCS_DATA already has notes; migrate into an empty folder.');

const old = new DatabaseSync(source, { readOnly: true });
const rows = <T>(sql: string) => old.prepare(sql).all() as T[];
type OldNode = { id: number; vault_id: number; parent_id: number | null; is_file: number; name: string; extension: string | null; content: string | null; created_at: string; updated_at: string };

const vaults = rows<{ id: number; name: string; created_by: number; is_public: number; share_token: string | null; created_at: string }>('select * from vaults');
const nodes = rows<OldNode>('select * from vault_nodes order by id');
const byId = new Map(nodes.map(n => [n.id, n]));
// Old files live at private/vaults/<owner>/<vault>/<path>.
const diskPath = (n: OldNode) => {
    const parts: string[] = [];
    for (let c: OldNode | undefined = n; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) parts.unshift(c === n && c.extension ? `${c.name}.${c.extension}` : c.name);
    const vault = vaults.find(v => v.id === n.vault_id)!;
    return join(files, 'vaults', String(vault.created_by), vault.name, ...parts);
};

tx(() => {
    for (const u of rows<{ id: number; name: string; email: string; created_at: string }>('select id, name, email, created_at from users')) {
        run('insert into users (id, email, name, created_at) values (?, ?, ?, ?)', u.id, u.email.toLowerCase(), u.name, u.created_at);
    }
    for (const v of vaults) {
        run('insert into vaults (id, name, owner_id, public, share_token, created_at) values (?, ?, ?, ?, ?, ?)', v.id, v.name, v.created_by, v.is_public, v.share_token, v.created_at);
    }
    for (const m of rows<{ user_id: number; vault_id: number }>('select user_id, vault_id from user_vault where accepted = 1')) {
        run('insert or ignore into members (vault_id, user_id) values (?, ?)', m.vault_id, m.user_id);
    }
    // Parents before children.
    const inserted = new Set<number>();
    const insert = (n: OldNode) => {
        if (inserted.has(n.id)) return;
        if (n.parent_id) insert(byId.get(n.parent_id)!);
        const kind = !n.is_file ? 'folder' : n.extension === 'md' ? 'note' : 'file';
        run('insert into nodes (id, vault_id, parent_id, name, kind, ext, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
            n.id, n.vault_id, n.parent_id, n.name, kind, kind === 'file' ? n.extension : null, n.created_at, n.updated_at);
        if (kind === 'note') {
            run('insert into docs (node_id, markdown) values (?, ?)', n.id, n.content ?? '');
            run(`insert into versions (node_id, markdown, source, created_at) values (?, ?, 'import', datetime('now'))`, n.id, n.content ?? '');
        }
        if (kind === 'file') {
            const at = diskPath(n);
            if (!existsSync(at)) throw new Error(`Missing attachment ${at}`);
            writeFileSync(blob(n.id), readFileSync(at));
        }
        inserted.add(n.id);
    };
    nodes.forEach(insert);
    for (const n of all<{ id: number }>(`select id from nodes where kind = 'note'`)) indexNote(n.id, markdownOf(n.id));
});
for (const v of vaults) mirrorVault(v.id);

// Report: everything below must match the old app before cutover.
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const notes = nodes.filter(n => n.is_file && n.extension === 'md');
const mismatched = notes.filter(n => sha(markdownOf(n.id)) !== sha(n.content ?? '') || sha(readFileSync(join(process.env.DOCS_DATA ?? '/data', 'files', String(n.vault_id), path(n.id)), 'utf8')) !== sha(n.content ?? ''));
const oldLinks = (old.prepare('select count(*) n from vault_node_vault_node').get() as { n: number }).n;
const report = {
    users: get<{ n: number }>('select count(*) n from users')!.n,
    vaults: vaults.map(v => ({ id: v.id, name: v.name, nodes: tree(v.id).length, share: !!v.share_token })),
    nodes: { old: nodes.length, new: get<{ n: number }>('select count(*) n from nodes')!.n },
    notes: { old: notes.length, mismatched: mismatched.map(n => n.id) },
    links: { old: oldLinks, new: get<{ n: number }>('select count(*) n from links')!.n },
    members: get<{ n: number }>('select count(*) n from members')!.n,
};
console.log(JSON.stringify(report, null, 2));
if (mismatched.length || report.nodes.old !== report.nodes.new) process.exit(1);
