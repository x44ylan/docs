// Browser-only editor behaviour layered on the shared schema: code block
// previews, `/` commands, `[[` note links, in-note find and heading anchors.
// None of these change what is stored.
import { Extension, Node as TiptapNode, type AnyExtension, type Editor, type Range } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import Heading from '@tiptap/extension-heading';
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { extensions as shared, slug, starterKit } from '../../shared/schema.ts';
import { createLazyLowlight } from './lowlight.ts';
import { preview } from './preview.ts';

// Diagram previews (and Mermaid's 3 MB library) load only when a diagram
// scrolls into view.
type Mounted = { render: (language: string, source: string, onCode: () => void) => void; unmount: () => void };
function mountPreview(element: HTMLElement): Mounted {
    let mounted: Mounted | undefined;
    let pending: Parameters<Mounted['render']> | undefined;
    let gone = false;
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        void import('./previews.tsx').then(module => {
            if (gone) return;
            mounted = module.mountPreview(element);
            if (pending) mounted.render(...pending);
        });
    }, { rootMargin: '600px 0px' });
    element.style.minHeight = '240px';
    observer.observe(element);
    return {
        render: (...args) => { pending = args; mounted?.render(...args); },
        unmount: () => { gone = true; observer.disconnect(); mounted?.unmount(); },
    };
}

const previewable = (language?: string | null) => ['html', 'mermaid', 'archify'].includes((language ?? '').toLowerCase());

// Code blocks: language label, copy, and Preview/Code for html, mermaid and archify.
function codeBlock(onHighlight: () => void) {
    return CodeBlockLowlight.extend({
        addNodeView() {
            return ({ node, editor, getPos }) => {
                let current = node;
                let showing = ['mermaid', 'archify'].includes(node.attrs.language);
                let frame: HTMLIFrameElement | undefined;
                let preview$: ReturnType<typeof mountPreview> | undefined;
                let holder: HTMLDivElement | undefined;
                let timer: ReturnType<typeof setTimeout> | undefined;
                const dom = document.createElement('div');
                dom.className = 'not-prose my-4 min-w-0';
                const pre = document.createElement('pre');
                pre.className = 'overflow-x-auto rounded-lg px-4 py-3 text-sm';
                const header = document.createElement('div');
                header.contentEditable = 'false';
                header.className = 'mb-2 flex items-center justify-between gap-2 font-sans text-xs text-muted-foreground print:hidden';
                const label = document.createElement('span');
                const actions = document.createElement('div');
                actions.className = 'flex items-center gap-1';
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'h-7 rounded-md px-2 font-medium hover:bg-accent';
                toggle.onclick = event => { event.preventDefault(); showing = !showing; render(); };
                const copy = document.createElement('button');
                copy.type = 'button';
                copy.className = 'h-7 rounded-md px-2 font-medium hover:bg-accent';
                copy.textContent = 'Copy';
                copy.setAttribute('aria-label', 'Copy code');
                copy.onclick = async event => {
                    event.preventDefault();
                    await navigator.clipboard?.writeText(current.textContent);
                    copy.textContent = 'Copied';
                    setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
                };
                actions.append(toggle, copy);
                header.append(label, actions);
                const code = document.createElement('code');
                code.style.display = 'block';
                pre.append(header, code);
                dom.append(pre);

                function render() {
                    clearTimeout(timer);
                    const language = (current.attrs.language || 'text').toLowerCase();
                    const can = previewable(language);
                    if (!can) showing = false;
                    label.textContent = language === 'plaintext' ? 'text' : language;
                    code.className = `language-${language}`;
                    toggle.hidden = !can;
                    toggle.textContent = showing ? 'Code' : 'Preview';
                    toggle.setAttribute('aria-label', showing ? `Show ${language} code` : `Preview ${language}`);
                    toggle.setAttribute('aria-pressed', String(showing));
                    code.style.display = showing ? 'none' : 'block';
                    pre.hidden = showing && language !== 'html';
                    if (showing && language === 'html') {
                        if (!frame) {
                            frame = document.createElement('iframe');
                            frame.title = 'HTML preview';
                            frame.setAttribute('sandbox', '');
                            frame.referrerPolicy = 'no-referrer';
                            frame.className = 'block h-80 max-h-[60dvh] w-full rounded-b-lg border border-t-0 bg-white';
                            dom.append(frame);
                        }
                        frame.srcdoc = preview(current.textContent);
                        pre.style.borderBottomLeftRadius = pre.style.borderBottomRightRadius = '0';
                    } else {
                        frame?.remove();
                        frame = undefined;
                        pre.style.borderBottomLeftRadius = pre.style.borderBottomRightRadius = '';
                    }
                    if (showing && language !== 'html') {
                        if (!holder) {
                            holder = document.createElement('div');
                            holder.contentEditable = 'false';
                            dom.append(holder);
                            preview$ = mountPreview(holder);
                        }
                        preview$!.render(language, current.textContent, () => {
                            showing = false;
                            render();
                            const pos = getPos();
                            if (editor.isEditable && pos !== undefined) editor.commands.setTextSelection(pos + 1);
                        });
                    } else if (holder) {
                        preview$?.unmount();
                        holder.remove();
                        holder = preview$ = undefined;
                    }
                }
                render();

                return {
                    dom,
                    contentDOM: code,
                    update(updated) {
                        if (updated.type !== current.type) return false;
                        const changed = updated.textContent !== current.textContent || updated.attrs.language !== current.attrs.language;
                        if (updated.attrs.language !== current.attrs.language) showing = ['mermaid', 'archify'].includes(updated.attrs.language);
                        current = updated;
                        if (changed) timer = setTimeout(render, 150);
                        return true;
                    },
                    stopEvent: event => header.contains(event.target as Node) || event.target === frame || !!holder?.contains(event.target as Node),
                    ignoreMutation: mutation => (mutation.type !== 'selection' && !code.contains(mutation.target)) || (mutation.type === 'attributes' && mutation.target === code),
                    destroy() {
                        clearTimeout(timer);
                        preview$?.unmount();
                    },
                };
            };
        },
    }).configure({ lowlight: createLazyLowlight(onHighlight), defaultLanguage: null });
}

// Images and attachments resolve through the API relative to the note.
const image = (src: (href: string) => string) =>
    Image.extend({
        renderHTML({ HTMLAttributes }) {
            const raw = String(HTMLAttributes.src ?? '');
            return ['img', { ...HTMLAttributes, src: /^(https?:|data:)/.test(raw) ? raw : src(raw), loading: 'lazy' }];
        },
    }).configure({ inline: true });

// --- Suggestions (`/` and `[[`) --------------------------------------------

export type MenuState<T> = { items: T[]; index: number; rect: DOMRect | null; select: (item: T) => void } | null;

function suggestion<T>(name: string, char: string, items: (query: string) => T[] | Promise<T[]>, pick: (editor: Editor, range: Range, item: T) => void, show: (state: MenuState<T>) => void) {
    let state: MenuState<T> = null;
    const update = (props: SuggestionProps<T, T>) => {
        state = { items: props.items, index: 0, rect: props.clientRect?.() ?? null, select: item => props.command(item) };
        show(state);
    };
    return Extension.create({
        name,
        addProseMirrorPlugins() {
            return [
                Suggestion<T, T>({
                    editor: this.editor,
                    pluginKey: new PluginKey(name),
                    char,
                    allowSpaces: char === '[[',
                    startOfLine: false,
                    items: ({ query }) => items(query),
                    command: ({ editor, range, props }) => pick(editor, range, props),
                    render: () => ({
                        onStart: update,
                        onUpdate: update,
                        onExit: () => { state = null; show(null); },
                        onKeyDown: ({ event }) => {
                            if (!state?.items.length) return false;
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                const step = event.key === 'ArrowDown' ? 1 : -1;
                                state = { ...state, index: (state.index + step + state.items.length) % state.items.length };
                                show(state);
                                return true;
                            }
                            if (event.key === 'Enter' || event.key === 'Tab') {
                                state.select(state.items[state.index]);
                                return true;
                            }
                            if (event.key === 'Escape') { show(null); return true; }
                            return false;
                        },
                    }),
                }),
            ];
        },
    });
}

export type Command = { title: string; keywords: string; run: (editor: Editor) => void };
export const commands: Command[] = [
    { title: 'Text', keywords: 'paragraph p', run: e => e.chain().focus().setParagraph().run() },
    { title: 'Heading 1', keywords: 'h1 title', run: e => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { title: 'Heading 2', keywords: 'h2 subtitle', run: e => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { title: 'Heading 3', keywords: 'h3', run: e => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { title: 'Bullet list', keywords: 'ul unordered', run: e => e.chain().focus().toggleBulletList().run() },
    { title: 'Numbered list', keywords: 'ol ordered', run: e => e.chain().focus().toggleOrderedList().run() },
    { title: 'Task list', keywords: 'todo checkbox', run: e => e.chain().focus().toggleTaskList().run() },
    { title: 'Quote', keywords: 'blockquote', run: e => e.chain().focus().toggleBlockquote().run() },
    { title: 'Code block', keywords: 'pre code', run: e => e.chain().focus().setCodeBlock().run() },
    { title: 'Table', keywords: 'grid', run: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { title: 'Divider', keywords: 'hr rule line', run: e => e.chain().focus().setHorizontalRule().run() },
    { title: 'Mermaid', keywords: 'diagram chart flow', run: e => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A --> B' }] }).run() },
    { title: 'Archify diagram', keywords: 'architecture json diagram', run: e => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'archify' }, content: [{ type: 'text', text: '{\n  "diagram_type": "architecture",\n  "components": [\n    { "id": "app", "label": "App", "pos": [40, 40] }\n  ]\n}' }] }).run() },
    { title: 'HTML preview', keywords: 'html iframe', run: e => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'html' }, content: [{ type: 'text', text: '<p>Hello</p>' }] }).run() },
    { title: 'Link to note', keywords: 'link page note [[', run: e => e.chain().focus().insertContent('[[').run() },
    { title: 'Image or file', keywords: 'image picture photo upload attachment file', run: e => void (e.storage as unknown as { uploads: { pick: () => Promise<void> } }).uploads.pick() },
];

export type NoteLink = { id: number; name: string; path: string; href: string };

// --- Find in note ----------------------------------------------------------

export const findKey = new PluginKey<{ query: string; index: number; matches: { from: number; to: number }[] }>('find');
const Find = Extension.create({
    name: 'find',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: findKey,
                state: {
                    init: () => ({ query: '', index: 0, matches: [] as { from: number; to: number }[] }),
                    apply(tr, value) {
                        const meta = tr.getMeta(findKey) as { query?: string; index?: number } | undefined;
                        if (!meta && !tr.docChanged) return value;
                        const query = meta?.query ?? value.query;
                        const matches: { from: number; to: number }[] = [];
                        if (query) {
                            const needle = query.toLowerCase();
                            tr.doc.descendants((node, pos) => {
                                if (!node.isText) return;
                                const text = node.text!.toLowerCase();
                                for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
                                    matches.push({ from: pos + i, to: pos + i + needle.length });
                                }
                            });
                        }
                        const index = matches.length ? Math.min(meta?.index ?? value.index, matches.length - 1) : 0;
                        return { query, index, matches };
                    },
                },
                props: {
                    decorations(state) {
                        const { matches, index } = findKey.getState(state)!;
                        return DecorationSet.create(state.doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? 'find-match find-current' : 'find-match' })));
                    },
                },
            }),
        ];
    },
});

// Broken-link styling as decorations, so ProseMirror owns the DOM. Rebuilt
// only when links may have changed; plain typing just maps the set.
function linkDecorations(doc: import('@tiptap/pm/model').Node, exists: (href: string) => boolean | undefined) {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
        if (!node.isText) return;
        const link = node.marks.find(mark => mark.type.name === 'link');
        if (link && exists(String(link.attrs.href ?? '')) === false) {
            decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'broken-link', title: 'This note no longer exists' }));
        }
    });
    return DecorationSet.create(doc, decorations);
}
const anchorsKey = new PluginKey<DecorationSet>('anchors');
const Anchors = (exists: (href: string) => boolean | undefined) => Extension.create({
    name: 'anchors',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: anchorsKey,
                state: {
                    init: (_, state) => linkDecorations(state.doc, exists),
                    apply(tr, value, _old, state) {
                        if (!tr.docChanged && !tr.getMeta(anchorsKey)) return value;
                        // Typing plain text never adds, removes or retargets a link.
                        const linksMayChange = tr.getMeta(anchorsKey) || tr.steps.some(step => {
                            const json = step.toJSON() as { stepType?: string; slice?: { content?: { type?: string; marks?: unknown[] }[] } };
                            return json.stepType !== 'replace' || (json.slice?.content ?? []).some(n => n.type !== 'text' || n.marks?.length);
                        });
                        return linksMayChange ? linkDecorations(state.doc, exists) : value.map(tr.mapping, tr.doc);
                    },
                },
                props: { decorations: state => anchorsKey.getState(state) },
                // Duplicate heading ids get `-1`, `-2` (rare; most notes have none).
                view: view => {
                    let frame = 0;
                    const dedupe = () => {
                        cancelAnimationFrame(frame);
                        frame = requestAnimationFrame(() => {
                            const seen = new Map<string, number>();
                            for (const heading of view.dom.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')) {
                                const base = heading.dataset.anchor ?? heading.id;
                                const n = seen.get(base) ?? 0;
                                seen.set(base, n + 1);
                                const id = n ? `${base}-${n}` : base;
                                if (heading.id !== id) { heading.dataset.anchor = base; heading.id = id; }
                            }
                        });
                    };
                    dedupe();
                    return { update: (v, prev) => { if (!prev.doc.eq(v.state.doc)) dedupe(); }, destroy: () => cancelAnimationFrame(frame) };
                },
            }),
        ];
    },
});
// Headings render their anchor id from their own text (no decoration set).
// A node view updates it in place when the text changes.
const AnchoredHeading = Heading.extend({
    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement(`h${node.attrs.level}`);
            dom.id = slug(node.textContent) || 'section';
            let current = node;
            return {
                dom,
                contentDOM: dom,
                update(updated) {
                    if (updated.type !== current.type || updated.attrs.level !== current.attrs.level) return false;
                    if (updated.textContent !== current.textContent) {
                        delete dom.dataset.anchor;
                        dom.id = slug(updated.textContent) || 'section';
                    }
                    current = updated;
                    return true;
                },
                ignoreMutation: mutation => mutation.type === 'attributes',
            };
        };
    },
});
// Re-check links after the tree changes (e.g. a note was deleted).
export const refreshAnchors = (editor: Editor) => editor.view.dispatch(editor.state.tr.setMeta(anchorsKey, true));

// Copying a selection also places Markdown on the clipboard as plain text.
const CopyMarkdown = (toMarkdown: (editor: Editor) => string) =>
    Extension.create({
        name: 'copyMarkdown',
        addProseMirrorPlugins() {
            const editor = this.editor;
            return [
                new Plugin({
                    props: {
                        handleDOMEvents: {
                            copy(_view, event) {
                                if (editor.state.selection.empty || !event.clipboardData) return false;
                                const html = (() => { const div = document.createElement('div'); div.append(editor.view.serializeForClipboard(editor.state.selection.content()).dom); return div.innerHTML; })();
                                event.clipboardData.setData('text/html', html);
                                event.clipboardData.setData('text/plain', toMarkdown(editor));
                                event.preventDefault();
                                return true;
                            },
                        },
                    },
                }),
            ];
        },
    });

// Pasted or dropped files upload next to the note; images are inserted as
// images, other files as links. Text pastes are left to the editor.
export const pickFile = (accept = '') =>
    new Promise<File[]>(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = accept;
        input.onchange = () => resolve([...(input.files ?? [])]);
        input.click();
    });

export async function insertFiles(editor: Editor, files: File[], upload: (file: File) => Promise<{ src: string; name: string; image: boolean }>, at?: number) {
    for (const file of files) {
        const done = await upload(file).catch(() => undefined);
        if (!done) continue;
        const content = done.image
            ? { type: 'image', attrs: { src: done.src, alt: done.name } }
            : { type: 'text', text: done.name, marks: [{ type: 'link', attrs: { href: done.src } }] };
        const chain = editor.chain().focus();
        (at !== undefined ? chain.insertContentAt(at, content) : chain.insertContent(content)).insertContent(' ').run();
        at = undefined;
    }
}

const Uploads = (upload: (file: File) => Promise<{ src: string; name: string; image: boolean }>) =>
    Extension.create<unknown, { pick: () => Promise<void> }>({
        name: 'uploads',
        addStorage() {
            return { pick: async () => {} };
        },
        onCreate() {
            this.storage.pick = async () => insertFiles(this.editor, await pickFile(), upload);
        },
        addProseMirrorPlugins() {
            const editor = this.editor;
            return [
                new Plugin({
                    props: {
                        handlePaste(_view, event) {
                            const files = [...(event.clipboardData?.files ?? [])];
                            if (!files.length || !editor.isEditable) return false;
                            void insertFiles(editor, files, upload);
                            return true;
                        },
                        handleDrop(view, event) {
                            const files = [...(event.dataTransfer?.files ?? [])];
                            if (!files.length || !editor.isEditable) return false;
                            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
                            void insertFiles(editor, files, upload, at);
                            return true;
                        },
                    },
                }),
            ];
        },
    });

// Table editing re-checks every changed block for broken tables on each
// transaction (over a second when a large note first syncs). Notes without a
// table skip it; with tables it runs as before.
const LightTable = (table: AnyExtension) =>
    (table as TiptapNode).extend({
        addProseMirrorPlugins() {
            return (this.parent?.() ?? []).map(plugin => {
                const append = plugin.spec.appendTransaction;
                if (!append) return plugin;
                return new Plugin({
                    ...plugin.spec,
                    appendTransaction(trs, oldState, state) {
                        let hasTable = false;
                        state.doc.forEach(node => { if (node.type.name === 'table') hasTable = true; });
                        return hasTable ? append.call(plugin, trs, oldState, state) : null;
                    },
                });
            });
        },
    });

export function editorExtensions(options: {
    file: (href: string) => string;
    openLink: (href: string) => boolean;
    selectionMarkdown: (editor: Editor) => string;
    notes: (query: string) => NoteLink[];
    showCommands: (state: MenuState<Command>) => void;
    showLinks: (state: MenuState<NoteLink>) => void;
    rehighlight: () => void;
    upload: (file: File) => Promise<{ src: string; name: string; image: boolean }>;
    exists: (href: string) => boolean | undefined;
}) {
    return [
        ...shared.filter(e => !['codeBlock', 'image', 'starterKit', 'table'].includes(e.name)),
        LightTable(shared.find(e => e.name === 'table')!),
        starterKit({ heading: false }),
        AnchoredHeading,
        codeBlock(options.rehighlight),
        image(options.file),
        Find,
        Anchors(options.exists),
        CopyMarkdown(options.selectionMarkdown),
        Uploads(options.upload),
        suggestion<Command>('slash', '/', query => {
            const q = query.toLowerCase();
            return commands.filter(c => !q || `${c.title} ${c.keywords}`.toLowerCase().includes(q)).slice(0, 12);
        }, (editor, range, item) => {
            editor.chain().focus().deleteRange(range).run();
            item.run(editor);
        }, options.showCommands),
        suggestion<NoteLink>('noteLink', '[[', query => options.notes(query).slice(0, 8), (editor, range, item) => {
            // One step: replace `[[query` with the linked name and a space.
            const { schema, tr } = editor.state;
            const link = schema.text(item.name, [schema.marks.link.create({ href: item.href })]);
            tr.replaceWith(range.from, range.to, [link, schema.text(' ')]);
            editor.view.dispatch(tr.scrollIntoView());
            editor.commands.focus();
        }, options.showLinks),
        Extension.create({
            name: 'internalLinks',
            // Table selection also handles clicks. Run links first so anchors
            // in table cells cannot fall through to raw `.md` navigation.
            priority: 1_000,
            addProseMirrorPlugins: () => [
                new Plugin({
                    props: {
                        handleClick(_view, _pos, event) {
                            const anchor = (event.target as HTMLElement).closest('a');
                            const href = anchor?.getAttribute('href');
                            if (!href || event.button !== 0) return false;
                            if (options.openLink(href)) { event.preventDefault(); return true; }
                            if (/^https?:/i.test(href)) { event.preventDefault(); window.open(href, '_blank', 'noopener'); return true; }
                            return false;
                        },
                    },
                }),
            ],
        }),
    ];
}
