// Named MCP actions dispatch to the same permission-checked handlers as the browser.
// The caller supplies an authenticated user, never a client-specified identity or URL.
import { diffLines } from 'diff';
import { edit, hocuspocus } from './sync.ts';
import { z } from 'zod';
import type { User } from './auth.ts';
import { assertAccess } from './auth.ts';
import { api } from './api.ts';
import { HttpError, get } from './db.ts';
import * as notes from './notes.ts';
import { generateHTML } from '@tiptap/html/server';
import { extensions, markdown } from '../shared/schema.ts';
import type { JSONContent } from '@tiptap/core';

type Register = <S extends z.ZodRawShape>(name: string, description: string, input: S, write: boolean,
    run: (args: z.infer<z.ZodObject<S>>) => unknown) => unknown;
export const destructiveTools = new Set(['update', 'edit_selection', 'delete', 'delete_vault', 'leave_vault', 'remove_member',
    'set_sharing', 'restore_version', 'purge_item', 'rename_item', 'move', 'rename_vault', 'rename_profile']);

const id = z.number().int().positive().safe();
const name = z.string().trim().min(1).max(255);
const vault = { vaultId: id };
const item = { ...vault, nodeId: id };
const version = { ...item, versionId: id };
const vaultPath = (a: { vaultId: number }) => '/vaults/' + a.vaultId;
const nodePath = (a: { vaultId: number; nodeId: number }) => vaultPath(a) + '/nodes/' + a.nodeId;
const versionPath = (a: { vaultId: number; nodeId: number; versionId: number }) => nodePath(a) + '/versions/' + a.versionId;
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Expected standard base64.').refine(value => value.length % 4 === 0, 'Invalid base64 length.');

function textOf(node: JSONContent): string {
    return node.text ?? node.content?.map(textOf).join('') ?? '';
}

function upload(filename: string, data: string) {
    const form = new FormData();
    form.set('file', new Blob([Uint8Array.from(Buffer.from(data, 'base64'))]), filename);
    return form;
}

export function registerUiTools(user: User, tool: Register) {
    const origin = process.env.APP_URL ?? 'http://localhost:3000';
    // Private dispatcher: share HTTP error handling without opening a listener.
    async function request(path: string, method = 'GET', body?: unknown) {
        const form = body instanceof FormData;
        const response = await api.request(path, {
            method,
            headers: body !== undefined && !form ? { 'content-type': 'application/json' } : undefined,
            body: form ? body : JSON.stringify(body),
        }, { authenticatedUser: user });
        if (!response.ok) {
            const message = await response.json().catch(() => ({})) as { error?: string };
            throw new HttpError(response.status as HttpError['status'], message.error ?? 'Docs request failed.');
        }
        if (response.status === 204) return { ok: true };
        const mime = response.headers.get('content-type') ?? '';
        if (mime.startsWith('application/json')) return response.json();
        return { mime, base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
    }

    tool('home', 'List your vaults with note counts, pinned notes and recent notes.', {}, false, () => request('/home'));
    tool('rename_profile', 'Change your Docs display name.', { name }, true, a => request('/me', 'PATCH', { name: a.name }));
    tool('create_vault', 'Create a private vault and its main note.', { name }, true, a => request('/vaults', 'POST', a));
    tool('open_vault', 'Switch to a vault: get its main note, sidebar tree (including folders and files), pins and browser URL.', vault, false,
        async a => ({ ...await request(vaultPath(a) + '?open'), url: new URL(vaultPath(a), origin).href }));
    tool('rename_vault', 'Rename a vault.', { ...vault, name }, true, a => request(vaultPath(a), 'PATCH', { name: a.name }));

    function owned(a: { vaultId: number }) {
        assertAccess(user, a.vaultId);
        return !!get('select 1 from vaults where id = ? and owner_id = ?', a.vaultId, user.id);
    }
    tool('delete_vault', 'Permanently delete a vault you own and all its contents.', vault, true, a => {
        if (!owned(a)) throw new HttpError(403, 'Only the owner can delete this vault.');
        return request(vaultPath(a), 'DELETE');
    });
    tool('leave_vault', 'Leave a vault shared with you.', vault, true, a => {
        if (owned(a)) throw new HttpError(409, 'The owner cannot leave their vault.');
        return request(vaultPath(a), 'DELETE');
    });
    tool('list_members', 'List vault members and its owner.', vault, false, a => request(vaultPath(a) + '/members'));
    tool('find_people', 'Find signed-in people to add to a vault by name or email.', { ...vault, query: z.string().max(255) }, false,
        a => request(vaultPath(a) + '/people?q=' + encodeURIComponent(a.query)));
    tool('add_member', 'Share a vault with an existing Docs account by email.', { ...vault, email: z.string().email() }, true,
        a => request(vaultPath(a) + '/members', 'POST', { email: a.email }));
    tool('remove_member', 'Remove a member from a vault.', { ...vault, userId: id }, true, a => request(vaultPath(a) + '/members/' + a.userId, 'DELETE'));

    async function sharing(vaultId: number, settings?: { public?: boolean; link?: boolean }) {
        const result = await request(vaultPath({ vaultId }) + '/share', settings ? 'PATCH' : 'GET', settings);
        return { ...result, url: result.share_token ? new URL('/share/' + result.share_token, origin).href : null };
    }
    tool('get_sharing', 'Get vault visibility and its active read-only link.', vault, false, a => sharing(a.vaultId));
    tool('set_sharing', 'Change vault sharing. public controls access for signed-in users. link enables or revokes the anonymous read-only link. Omitted settings stay unchanged.',
        { ...vault, public: z.boolean().optional(), link: z.boolean().optional() }, true, a => sharing(a.vaultId, { public: a.public, link: a.link }));
    tool('create_folder', 'Create a folder at the root or under another note or folder.', { ...vault, name, parentId: id.nullish() }, true,
        a => request(vaultPath(a) + '/nodes', 'POST', { name: a.name, kind: 'folder', parent_id: a.parentId }));
    // Keep the original noteId argument for clients that predate folder and file support.
    function itemPath(noteId: number) {
        const node = notes.liveNode(noteId);
        return nodePath({ vaultId: node.vault_id, nodeId: node.id });
    }
    tool('read', 'Read a note as Markdown, or inspect a folder or file. Includes path, kind, backlinks and pin state.', { noteId: id }, false, async a => {
        const { markdown, ...metadata } = await request(itemPath(a.noteId));
        return { ...metadata, content: markdown };
    });
    tool('rename_item', 'Rename a note, folder or attachment and update affected links.', { ...item, name }, true, a => request(nodePath(a), 'PATCH', { name: a.name }));
    tool('move', 'Move a note, folder or attachment and its descendants within the vault. Set parentId to null for the vault root.',
        { noteId: id, parentId: id.nullable() }, true, a => request(itemPath(a.noteId), 'PATCH', { parent_id: a.parentId }));
    tool('delete', 'Move a note, folder or attachment and its descendants to recoverable trash.', { noteId: id }, true, async a => {
        await request(itemPath(a.noteId), 'DELETE');
        return { id: a.noteId, trashed: true };
    });
    tool('set_pin', 'Pin or unpin an item for your account.', { ...item, pinned: z.boolean() }, true, a => request(nodePath(a) + '/pin', a.pinned ? 'PUT' : 'DELETE'));
    tool('list_versions', 'List note history.', item, false, a => request(nodePath(a) + '/versions'));
    tool('read_version', 'Read a historical version for comparison.', version, false, a => request(versionPath(a)));
    tool('restore_version', 'Restore a historical version to the live note.', version, true, a => request(versionPath(a) + '/restore', 'POST'));
    tool('list_trash', 'List items in a vault’s trash.', vault, false, a => request(vaultPath(a) + '/trash'));
    tool('restore_item', 'Restore a trashed item and its descendants.', item, true, a => request(vaultPath(a) + '/trash/' + a.nodeId, 'POST'));
    tool('purge_item', 'Permanently delete a trashed item and its descendants.', item, true, a => request(vaultPath(a) + '/trash/' + a.nodeId, 'DELETE'));
    tool('upload_file', 'Upload an attachment using base64 bytes. Use the returned src in the note’s Markdown.', { ...item, filename: name, base64 }, true,
        a => request(nodePath(a) + '/files', 'POST', upload(a.filename, a.base64)));
    tool('download_file', 'Read an attachment as base64. Paths can be vault-absolute or relative to a note.', { ...vault, path: z.string().min(1), fromId: id.optional() }, false,
        a => request(vaultPath(a) + '/files?path=' + encodeURIComponent(a.path) + (a.fromId ? '&from=' + a.fromId : '')));
    tool('export_vault', 'Export a vault as a ZIP archive of Markdown and attachments, returned as base64.', vault, false, a => request(vaultPath(a) + '/export'));
    tool('import_vault', 'Import a base64 ZIP as a new vault. The .zip filename supplies its name.', { filename: name, base64 }, true,
        a => request('/import', 'POST', upload(a.filename, a.base64)));

    function source(noteId: number) {
        const n = notes.liveNode(noteId);
        assertAccess(user, n.vault_id);
        if (n.kind !== 'note') throw new HttpError(404);
        return notes.markdownOf(noteId);
    }
    tool('edit_selection', 'Edit or format a unique passage using Markdown, including links, images, tables, tasks, code and diagrams. Fails if the original text changed or is ambiguous.',
        { noteId: id, original: z.string().min(1).max(1_000_000), replacement: z.string().max(1_000_000) }, true, async a => {
            const note = notes.liveNode(a.noteId);
            assertAccess(user, note.vault_id);
            if (note.kind !== 'note') throw new HttpError(404);
            await edit(note.id, user, 'mcp', current => {
                const start = current.indexOf(a.original);
                if (start < 0 || start !== current.lastIndexOf(a.original)) throw new HttpError(409, 'Choose a passage that occurs exactly once in the current Markdown.');
                return current.slice(0, start) + a.replacement + current.slice(start + a.original.length);
            });
            return { id: note.id, updated: true };
        });
    tool('code_blocks', 'Read the exact source and language of code, Mermaid, Archify and HTML blocks in document order.', { noteId: id }, false, a => {
        const blocks: { language: string | null; source: string }[] = [];
        const visit = (node: JSONContent) => {
            if (node.type === 'codeBlock') blocks.push({ language: node.attrs?.language ?? null, source: textOf(node) });
            else node.content?.forEach(visit);
        };
        visit(markdown.parse(source(a.noteId)));
        return blocks;
    });
    tool('compare_version', 'Compare a historical version with the current Markdown, line by line.', version, false, async a => {
        const previous = await request(versionPath(a));
        return diffLines(previous.markdown, source(a.nodeId));
    });
    tool('note_presence', 'List signed-in collaborators connected to an open note.', { noteId: id }, false, a => {
        const found = notes.liveNode(a.noteId);
        assertAccess(user, found.vault_id);
        const doc = hocuspocus.documents.get('note:' + a.noteId);
        const people = new Map<number, string>();
        for (const connection of doc?.getConnections() ?? []) {
            const person = connection.context.user as User;
            people.set(person.id, person.name);
        }
        return Array.from(people, ([id, name]) => ({ id, name }));
    });
    tool('view_link', 'Open a vault or note in the browser with optional theme, reading mode, or sidebar settings for that view.', {
        ...vault, noteId: id.optional(), theme: z.enum(['light', 'dark']).optional(),
        mode: z.enum(['read', 'edit']).optional(), sidebar: z.enum(['open', 'closed']).optional(),
    }, false, a => {
        assertAccess(user, a.vaultId);
        if (a.noteId) notes.liveNode(a.noteId, a.vaultId);
        const url = new URL(vaultPath(a), origin);
        if (a.noteId) url.searchParams.set('file', String(a.noteId));
        for (const key of ['theme', 'mode', 'sidebar'] as const) if (a[key]) url.searchParams.set(key, a[key]);
        return { url: url.href };
    });
    tool('preview_note', 'Render a note as read-only HTML.', { noteId: id }, false,
        a => ({ html: generateHTML(markdown.parse(source(a.noteId)), extensions) }));
    tool('note_contents', 'List the headings shown in the note’s table of contents, in reading order.', { noteId: id }, false, a => {
        const headings: { level: number; text: string }[] = [];
        const visit = (node: JSONContent) => {
            if (node.type === 'heading' && node.attrs?.level <= 3) headings.push({ level: node.attrs!.level, text: textOf(node) });
            else node.content?.forEach(visit);
        };
        visit(markdown.parse(source(a.noteId)));
        return headings;
    });
    tool('find_in_note', 'Find literal text in Markdown, case-insensitively. Returns matching line numbers and text, paginated.', {
        noteId: id, query: z.string().min(1).max(200), page: id.default(1),
    }, false, a => {
        const query = a.query.toLowerCase();
        const matches = source(a.noteId).split('\n').flatMap((text, i) => text.toLowerCase().includes(query) ? [{ line: i + 1, text }] : []);
        return { data: matches.slice((a.page - 1) * 50, a.page * 50), next: matches.length > a.page * 50 ? a.page + 1 : null };
    });
}
