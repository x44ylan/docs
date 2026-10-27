// The note editor. Read-only HTML paints first; the live editor replaces it
// once the shared document has synced, keeping the scroll position.
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { generateHTML, getSchema, type JSONContent } from '@tiptap/core';
import { initProseMirrorDoc } from '@tiptap/y-tiptap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { extensions as schemaExtensions, markdown } from '../../shared/schema.ts';
import { api, type Note, type User } from '../api.ts';
import { cn } from '../ui.tsx';
import { commands, editorExtensions, type Command, type MenuState, type NoteLink } from './extensions.ts';
import { colorFor, openNote, type Session } from './sync.ts';

export type Presence = { id: number; name: string; color: string }[];

// Cut long notes at a blank line outside code fences, about 20 KB in.
function head(text: string, limit = 20_000) {
    if (text.length <= limit) return text;
    let fenced = false;
    let at = 0;
    for (const line of text.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        at += line.length + 1;
        if (at > limit && !fenced && !line.trim()) return text.slice(0, at);
    }
    return text;
}

export function NoteView({ note, user, editable, links, file, openLink, linkExists, onEditor, onPresence, onStatus }: {
    note: Note;
    user: User;
    editable: boolean;
    links: (query: string) => NoteLink[];
    file: (href: string) => string;
    openLink: (href: string) => boolean;
    linkExists: (href: string) => boolean | undefined;
    onEditor: (editor: Editor | null) => void;
    onPresence: (people: Presence) => void;
    onStatus: (online: boolean) => void;
}) {
    const [session, setSession] = useState<Session>();
    const [ready, setReady] = useState(false);
    // Let the read-only preview paint before building the live editor.
    const [painted, setPainted] = useState(false);
    useEffect(() => {
        setPainted(false);
        const frame = requestAnimationFrame(() => setTimeout(() => setPainted(true), 0));
        return () => cancelAnimationFrame(frame);
    }, [note.id]);
    useEffect(() => {
        let alive = true;
        let current: Session | undefined;
        setReady(false);
        // Start syncing after the read-only preview has painted.
        const frame = requestAnimationFrame(() => setTimeout(() => {
            if (!alive) return;
            void openNote(note.id, (note as Note & { epoch?: string | null }).epoch ?? null).then(opened => {
                if (!alive) return opened.destroy();
                current = opened;
                setSession(opened);
                void opened.synced.then(() => alive && setReady(true));
                opened.provider.on('status', ({ status }: { status: string }) => onStatus(status === 'connected'));
            });
        }, 0));
        return () => { alive = false; cancelAnimationFrame(frame); current?.destroy(); setSession(undefined); };
    }, [note.id]);

    // Instant read-only render of the first screenfuls from the Markdown the
    // API already returned; the live editor fills in the rest.
    const html = useMemo(() => {
        try { return generateHTML(markdown.parse(head(note.markdown)), schemaExtensions); } catch { return ''; }
    }, [note.id]);

    return (
        <div className="note prose prose-neutral dark:prose-invert relative max-w-none" data-ready={ready}>
            {!ready && <div className="ProseMirror" aria-busy="true" onClick={event => {
                const anchor = (event.target as HTMLElement).closest('a');
                const href = anchor?.getAttribute('href');
                if (href && openLink(href)) event.preventDefault();
            }} dangerouslySetInnerHTML={{ __html: html }} />}
            {/* Mount once synced, so the editor binds to the full document. */}
            {session && painted && ready && (
                <Live key={note.id} note={note} session={session} user={user} editable={editable} links={links} file={file} openLink={openLink} linkExists={linkExists} onEditor={onEditor} onPresence={onPresence} />
            )}
        </div>
    );
}

function Live({ note, session, user, editable, links, file, openLink, linkExists, onEditor, onPresence }: {
    note: Note; session: Session; user: User; editable: boolean; links: (q: string) => NoteLink[]; file: (href: string) => string;
    openLink: (href: string) => boolean; linkExists: (href: string) => boolean | undefined; onEditor: (editor: Editor | null) => void; onPresence: (people: Presence) => void;
}) {
    const [slash, setSlash] = useState<MenuState<Command>>(null);
    const [linkMenu, setLinkMenu] = useState<MenuState<NoteLink>>(null);
    const [, rerender] = useState(0);
    const linksRef = useRef(links);
    linksRef.current = links;
    const openRef = useRef(openLink);
    openRef.current = openLink;
    const existsRef = useRef(linkExists);
    existsRef.current = linkExists;

    // Build the document and its Yjs mapping once, with the editor's own
    // schema; otherwise the binding re-renders the whole note on mount
    // (about 2 s on a 1 MB note).
    const extensions = useMemo(() => [
            ...editorExtensions({
                file,
                openLink: href => openRef.current(href),
                exists: href => existsRef.current(href),
                selectionMarkdown: e => markdown.serialize({ type: 'doc', content: e.state.selection.content().content.toJSON() ?? [] }).trim(),
                notes: q => linksRef.current(q),
                showCommands: setSlash,
                showLinks: setLinkMenu,
                rehighlight: () => rerender(n => n + 1),
                upload: async upload => {
                    const form = new FormData();
                    form.set('file', upload);
                    const done = await api<{ src: string; name: string }>(`/vaults/${note.vault_id}/nodes/${note.id}/files`, { form });
                    return { ...done, image: upload.type.startsWith('image/') };
                },
            }),
        ], [session]);
    const initial = useMemo(() => {
        const fragment = session.doc.getXmlFragment('default');
        return fragment.length ? initProseMirrorDoc(fragment, getSchema(extensions)) : undefined;
    }, [session, extensions]);
    const editor = useEditor({
        editable,
        immediatelyRender: true,
        shouldRerenderOnTransaction: false,
        // Tiptap rebuilds node views on every read of `nodeViews`, so React's
        // second `createNodeViews` call redraws the whole document. Read them
        // once and reuse them (identical views, one render).
        onBeforeCreate: ({ editor }) => {
            const manager = (editor as unknown as { extensionManager: object }).extensionManager;
            const nodeViews = (manager as { nodeViews: object }).nodeViews;
            const markViews = (manager as { markViews: object }).markViews;
            Object.defineProperty(manager, 'nodeViews', { value: nodeViews });
            Object.defineProperty(manager, 'markViews', { value: markViews });
        },
        // A ProseMirror document (not JSON), so the mapping's nodes are reused.
        content: initial?.doc as unknown as JSONContent | undefined,
        extensions: [
            ...extensions,
            Collaboration.configure({ document: session.doc, field: 'default', ySyncOptions: initial ? { mapping: initial.mapping } : {} }),
            CollaborationCaret.configure({ provider: session.provider, user: { id: user.id, name: user.name, color: colorFor(user.id) } }),
        ],
        editorProps: { attributes: { spellcheck: 'true', 'aria-label': 'Note' } },
    });

    useEffect(() => { editor.setEditable(editable); }, [editor, editable]);
    useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor]);
    // Leaving a note: detach and destroy the view first. Otherwise the editor
    // re-renders and re-reads the whole document as React removes it (seconds
    // on large notes).
    useLayoutEffect(() => () => {
        if (editor.isDestroyed) return;
        (editor.view as unknown as { domObserver: { stop: () => void } }).domObserver.stop();
        editor.view.dom.remove();
        editor.destroy();
    }, [editor]);
    useEffect(() => {
        const awareness = session.provider.awareness;
        if (!awareness) return;
        const update = () => {
            const seen = new Map<number, Presence[number]>();
            for (const [client, state] of awareness.getStates()) {
                const person = state.user as { id: number; name: string; color: string } | undefined;
                if (person && client !== awareness.clientID && person.id !== user.id) seen.set(person.id, person);
            }
            onPresence([...seen.values()]);
        };
        awareness.on('change', update);
        update();
        return () => { awareness.off('change', update); onPresence([]); };
    }, [session]);

    return (
        <>
            <EditorContent editor={editor} />
            <Suggestions state={slash} label="Commands" render={item => item.title} />
            <Suggestions state={linkMenu} label="Link to note" empty="No matching notes" render={item => (
                <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.path}</span>
                </span>
            )} />
        </>
    );
}

function Suggestions<T>({ state, label, empty, render }: { state: MenuState<T>; label: string; empty?: string; render: (item: T) => React.ReactNode }) {
    if (!state?.rect || (!state.items.length && !empty)) return null;
    const below = state.rect.bottom + 300 < innerHeight;
    const style = { left: Math.max(8, Math.min(state.rect.left, innerWidth - 272)), ...(below ? { top: state.rect.bottom + 6 } : { bottom: innerHeight - state.rect.top + 6 }) };
    return createPortal(
        <div role="listbox" aria-label={label} style={style} className="fixed z-50 max-h-72 w-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md">
            {!state.items.length && <div className="px-2 py-2 text-muted-foreground">{empty}</div>}
            {state.items.map((item, i) => (
                <button
                    key={i}
                    type="button"
                    role="option"
                    aria-selected={i === state.index}
                    className={cn('flex min-h-9 w-full items-center rounded-md px-2 text-left', i === state.index && 'bg-accent')}
                    onMouseDown={event => { event.preventDefault(); state.select(item); }}
                >
                    {render(item)}
                </button>
            ))}
        </div>,
        document.body,
    );
}

export { commands };
