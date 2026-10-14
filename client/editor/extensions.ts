// Browser-only editor behaviour layered on the shared schema: code block
// previews, `/` commands, `[[` note links, in-note find and heading anchors.
// None of these change what is stored.
import { Extension, type Editor, type Range } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { extensions as shared, slug } from '../../shared/schema.ts';
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

// Stable heading anchors for the table of contents and `#heading` links.
// Set as DOM ids after each change (cheap), not as a decoration set rebuilt
// over the whole document on every keystroke.
export function headingIds(root: ParentNode) {
    const seen = new Map<string, number>();
    for (const heading of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
        const base = slug(heading.textContent ?? '') || 'section';
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (heading.id !== id) heading.id = id;
    }
}
const Anchors = Extension.create({
    name: 'anchors',
    addProseMirrorPlugins() {
        let frame = 0;
        return [
            new Plugin({
                view: view => {
                    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => headingIds(view.dom)); };
                    update();
                    return { update: (v, prev) => { if (!prev.doc.eq(v.state.doc)) update(); }, destroy: () => cancelAnimationFrame(frame) };
                },
            }),
        ];
    },
});

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

export function editorExtensions(options: {
    file: (href: string) => string;
    openLink: (href: string) => boolean;
    selectionMarkdown: (editor: Editor) => string;
    notes: (query: string) => NoteLink[];
    showCommands: (state: MenuState<Command>) => void;
    showLinks: (state: MenuState<NoteLink>) => void;
    rehighlight: () => void;
}) {
    return [
        ...shared.filter(e => !['codeBlock', 'image'].includes(e.name)),
        codeBlock(options.rehighlight),
        image(options.file),
        Find,
        Anchors,
        CopyMarkdown(options.selectionMarkdown),
        suggestion<Command>('slash', '/', query => {
            const q = query.toLowerCase();
            return commands.filter(c => !q || `${c.title} ${c.keywords}`.toLowerCase().includes(q)).slice(0, 12);
        }, (editor, range, item) => {
            editor.chain().focus().deleteRange(range).run();
            item.run(editor);
        }, options.showCommands),
        suggestion<NoteLink>('noteLink', '[[', query => options.notes(query).slice(0, 8), (editor, range, item) => {
            editor.chain().focus().deleteRange(range).insertContent({ type: 'text', text: item.name, marks: [{ type: 'link', attrs: { href: item.href } }] }).insertContent(' ').run();
        }, options.showLinks),
        Extension.create({
            name: 'internalLinks',
            addProseMirrorPlugins: () => [
                new Plugin({
                    props: {
                        handleClick(_view, _pos, event) {
                            const anchor = (event.target as HTMLElement).closest('a');
                            const href = anchor?.getAttribute('href');
                            if (!href || event.button !== 0) return false;
                            if (options.openLink(href)) { event.preventDefault(); return true; }
                            if (/^https?:/i.test(href) && (event.metaKey || event.ctrlKey || !_view.editable)) { window.open(href, '_blank', 'noopener'); return true; }
                            return false;
                        },
                    },
                }),
            ],
        }),
    ];
}
