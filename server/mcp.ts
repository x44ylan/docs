// MCP over Streamable HTTP at /mcp. Cloudflare Access (Managed OAuth) signs
// every request, so agents act as the same user with the same vault access.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { assertAccess, identify, type User } from './auth.ts';
import { HttpError } from './db.ts';
import * as notes from './notes.ts';
import { edit, treeChanged } from './sync.ts';

const id = z.number().int().min(1);
const page = z.number().int().min(1).max(100_000).default(1);
const text = z.string().max(1_000_000);
const pageOf = <T>(rows: T[], n: number) => ({ data: rows.slice((n - 1) * 50, n * 50), next: rows.length > n * 50 ? n + 1 : null });

function tools(user: User) {
    const server = new McpServer({ name: 'Docs', version: '2.0.0' });
    const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
    const note = (noteId: number) => {
        const found = notes.liveNode(noteId);
        if (found.kind !== 'note') throw new HttpError(404);
        assertAccess(user, found.vault_id);
        return found;
    };
    const tool = <S extends z.ZodRawShape>(name: string, description: string, input: S, write: boolean, run: (args: z.infer<z.ZodObject<S>>) => unknown) =>
        server.registerTool(name, {
            description,
            inputSchema: input,
            annotations: { readOnlyHint: !write, destructiveHint: ['update', 'delete'].includes(name), openWorldHint: false },
        }, (async (args: z.infer<z.ZodObject<S>>) => {
            try {
                return ok(await run(args));
            } catch (error) {
                const message = error instanceof HttpError && error.status !== 404 ? error.message : 'Document unavailable, request invalid, or access denied.';
                return { isError: true, content: [{ type: 'text' as const, text: message }] };
            }
        }) as never);

    tool('me', 'Show the signed-in Docs user. Browser and MCP share this account and its vault permissions.', {}, false, () => user);
    tool('vaults', 'List accessible vaults.', { page }, false, ({ page: n }) =>
        pageOf(notes.visibleVaults(user).map(({ id, name }) => ({ id, name })), n));
    tool('list', 'List Markdown documents in a vault, with parent_id for nesting.', { vaultId: id, page }, false, ({ vaultId, page: n }) => {
        assertAccess(user, vaultId);
        return pageOf(notes.tree(vaultId).filter(n => n.kind === 'note').map(({ id, vault_id, parent_id, name, updated_at }) => ({ id, vault_id, parent_id, name, updated_at })), n);
    });
    tool('search', 'Search accessible Markdown names and content.', { query: z.string().min(1).max(200), vaultId: id.optional(), page }, false,
        ({ query, vaultId, page: n }) => pageOf(notes.search(user, query, vaultId), n));
    tool('read', 'Read a Markdown document.', { noteId: id }, false, ({ noteId }) => {
        const found = note(noteId);
        return { id: found.id, vault_id: found.vault_id, parent_id: found.parent_id, name: found.name, path: notes.path(found.id), content: notes.markdownOf(found.id), updated_at: found.updated_at };
    });
    tool('create', 'Create a Markdown document in an accessible vault. parentId nests it under a note or folder.',
        { vaultId: id, parentId: id.optional(), name: z.string().min(1).max(255), content: text }, true, ({ vaultId, parentId, name, content }) => {
            assertAccess(user, vaultId);
            const created = notes.create(vaultId, parentId ?? null, 'note', name, content, user);
            treeChanged(vaultId);
            return created;
        });
    tool('update', 'Append (default), prepend or explicitly replace Markdown content. A version is saved first, and people editing the note see the change live.',
        { noteId: id, content: text, operation: z.enum(['append', 'prepend', 'replace']).default('append') }, true, async ({ noteId, content, operation }) => {
            const found = note(noteId);
            // Stored notes end with one newline; append joins after the text itself.
            const markdown = await edit(found.id, user, 'mcp', current =>
                operation === 'replace' ? content : operation === 'prepend' ? content + current : current.replace(/\n$/, '') + content);
            return { ...notes.node(found.id), content: markdown };
        });
    tool('move', 'Move a Markdown document and its sub-notes under a note or folder in the same vault. Set parentId to null for the vault root. Preserves IDs, attachments and links; duplicate names receive a suffix. Returns the new name and parent_id.',
        { noteId: id, parentId: id.nullable() }, true, async ({ noteId, parentId }) => {
            const found = note(noteId);
            const records = notes.captureLinks(found.id);
            notes.move(found.id, parentId);
            for (const [source, map] of notes.brokenLinks(records)) await edit(source, user, 'web', current => notes.replaceHrefs(current, map));
            notes.mirrorVault(found.vault_id);
            treeChanged(found.vault_id);
            return notes.node(found.id);
        });
    tool('delete', 'Move a document and its sub-notes to the vault trash. It can be restored from Docs for 30 days.', { noteId: id }, true, ({ noteId }) => {
        const found = note(noteId);
        notes.trash(found.id, user);
        notes.mirrorVault(found.vault_id);
        treeChanged(found.vault_id);
        return { id: found.id, trashed: true };
    });
    tool('backlinks', 'List documents that link to a document.', { noteId: id }, false, ({ noteId }) => notes.backlinks(note(noteId).id));
    return server;
}

export async function mcp(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin && origin !== process.env.APP_URL) return new Response('Forbidden', { status: 403 });
    let user: User;
    try {
        user = await identify(request.headers.get('cf-access-jwt-assertion'));
    } catch (error) {
        return new Response(error instanceof HttpError ? error.message : 'Forbidden', { status: error instanceof HttpError ? error.status : 403 });
    }
    // Stateless: one server per request, JSON responses, no session to leak.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await tools(user).connect(transport);
    return transport.handleRequest(request);
}
