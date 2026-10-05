import { options } from './editor.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

// Saved Markdown must stay byte-for-byte identical when the serializer changes.
// The golden file was recorded from the full-document Turndown implementation;
// run with UPDATE_MARKDOWN_GOLDEN=1 only when a format change is intended.
// Encoded link spaces now normalize like raw spaces after fixing double encoding.
const golden = new URL('./markdown.golden.json', import.meta.url);

const long = Array.from({ length: 120 }, (_, i) => [
    `## Section ${i}`,
    `Paragraph ${i} with *emphasis*, **strong**, \`code\` and a [link](https://example.test/${i} "Title ${i}").`,
    `- item ${i}\n    - nested ${i}\n- [x] done ${i}`,
    i % 7 === 0 ? '```js\nconst n = ' + i + ';\n```' : `> quote ${i}`,
][i % 4]).join('\n\n');

export const cases = {
    empty: '',
    whitespace: '   \n\n\t\n',
    paragraphs: 'First paragraph\nsoft wrapped line.\n\n\n\nSecond after extra blank lines.',
    hardBreaks: 'Two spaces  \nbreak and backslash\\\nbreak.\n\nTrailing spaces   ',
    inlineWhitespace: 'Tabs\tinside  and   runs of spaces, nbsp\u00a0here, *em with space *after and** strong **around.',
    emphasis: '*em* _under_ **strong** __strong__ ***both*** ~~strike~~ `code` ``code with ` tick``',
    headings: '# H1\n## H2 ##\n### H3 with `code`\n#### H4\n##### H5\n###### H6\nSetext\n===\nSub\n---',
    lists: '- a\n- b\n    - b1\n        - b1a\n- c\n\n1. one\n2. two\n    1. two.one\n\n3. three\n\n7. seven start\n8. eight\n\n* star\n+ plus',
    looseList: '- loose one\n\n- loose two\n\n    continued paragraph\n\n- three',
    tasks: '- [ ] todo\n- [x] done\n    - [ ] nested todo\n    - [X] nested done\n- [ ]\n\n- [ ] after break',
    blockquote: '> quote line\n> second\n>\n> - list in quote\n> > nested quote\n\nafter',
    code: '```\nplain\n  indented\n```\n\n```js\nconst a = "<b>&amp;</b>";\n```\n\n```html\n<div class="card">Preview</div>\n```\n\n    indented code block\n\n```archify\n{"nodes":[{"id":"a","label":"A"}],"edges":[]}\n```',
    links: '[text](https://example.test "Title") <https://angle.test> https://bare.test mail@example.test <mail@example.test> [vault](Some Folder/My Note.md) [enc](Folder%20Name/a%20b.md)',
    images: '![alt](image.png) ![titled](dir/a b.png "Caption") ![](/files/12?path=x.png) text after',
    hashtags: '#tag at start, mid #mid-tag, escaped \\#nottag, #über_unicode, `#incode`, and a#glued',
    brackets: 'Smart (parens) [brackets] {braces} "quotes" \'single\' <angle> & ampersand',
    html: '<div>Raw HTML stays text</div>\n\n<b>bold?</b> inline <i>html</i>\n\n<!-- comment -->',
    tables: '| Left | Center | Right |\n|:-----|:------:|------:|\n| a | **b** | `c` |\n| pipe \\| esc | [l](u) | |\n\n| No align |\n| --- |\n| x |',
    rules: 'above\n\n---\n\n***\n\n___\n\nbelow',
    escapes: '\\*not em\\* \\_x\\_ 1\\. not list \\# not heading \\> not quote \\`tick\\` \\[b\\]',
    unicode: 'Emoji 😀 👍🏽, CJK 中文, RTL שלום, combining é, zero\u200bwidth',
    mixed: '# Doc\n\nIntro with **bold** and #tag.\n\n- [ ] task with [link](a.md)\n- item `code`\n\n| h | i |\n| - | - |\n| 1 | 2 |\n\n```py\nprint(1)\n```\n\n> end',
    long,
};

export async function markdown({ browser, base, jwt, dir }) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(base);
        const request = (path, method, data) => page.evaluate(async ({ path, method, data }) => {
            const token = document.cookie.split('; ').find(v => v.startsWith('XSRF-TOKEN='))?.slice(11);
            const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, body: JSON.stringify(data) });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }, { path, method, data });
        const vault = (await request('/vaults', 'POST', { name: 'Markdown fidelity' })).data;
        const note = (await request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Fidelity', parent_id: null, is_file: true })).data;
        await page.goto(`${base}/vaults/${vault.id}?file=${note.id}`);
        const editor = page.locator('.tiptap');
        await editor.waitFor();
        const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
        const mode = async name => {
            await options(page);
            await page.getByRole('menuitem', { name, exact: true }).click();
        };
        const read = async () => {
            await mode('Markdown source');
            const value = await source.inputValue();
            await mode('Rich text editor');
            return value;
        };
        // Edits run through editor commands so they are deterministic (typed keys can
        // race focus restoration from the editor menu). Each edit is reverted, so
        // unchanged blocks keep their node identity and exercise cached output.
        const edit = async (at, action) => {
            await page.evaluate(({ at, action }) => {
                const editor = document.querySelector('.tiptap').editor;
                editor.commands.focus(at);
                if (action === 'type') {
                    editor.commands.insertContent('x');
                    const { from } = editor.state.selection;
                    editor.commands.deleteRange({ from: from - 1, to: from });
                } else {
                    editor.commands.splitBlock();
                    editor.commands.joinBackward();
                }
            }, { at, action });
            await page.waitForTimeout(350);
            return read();
        };

        const results = {};
        for (const [name, value] of Object.entries(cases)) {
            await mode('Markdown source');
            await source.fill(value);
            await page.waitForTimeout(100);
            await mode('Rich text editor');
            results[name] = [
                await edit('end', 'type'),
                await edit('start', 'type'),
                await edit('end', 'split'),
            ];
        }

        if (process.env.UPDATE_MARKDOWN_GOLDEN === '1') {
            await writeFile(golden, JSON.stringify(results, null, 2) + '\n');
        }
        const expected = JSON.parse(await readFile(golden, 'utf8'));
        assert.deepEqual(Object.keys(results), Object.keys(expected), 'Golden cases match the corpus');
        for (const [name, outputs] of Object.entries(results)) {
            outputs.forEach((output, i) => assert.equal(output, expected[name][i], `Markdown for ${name} (edit ${i + 1}) is byte-identical`));
        }
        // Less common grammars load on demand; re-highlighting is not an edit.
        const grammar = page.waitForResponse(response => /\/rust-[\w-]+\.js$/.test(response.url()));
        await mode('Markdown source');
        const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/nodes/'));
        await source.fill('```rs\nfn main() { let answer = 42; }\n```');
        await saved;
        let saves = 0;
        page.on('request', request => { if (request.method() === 'PATCH') saves++; });
        await mode('Rich text editor');
        await grammar;
        await editor.locator('pre .hljs-keyword', { hasText: 'fn' }).waitFor();
        await page.waitForTimeout(1500);
        assert.equal(saves, 0, 'Loading a grammar does not save the note');
        // If the refresh were recorded, the first undo would only revert it.
        await page.evaluate(() => document.querySelector('.tiptap').editor.commands.undo());
        assert(!(await editor.innerText()).includes('fn main'), 'Re-highlighting adds no undo step');

        assert.deepEqual(errors, []);
        return `Markdown serialization is byte-identical to the recorded Turndown output (${Object.keys(cases).length} documents × 3 edits); lazy grammars highlight without saving or adding undo steps`;
    } catch (error) {
        await page.screenshot({ path: new URL('markdown-failure.png', dir).pathname }).catch(() => {});
        throw error;
    } finally {
        await context.close();
    }
}
