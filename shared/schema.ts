// One editor schema for the browser, the sync server and MCP. Every place that
// converts between Markdown and the editor uses `markdown` from this file, so
// the file on disk, live edits and agent writes always agree.
import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core';
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
        return `\n${[line(rows[0].map(cell => cell.text)), line(rule), ...rows.slice(1).map(row => line(row.map(cell => cell.text)))].join('\n')}\n`;
    },
});

// Heading anchors for the table of contents and `#heading` links.
export const slug = (text: string) => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

export const lowlight = createLowlight();

// Browser-only behaviour (node views, collaboration, menus) is added by the
// client on top of these; they never change what is stored.
export const extensions: AnyExtension[] = [
    StarterKit.configure({ codeBlock: false, undoRedo: false, link: { openOnClick: false, autolink: false, linkOnPaste: true } }),
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
];

export const schema = getSchema(extensions);

const manager = new MarkdownManager({ extensions });
// Raw HTML is kept as literal text everywhere (as before), so the browser and
// the server parse a note identically. Escape only what would otherwise change
// meaning when parsed again, so notes keep their text (`ATT&CK`, `snake_case`).
Object.assign(manager, {
    parseHTMLToken(this: { htmlAsLiteralText: (html: string, block: boolean) => JSONContent | null }, token: { text?: string; raw?: string; block?: boolean }) {
        const html = token.text || token.raw || '';
        return html.trim() ? this.htmlAsLiteralText(html, !!token.block) : null;
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

export const markdown = {
    parse: (text: string): JSONContent => manager.parse(wrapHref(text)),
    serialize: (doc: JSONContent): string => manager.serialize(doc).replace(/\]\(<([^>\n]*)>/g, ']($1').replace(/\s+$/, '') + '\n',
};
