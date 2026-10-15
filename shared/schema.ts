// One editor schema for the browser, the sync server and MCP. Every place that
// converts between Markdown and the editor uses `markdown` from this file, so
// the file on disk, live edits and agent writes always agree.
import { getSchema, Node as TiptapNode, type AnyExtension, type JSONContent } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { createLowlight } from 'lowlight';

// Marked tries every block tokenizer at every block with the rest of the note.
// The stock table and task-list tokenizers split that whole remainder each
// time, which is quadratic (a 1 MB note took 20 s). Skip them unless their
// syntax starts here; otherwise they run unchanged, so output is identical.
type Tokenizer = NonNullable<typeof Table.config.markdownTokenizer>;
const only = (tokenizer: Tokenizer | undefined, pattern: RegExp): Tokenizer | undefined =>
    tokenizer && {
        ...tokenizer,
        start: src => (pattern.test(src) ? 0 : -1),
        tokenize: (src, tokens, lexer) => (pattern.test(src) ? tokenizer.tokenize(src, tokens, lexer) : undefined),
    };

// Tables are written compactly (`| a | b |` / `| --- |`), as existing notes are.
const CompactTable = Table.extend({
    markdownTokenizer: only(Table.config.markdownTokenizer, /^[^\n]*\|[^\n]*\n(?=[^\n]*\|)[ \t|:]*-[ \t|:-]*(?:\n|$)/),
    renderMarkdown(node: JSONContent, h: { renderChildren: (nodes: JSONContent[]) => string }) {
        // Cells cannot start a heading or list, so drop the paragraph-start escape.
        const rows = (node.content ?? []).map(row => (row.content ?? []).map(cell => ({
            text: h.renderChildren(cell.content ?? []).replace(/\s*\n\s*/g, '<br>').replace(/\|/g, '\\|').trim()
                .replace(/^\\(#{1,6}|>|[-+])(?=\s|$)/, '$1').replace(/^(\d{1,9})\\([.)])(?=\s|$)/, '$1$2'),
            align: cell.attrs?.align as string | undefined,
        })));
        if (!rows.length) return '';
        const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
        const rule = rows[0].map(cell => ({ left: ':---', right: '---:', center: ':---:' })[cell.align ?? ''] ?? '---');
        // Blocks are already joined with a blank line; no extra padding.
        return [line(rows[0].map(cell => cell.text)), line(rule), ...rows.slice(1).map(row => line(row.map(cell => cell.text)))].join('\n');
    },
});

// Heading anchors for the table of contents and `#heading` links.
export const slug = (text: string) => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

export const lowlight = createLowlight();

// Raw HTML blocks (a line starting with `<div>`, `<!-- -->`, ...) are kept as
// written and shown as plain text, never rendered or re-escaped.
const HtmlBlock = TiptapNode.create({
    name: 'htmlBlock',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    parseHTML: () => [{ tag: 'pre[data-html-block]', preserveWhitespace: 'full' }],
    renderHTML: () => ['pre', { 'data-html-block': '', class: 'html-block' }, ['code', 0]],
    renderMarkdown: (node: JSONContent) => (node.content ?? []).map(child => child.text ?? '').join(''),
});

// Browser-only behaviour (node views, collaboration, menus) is added by the
// client on top of these; they never change what is stored.
// No automatic trailing paragraph: it would edit every note that ends with a
// heading, table or code block just by opening it.
const starter = { codeBlock: false, undoRedo: false, trailingNode: false, link: { openOnClick: false, autolink: false, linkOnPaste: true } } as const;
// The browser swaps in its own heading (with an anchor node view); the node
// type, and therefore stored content, is identical.
export const starterKit = (options: Partial<Parameters<typeof StarterKit.configure>[0]> = {}) => StarterKit.configure({ ...starter, ...options });
export const extensions: AnyExtension[] = [
    starterKit(),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Image.configure({ inline: true }),
    TaskList.extend({
        markdownTokenizer: only(TaskList.config.markdownTokenizer as Tokenizer, /^[ \t]*[-+*][ \t]+\[[ xX]\]/),
    }),
    TaskItem.configure({ nested: true }),
    CompactTable,
    TableRow,
    TableHeader,
    TableCell,
    HtmlBlock,
];

export const schema = getSchema(extensions);

const manager = new MarkdownManager({ extensions });
// Raw HTML is kept as literal text everywhere (as before), so the browser and
// the server parse a note identically. Escape only what would otherwise change
// meaning when parsed again, so notes keep their text (`ATT&CK`, `snake_case`).
Object.assign(manager, {
    parseHTMLToken(this: { htmlAsLiteralText: (html: string, block: boolean) => JSONContent | null }, token: { text?: string; raw?: string; block?: boolean }) {
        const html = token.text || token.raw || '';
        if (!html.trim()) return null;
        if (token.block) return { type: 'htmlBlock', content: [{ type: 'text', text: html.replace(/\s+$/, '') }] };
        return this.htmlAsLiteralText(html, false);
    },
    encodeTextForMarkdown(this: { codeTypes: Set<string> }, text: string, node: JSONContent, parent?: JSONContent) {
        if ((parent?.type && this.codeTypes.has(parent.type)) || (node.marks ?? []).some(mark => this.codeTypes.has(mark.type))) return text;
        const escaped = text
            .replace(/\\(?=[\\`*_[\]~<&#>|!-])/g, '\\\\')
            .replace(/&(?=#?\w+;)/g, '&amp;')
            .replace(/<(?=(?:https?:|mailto:|[^>\s]+@)[^>\s]*>)/gi, '\\<')
            .replace(/[`*~]/g, '\\$&')
            .replace(/(^|\W)_|_(?=\W|$)/g, match => match.replace('_', '\\_'))
            .replace(/\[(?=[^\]]*\](?:[([:]|$))/g, '\\[');
        // Only a paragraph's first text can turn into a heading, quote or list.
        const first = parent?.type === 'paragraph' && parent.content?.[0] === node;
        return first ? escaped.replace(/^(#{1,6}|>|[-+])(?=\s|$)/, '\\$1').replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2') : escaped;
    },
});

// Notes link to vault paths with raw spaces (`[x](/A B/C.md)`). Wrap them in
// `<>` for the parser and unwrap on output, so hrefs are kept byte-for-byte.
const wrapHref = (markdown: string) =>
    markdown.replace(/\]\(([^)<\s"]+(?: [^)"]*?))(\s+"[^"]*")?\)/g, (_, href: string, title = '') => `](<${href}>${title})`);

// YAML front matter at the very top is kept verbatim as a `frontmatter` code
// block (otherwise its closing `---` turns the text into a heading).
const FRONT = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

export const markdown = {
    parse(text: string): JSONContent {
        const front = FRONT.exec(text);
        const doc = manager.parse(wrapHref(front ? text.slice(front[0].length) : text));
        if (front) doc.content = [{ type: 'codeBlock', attrs: { language: 'frontmatter' }, content: front[1] ? [{ type: 'text', text: front[1] }] : [] }, ...(doc.content ?? [])];
        return doc;
    },
    serialize(doc: JSONContent): string {
        const [first, ...rest] = doc.content ?? [];
        const front = first?.type === 'codeBlock' && first.attrs?.language === 'frontmatter';
        const body = manager.serialize(front ? { ...doc, content: rest } : doc).replace(/\]\(<([^>\n]*)>/g, ']($1').replace(/\s+$/, '');
        if (!front) return body + '\n';
        const yaml = (first.content ?? []).map(n => n.text ?? '').join('');
        return `---\n${yaml}\n---\n${body ? `\n${body}\n` : ''}`;
    },
};
