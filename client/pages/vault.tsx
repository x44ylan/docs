// One vault, one page: switching notes swaps the editor without reloading.
// Header: [home][tree] Vault / Parent / Note ··· toolbar ··· [actions][more] | [search][account]
import { IconCopy, IconDots, IconEye, IconFilePlus, IconFileSearch, IconHistory, IconHome, IconLayoutSidebar, IconLink, IconListDetails, IconMoon, IconPencil, IconPin, IconPinnedOff, IconSearch, IconShare, IconSun, IconTrash, IconX } from '@tabler/icons-react';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { markdown } from '../../shared/schema.ts';
import { api, cache, cached, type Note, type TreeNode, type User, type Vault } from '../api.ts';
import { type Crumb, FormatIcon, Header, OfflineDot, UserMenu } from '../components/header.tsx';
import { Palette } from '../components/palette.tsx';
import { Contents, FindBar, headingsOf, HistoryDialog, ShareDialog, TrashDialog } from '../components/panels.tsx';
import { Sidebar } from '../components/sidebar.tsx';
import { Toolbar } from '../components/toolbar.tsx';
import { refreshAnchors } from '../editor/extensions.ts';
import { NoteView, type Presence } from '../editor/note.tsx';
import { watchVault } from '../editor/sync.ts';
import { ancestors, buildTree, isInside, pathOf, resolve } from '../tree.ts';
import { title, useTheme } from '../theme.ts';
import { Button, cn, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from '../ui.tsx';

const useWide = () => {
    const query = '(min-width: 1024px)';
    const [wide, setWide] = useState(() => matchMedia(query).matches);
    useEffect(() => {
        const media = matchMedia(query);
        const update = () => setWide(media.matches);
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return wide;
};

// Recently opened or warmed notes, so switching paints at once instead of
// waiting a round trip through Cloudflare (about 150-500 ms).
const recent = new Map<number, Note>();
const remember = (note: Note) => {
    recent.delete(note.id);
    recent.set(note.id, note);
    while (recent.size > 48) recent.delete(recent.keys().next().value!);
};
const warming = new Set<number>();
// Fetch a note ahead of the click (hover, touch, or a sub-note of the open note).
const warm = (vaultId: number, id: number) => {
    if (recent.has(id) || warming.has(id)) return;
    warming.add(id);
    void api<Note>(`/vaults/${vaultId}/nodes/${id}`, { quiet: true }).then(remember, () => undefined).finally(() => warming.delete(id));
};

export function VaultPage() {
    const vaultId = Number(useParams().vault);
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const wide = useWide();
    const { dark, toggle: toggleTheme } = useTheme();
    const [vault, setVault] = useState<Vault | undefined>(() => cached(`vault:${vaultId}`));
    const [user, setUser] = useState<User | undefined>(() => cached('user'));
    const [note, setNote] = useState<Note>();
    const [editor, setEditor] = useState<Editor | null>(null);
    const [people, setPeople] = useState<Presence>([]);
    const [online, setOnline] = useState(true);
    // The socket notices a dead network only after a timeout; the browser
    // reports it at once.
    const [network, setNetwork] = useState(() => navigator.onLine);
    useEffect(() => {
        const update = () => setNetwork(navigator.onLine);
        addEventListener('online', update);
        addEventListener('offline', update);
        return () => { removeEventListener('online', update); removeEventListener('offline', update); };
    }, []);
    const [editing, setEditing] = useState(() => localStorage.getItem('mode') !== 'read');
    const [sidebar, setSidebar] = useState(() => matchMedia('(min-width: 1024px)').matches);
    const [tools, setTools] = useState(false);
    const [finding, setFinding] = useState(false);
    const [panel, setPanel] = useState<'share' | 'history' | 'trash' | 'palette' | null>(null);
    const [naming, setNaming] = useState<{ title: string; value: string; submit: (name: string) => Promise<void> } | null>(null);
    const [, refreshHeadings] = useState(0);
    const main = useRef<HTMLElement>(null);

    const fileId = Number(params.get('file')) || null;
    const firstLoad = useRef(true);
    const fresh = useRef<number | null>(null);
    const tree = useMemo(() => buildTree(vault?.nodes ?? []), [vault]);

    const loadVault = useCallback(async () => {
        const next = await api<Vault & { open?: Note; user: User }>(`/vaults/${vaultId}${firstLoad.current && !fileId ? '?open' : ''}`);
        firstLoad.current = false;
        if (next.open) { remember(next.open); fresh.current = next.open.id; }
        setUser(current => (current?.id === next.user.id && current.name === next.user.name ? current : next.user));
        cache('user', next.user);
        setVault(next);
        cache(`vault:${vaultId}`, next);
        return next;
    }, [vaultId]);

    useEffect(() => {
        void loadVault().then(next => {
            if (!fileId && next.main) setParams({ file: String(next.main) }, { replace: true });
        }).catch(() => navigate('/', { replace: true }));
        return watchVault(vaultId, () => void loadVault());
    }, [vaultId]);

    // Open the selected note. Recently opened notes paint from memory at once;
    // the API response then refreshes metadata (the live editor syncs content).
    useEffect(() => {
        if (!fileId) return setNote(undefined);
        let alive = true;
        const hit = recent.get(fileId);
        if (hit) { setNote(hit); main.current?.scrollTo(0, 0); }
        // Fresh from the vault response (`?open`): no second request.
        if (hit && fresh.current === fileId) { fresh.current = null; return; }
        void api<Note>(`/vaults/${vaultId}/nodes/${fileId}`, { quiet: true })
            .then(next => {
                remember(next);
                if (!alive) return;
                if (hit) setNote(current => (current?.id === next.id ? { ...next, markdown: current.markdown } : current));
                else { setNote(next); main.current?.scrollTo(0, 0); }
            })
            .catch(() => alive && setParams({}, { replace: true }));
        return () => { alive = false; };
    }, [vaultId, fileId]);
    // Warm the open note's sub-notes (what tables and lists usually link to).
    useEffect(() => {
        if (!note) return;
        const timer = setTimeout(() => {
            for (const child of (tree.children.get(note.id) ?? []).filter(n => n.kind === 'note').slice(0, 24)) warm(vaultId, child.id);
        }, 300);
        return () => clearTimeout(timer);
    }, [note?.id, tree]);
    useEffect(() => {
        const current = note && tree.nodes.get(note.id);
        if (note && current && current.name !== note.name) setNote({ ...note, name: current.name, path: pathOf(tree, note.id) });
        if (note && vault && !current) setParams({}, { replace: true });
    }, [tree]);
    useEffect(() => { title(note?.name ?? vault?.name); }, [note?.name, vault?.name]);
    // Re-check vault links when the tree changes (a note was moved or deleted).
    useEffect(() => { if (editor && !editor.isDestroyed) refreshAnchors(editor); }, [tree, editor]);
    useEffect(() => {
        if (!editor) return;
        const update = () => refreshHeadings(n => n + 1);
        editor.on('update', update);
        return () => { editor.off('update', update); };
    }, [editor]);

    const open = (node: TreeNode | number) => {
        const id = typeof node === 'number' ? node : node.id;
        setTools(false);
        setFinding(false);
        if (!wide) setSidebar(false);
        setParams({ file: String(id) });
    };

    // Vault links open inside the SPA; `#heading` scrolls.
    const openLink = (href: string) => {
        if (href.startsWith('#')) { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' }); return true; }
        if (!note) return false;
        const target = resolve(tree, note.id, href);
        if (!target) return /^[a-z][a-z0-9+.-]*:/i.test(href) ? false : (toast.error('That note no longer exists.'), true);
        if (target.kind === 'file') { window.open(fileUrl(href), '_blank', 'noopener'); return true; }
        open(target);
        const hash = href.split('#')[1];
        if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 400);
        return true;
    };
    const fileUrl = (href: string) => `/api/vaults/${vaultId}/files?from=${note?.id ?? ''}&path=${encodeURIComponent(href)}`;
    // Only vault-relative `.md` links can be broken; web links are not checked.
    const linkExists = (href: string) =>
        note && !/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href) && /\.md(#|$)/i.test(href) ? !!resolve(tree, note.id, href) : undefined;
    const noteLinks = (query: string) => {
        const q = query.toLowerCase();
        return [...tree.nodes.values()]
            .filter(n => n.kind === 'note' && n.id !== note?.id && n.name.toLowerCase().includes(q))
            .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
            .map(n => ({ id: n.id, name: n.name, path: pathOf(tree, n.id), href: pathOf(tree, n.id) }));
    };

    const setMode = (edit: boolean) => {
        setEditing(edit);
        localStorage.setItem('mode', edit ? 'edit' : 'read');
        if (!edit) setTools(false);
    };

    const create = (parentId: number | null, kind: 'note' | 'folder') =>
        setNaming({
            title: kind === 'note' ? 'New note' : 'New folder',
            value: '',
            submit: async name => {
                const created = await api<TreeNode>(`/vaults/${vaultId}/nodes`, { body: { name, parent_id: parentId, kind } });
                await loadVault();
                if (kind === 'note') open(created);
            },
        });
    const rename = (node: TreeNode) =>
        setNaming({ title: 'Rename', value: node.name, submit: async name => { await api(`/vaults/${vaultId}/nodes/${node.id}`, { method: 'PATCH', body: { name } }); await loadVault(); } });
    const remove = async (node: TreeNode) => {
        await api(`/vaults/${vaultId}/nodes/${node.id}`, { method: 'DELETE' });
        // Close the open note only if it was the deleted note or inside it.
        if (note && isInside(tree, note.id, node.id)) setParams({});
        await loadVault();
        toast('Moved to trash', { action: { label: 'Undo', onClick: async () => { await api(`/vaults/${vaultId}/trash/${node.id}`, { method: 'POST' }); await loadVault(); } } });
    };
    const move = async (node: TreeNode, parentId: number | null) => {
        if (node.parent_id === parentId) return;
        await api(`/vaults/${vaultId}/nodes/${node.id}`, { method: 'PATCH', body: { parent_id: parentId } });
        await loadVault();
    };
    const pin = async (node: TreeNode, on: boolean) => {
        await api(`/vaults/${vaultId}/nodes/${node.id}/pin`, { method: on ? 'PUT' : 'DELETE' });
        if (note?.id === node.id) setNote({ ...note, pinned: on });
        await loadVault();
    };
    const copyMarkdown = async () => {
        if (!editor) return;
        await navigator.clipboard.writeText(markdown.serialize(editor.getJSON()));
        toast.success('Copied as Markdown');
    };

    // Shortcuts: Cmd/Ctrl+K search, Cmd/Ctrl+F find in note.
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey)) return;
            if (event.key.toLowerCase() === 'k') { event.preventDefault(); setPanel('palette'); }
            if (event.key.toLowerCase() === 'f' && note) { event.preventDefault(); setFinding(true); }
        };
        addEventListener('keydown', key);
        return () => removeEventListener('keydown', key);
    }, [note]);

    const headings = headingsOf(editor);
    // Vault / Parent / Note: the vault opens its main note, notes open, folders don't.
    const crumbs: Crumb[] = !vault ? [] : !note || note.id === vault.main
        ? [{ label: note?.name ?? vault.name }]
        : [
            { label: vault.name, onClick: vault.main ? () => open(vault.main!) : undefined },
            ...ancestors(tree, note.id).slice(0, -1).filter(n => n.id !== vault.main).map(n => ({ label: n.name, onClick: n.kind === 'note' ? () => open(n.id) : undefined })),
            { label: note.name },
        ];
    const compactTools = !wide && tools && editing;

    // Page actions, most used first. Everything else lives in the More menu.
    const actions = note && (
        <>
            {!!people.length && (
                <div className="mr-1 hidden -space-x-1.5 sm:flex" aria-label={`Also here: ${people.map(p => p.name).join(', ')}`}>
                    {people.slice(0, 3).map(p => (
                        <span key={p.id} title={p.name} style={{ background: p.color }} className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-background">{p.name[0]?.toUpperCase()}</span>
                    ))}
                </div>
            )}
            {(!online || !network) && <OfflineDot />}
            {!wide && editing && <IconButton label="Formatting" onClick={() => setTools(true)}><FormatIcon /></IconButton>}
            <IconButton label={editing ? 'Read' : 'Edit'} onClick={() => setMode(!editing)}>{editing ? <IconEye /> : <IconPencil />}</IconButton>
            {wide && headings.length >= 2 && (
                <Popover>
                    <PopoverTrigger asChild><IconButton label="Contents"><IconListDetails /></IconButton></PopoverTrigger>
                    <PopoverContent><Contents headings={headings} onJump={id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /></PopoverContent>
                </Popover>
            )}
            <Menu>
                <MenuTrigger asChild><IconButton label="More"><IconDots /></IconButton></MenuTrigger>
                <MenuContent className="w-56">
                    <MenuItem onSelect={() => setPanel('palette')}><IconSearch />Search notes</MenuItem>
                    <MenuItem onSelect={() => setFinding(true)}><IconFileSearch />Find in note</MenuItem>
                    {!wide && headings.length >= 2 && (
                        <Popover>
                            <PopoverTrigger asChild><MenuItem onSelect={event => event.preventDefault()}><IconListDetails />Contents</MenuItem></PopoverTrigger>
                            <PopoverContent side="left"><Contents headings={headings} onJump={id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /></PopoverContent>
                        </Popover>
                    )}
                    <MenuItem onSelect={() => void pin(note, !note.pinned)}>{note.pinned ? <IconPinnedOff /> : <IconPin />}{note.pinned ? 'Unpin' : 'Pin'}</MenuItem>
                    <MenuItem onSelect={() => setPanel('history')}><IconHistory />History</MenuItem>
                    <MenuSeparator />
                    <MenuItem onSelect={() => void copyMarkdown()}><IconCopy />Copy as Markdown</MenuItem>
                    <MenuItem onSelect={async () => { await navigator.clipboard.writeText(`${location.origin}/vaults/${vaultId}?file=${note.id}`); toast.success('Link copied'); }}><IconLink />Copy link</MenuItem>
                    <MenuItem onSelect={() => create(note.id, 'note')}><IconFilePlus />New sub-note</MenuItem>
                    {!!note.backlinks.length && (
                        <>
                            <MenuSeparator />
                            <div className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground">Linked from</div>
                            {note.backlinks.map(link => <MenuItem key={link.id} onSelect={() => open(link.id)}><IconLink />{link.name}</MenuItem>)}
                        </>
                    )}
                    <MenuSeparator />
                    <MenuItem destructive onSelect={() => void remove(note)}><IconTrash />Delete</MenuItem>
                </MenuContent>
            </Menu>
        </>
    );
    // Find and the phone formatting strip take over the whole bar, with a
    // close button in the same place as the account button.
    const replace = finding
        ? <FindBar editor={editor} onClose={() => setFinding(false)} />
        : compactTools
            ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                    <div className="min-w-0 flex-1"><Toolbar editor={editor} bare /></div>
                    <IconButton label="Close formatting" onClick={() => setTools(false)}><IconX /></IconButton>
                </div>
            )
            : undefined;

    return (
        <div className="flex h-dvh flex-col">
            <Header
                // On phones the title opens the notes tree, so the toggle hides.
                lead={<IconButton label="Toggle notes" aria-expanded={sidebar} className="max-sm:hidden" onClick={() => setSidebar(s => !s)}><IconLayoutSidebar /></IconButton>}
                crumbs={crumbs}
                onTitle={wide ? undefined : () => setSidebar(s => !s)}
                center={wide && note && editing ? <Toolbar editor={editor} /> : undefined}
                actions={actions}
                account={<UserMenu user={user} onRenamed={name => user && setUser({ ...user, name })} />}
                replace={replace}
            />
            <div className="relative flex min-h-0 flex-1">
                {!wide && sidebar && <div className="fixed inset-0 z-20 bg-background/60" onClick={() => setSidebar(false)} />}
                <aside
                    aria-hidden={!sidebar}
                    inert={!sidebar}
                    className={cn(
                        'z-30 shrink-0 border-r bg-popover transition-[transform,width] duration-200 print:hidden',
                        wide ? (sidebar ? 'w-60' : 'w-0 overflow-hidden border-r-0') : cn('absolute inset-y-0 left-0 w-[80%] max-w-[300px]', sidebar ? 'translate-x-0' : '-translate-x-full'),
                    )}
                >
                    {vault && (
                        <Sidebar
                            name={vault.name}
                            tree={tree}
                            pins={vault.pins}
                            selected={note?.id ?? null}
                            main={vault.main}
                            actions={{ open, warm: node => node.kind === 'note' && warm(vaultId, node.id), create, rename, remove: node => void remove(node), move: (node, parent) => void move(node, parent), pin: (node, on) => void pin(node, on), share: () => setPanel('share'), trash: () => setPanel('trash') }}
                        />
                    )}
                </aside>
                <main ref={main} className="min-w-0 flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-[46rem] px-4 pt-6 sm:px-8 sm:pt-10">
                        {note && user ? (
                            <NoteView
                                key={note.id}
                                note={note}
                                user={user}
                                editable={editing}
                                links={noteLinks}
                                file={fileUrl}
                                openLink={openLink}
                                linkExists={linkExists}
                                onEditor={setEditor}
                                onPresence={setPeople}
                                onStatus={setOnline}
                            />
                        ) : vault && !fileId && (
                            <div className="flex h-[60dvh] flex-col items-center justify-center gap-4">
                                <p className="text-sm text-muted-foreground">Select a note</p>
                                <Button variant="outline" onClick={() => create(null, 'note')}><IconFilePlus />New note</Button>
                            </div>
                        )}
                    </div>
                </main>
            </div>
            <Dialog open={!!naming} onOpenChange={value => !value && setNaming(null)} title={naming?.title ?? ''}>
                <form className="flex gap-2" onSubmit={async event => { event.preventDefault(); if (!naming) return; await naming.submit(naming.value); setNaming(null); }}>
                    <Input autoFocus aria-label="Name" maxLength={255} value={naming?.value ?? ''} onChange={event => naming && setNaming({ ...naming, value: event.target.value })} />
                    <Button type="submit">Save</Button>
                </form>
            </Dialog>
            <ShareDialog vaultId={vaultId} open={panel === 'share'} onOpenChange={value => setPanel(value ? 'share' : null)} />
            <TrashDialog vaultId={vaultId} open={panel === 'trash'} onOpenChange={value => setPanel(value ? 'trash' : null)} onRestored={() => void loadVault()} />
            {note && <HistoryDialog vaultId={vaultId} noteId={note.id} current={() => (editor ? markdown.serialize(editor.getJSON()) : note.markdown)} open={panel === 'history'} onOpenChange={value => setPanel(value ? 'history' : null)} />}
            <Palette
                open={panel === 'palette'}
                onOpenChange={value => setPanel(value ? 'palette' : null)}
                vaultId={vaultId}
                actions={[
                    { label: 'New note', icon: <IconFilePlus />, run: () => create(null, 'note') },
                    { label: dark ? 'Light mode' : 'Dark mode', icon: dark ? <IconSun /> : <IconMoon />, run: toggleTheme },
                    ...(note ? [{ label: 'History', icon: <IconHistory />, run: () => setPanel('history') }] : []),
                    { label: 'Trash', icon: <IconTrash />, run: () => setPanel('trash') },
                    { label: 'Share', icon: <IconShare />, run: () => setPanel('share') },
                    { label: 'Home', icon: <IconHome />, run: () => navigate('/') },
                ]}
            />
        </div>
    );
}
