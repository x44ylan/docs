// Public read-only link: the vault's notes as rendered HTML, no editing.
import { IconChevronRight, IconFileText, IconFolder, IconLayoutSidebar, IconListDetails, IconMoon, IconSun } from '@tabler/icons-react';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { TreeNode } from '../api.ts';
import { Contents, PageOutline, type Heading } from '../components/contents.tsx';
import { Header, DocIcon } from '../components/header.tsx';
import { buildTree, resolve } from '../tree.ts';
import { createLazyLowlight } from '../editor/lowlight.ts';
import type { RootContent } from 'hast';
import { title, useTheme } from '../theme.ts';
import { cn, IconButton, Popover, PopoverContent, PopoverTrigger } from '../ui.tsx';

type Shared = { name: string; nodes: Pick<TreeNode, 'id' | 'parent_id' | 'name' | 'kind'>[]; note: { id: number; name: string; path: string; html: string } | null };

// Lowlight emits text and nested token spans. Keep code samples literal.
function appendTokens(parent: Element, tokens: RootContent[]) {
    for (const token of tokens) {
        if (token.type === 'text') parent.append(token.value);
        if (token.type !== 'element') continue;
        const span = parent.ownerDocument.createElement('span');
        if (Array.isArray(token.properties.className)) span.className = token.properties.className.join(' ');
        appendTokens(span, token.children);
        parent.append(span);
    }
}

export function Share() {
    const token = useParams().token!;
    const [params, setParams] = useSearchParams();
    const [data, setData] = useState<Shared>();
    const [error, setError] = useState('');
    const [sidebar, setSidebar] = useState(() => matchMedia('(min-width: 1024px)').matches);
    const { dark, toggle } = useTheme();
    const [grammarVersion, setGrammarVersion] = useState(0);
    const [highlighter] = useState(() => createLazyLowlight(() => setGrammarVersion(version => version + 1)));
    const main = useRef<HTMLElement>(null);
    const [contentsOpen, setContentsOpen] = useState(false);
    const file = params.get('file');

    useEffect(() => {
        const query = file ? `?file=${encodeURIComponent(file)}` : '';
        void fetch(`/share/${token}${query}`, { headers: { Accept: 'application/json' } }).then(async response => {
            const body = await response.json();
            if (!response.ok) return setError(body.error ?? 'This link is no longer available.');
            setData(body);
            title(body.note?.name ?? body.name);
            main.current?.scrollTo(0, 0);
        });
    }, [token, file]);

    const tree = useMemo(() => buildTree((data?.nodes ?? []).map(n => ({ ...n, vault_id: 0, ext: null, updated_at: '' }))), [data]);
    const { html, headings } = useMemo(() => {
        const headings: Heading[] = [];
        if (!data?.note) return { html: '', headings };
        const doc = new DOMParser().parseFromString(DOMPurify.sanitize(data.note.html), 'text/html');
        doc.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') ?? '';
            if (!/^(https?:|data:)/.test(src)) img.src = `/share/${token}/files?from=${data.note!.id}&path=${encodeURIComponent(src)}`;
        });
        for (const code of doc.querySelectorAll('pre > code')) {
            const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9);
            const source = code.textContent;
            const tokens = language && highlighter.registered(language)
                ? highlighter.highlight(language, source)
                : highlighter.highlightAuto(source);
            code.replaceChildren();
            appendTokens(code, tokens.children);
        }
        doc.querySelectorAll('input').forEach(input => input.setAttribute('disabled', ''));
        for (const element of doc.querySelectorAll('h1, h2, h3')) {
            const text = element.textContent.trim();
            if (!text) continue;
            element.id = `shared-section-${headings.length + 1}`;
            headings.push({ id: element.id, text, level: Number(element.tagName.slice(1)) });
        }
        return { html: doc.body.innerHTML, headings };
    }, [data, token, highlighter, grammarVersion]);

    if (error) return <div className="flex h-dvh items-center justify-center p-6 text-sm text-muted-foreground">{error}</div>;
    return (
        <div className="flex h-dvh flex-col">
            <Header
                brand={<span className="inline-flex size-9 shrink-0 items-center justify-center"><DocIcon /></span>}
                lead={<IconButton label="Toggle notes" className="max-sm:hidden" onClick={() => setSidebar(s => !s)}><IconLayoutSidebar /></IconButton>}
                crumbs={!data ? [] : data.note && data.note.name !== data.name ? [{ label: data.name }, { label: data.note.name }] : [{ label: data.name }]}
                actions={headings.length >= 2 && (
                    <Popover open={contentsOpen} onOpenChange={setContentsOpen}>
                        <PopoverTrigger asChild><IconButton label="Contents" className="xl:hidden"><IconListDetails /></IconButton></PopoverTrigger>
                        <PopoverContent>
                            <Contents headings={headings} onJump={id => {
                                setContentsOpen(false);
                                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }} />
                        </PopoverContent>
                    </Popover>
                )}
                account={<IconButton label={dark ? 'Light mode' : 'Dark mode'} onClick={toggle}>{dark ? <IconSun /> : <IconMoon />}</IconButton>}
                onTitle={innerWidth < 640 ? () => setSidebar(s => !s) : undefined}
            />
            <div className="flex min-h-0 flex-1">
                {sidebar && data && (
                    <aside className="w-64 shrink-0 overflow-y-auto border-r bg-popover p-2 max-lg:absolute max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-30 max-lg:w-[80%] max-lg:max-w-[300px]">
                        <Branch tree={tree} parent={null} depth={0} selected={data.note?.id} open={id => { setParams({ file: String(id) }); if (innerWidth < 1024) setSidebar(false); }} />
                    </aside>
                )}
                <main ref={main} className="page-scroll min-w-0 flex-1 overflow-y-auto">
                    <div className="mx-auto flex min-h-full w-full">
                        <div className="min-w-0 flex-1">
                            <article
                                className="note prose prose-neutral dark:prose-invert mx-auto max-w-[46rem] px-4 pt-6 pb-24 sm:px-8 sm:pt-10"
                                onClick={event => {
                                    const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
                                    if (!href || !data?.note) return;
                                    const target = resolve(tree, data.note.id, href);
                                    if (target?.kind === 'note') { event.preventDefault(); setParams({ file: String(target.id) }); }
                                    else if (/^https?:/i.test(href)) { event.preventDefault(); window.open(href, '_blank', 'noopener'); }
                                }}
                                dangerouslySetInnerHTML={{ __html: html }}
                            />
                        </div>
                        {headings.length >= 2 && <PageOutline headings={headings} />}
                    </div>
                </main>
            </div>
        </div>
    );
}

function Branch({ tree, parent, depth, selected, open }: { tree: ReturnType<typeof buildTree>; parent: number | null; depth: number; selected?: number; open: (id: number) => void }) {
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    return (
        <ul>
            {(tree.children.get(parent) ?? []).filter(n => n.kind !== 'file').map(node => {
                const kids = !!tree.children.get(node.id)?.length;
                const isOpen = expanded.has(node.id) || (selected !== undefined && isAncestor(tree, node.id, selected));
                return (
                    <li key={node.id}>
                        <div style={{ paddingLeft: depth * 14 }} className={cn('flex min-h-11 items-center rounded-md text-sm sm:min-h-8', selected === node.id ? 'bg-selected text-selected-foreground' : 'text-muted-foreground hover:bg-accent')}>
                            {kids ? (
                                <button type="button" aria-label={isOpen ? 'Collapse' : 'Expand'} className="flex h-8 w-6 items-center justify-center" onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(node.id)) { n.delete(node.id); } else { n.add(node.id); } return n; })}>
                                    <IconChevronRight className={cn('size-3.5', isOpen && 'rotate-90')} />
                                </button>
                            ) : <span className="w-6" />}
                            <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => node.kind === 'note' && open(node.id)}>
                                {node.kind === 'folder' ? <IconFolder className="size-3.5 shrink-0" /> : <IconFileText className="size-3.5 shrink-0" />}
                                <span className="truncate">{node.name}</span>
                            </button>
                        </div>
                        {kids && isOpen && <Branch tree={tree} parent={node.id} depth={depth + 1} selected={selected} open={open} />}
                    </li>
                );
            })}
        </ul>
    );
}

function isAncestor(tree: ReturnType<typeof buildTree>, id: number, of: number) {
    for (let node = tree.nodes.get(of); node?.parent_id; node = tree.nodes.get(node.parent_id)) if (node.parent_id === id) return true;
    return false;
}
