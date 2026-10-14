// Dialogs and popovers used by the vault page: sharing, history, trash,
// table of contents and in-note find.
import { IconCopy, IconLink, IconLinkOff, IconRestore, IconTrash, IconX, IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import type { Editor } from '@tiptap/react';
import { diffLines } from 'diff';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { slug } from '../../shared/schema.ts';
import { api, type User } from '../api.ts';
import { findKey } from '../editor/extensions.ts';
import { Button, cn, Dialog, IconButton, Input } from '../ui.tsx';

// --- Sharing ---------------------------------------------------------------

export function ShareDialog({ vaultId, open, onOpenChange }: { vaultId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
    const [members, setMembers] = useState<(User & { owner: number })[]>([]);
    const [share, setShare] = useState<{ public: number; share_token: string | null }>({ public: 0, share_token: null });
    const [query, setQuery] = useState('');
    const [people, setPeople] = useState<User[]>([]);
    const load = async () => {
        setMembers(await api(`/vaults/${vaultId}/members`));
        setShare(await api(`/vaults/${vaultId}/share`));
    };
    useEffect(() => { if (open) void load(); }, [open]);
    useEffect(() => {
        if (!open || !query.trim()) return setPeople([]);
        const timer = setTimeout(async () => setPeople(await api(`/vaults/${vaultId}/people?q=${encodeURIComponent(query)}`, { quiet: true })), 150);
        return () => clearTimeout(timer);
    }, [query, open]);
    const add = async (email: string) => {
        await api(`/vaults/${vaultId}/members`, { body: { email } });
        setQuery('');
        void load();
    };
    const update = async (body: { public?: boolean; link?: boolean }) => setShare(await api(`/vaults/${vaultId}/share`, { method: 'PATCH', body }));
    const link = share.share_token ? `${location.origin}/share/${share.share_token}` : '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="Share" top>
            <form className="relative" onSubmit={event => { event.preventDefault(); if (query.includes('@')) void add(query); }}>
                <Input aria-label="Add people by name or email" placeholder="Add people" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />
                {!!people.length && (
                    <ul role="listbox" className="absolute inset-x-0 top-10 z-10 rounded-lg border bg-popover p-1 shadow-md">
                        {people.map(person => (
                            <li key={person.id}>
                                <button type="button" role="option" aria-selected={false} onClick={() => void add(person.email)} className="flex min-h-10 w-full flex-col items-start justify-center rounded-md px-2 text-left hover:bg-accent">
                                    <span className="text-sm">{person.name}</span>
                                    <span className="text-xs text-muted-foreground">{person.email}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </form>
            <ul className="mt-3 max-h-[40dvh] divide-y overflow-y-auto">
                {members.map(member => (
                    <li key={member.id} className="flex min-h-12 items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{member.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        {member.owner ? <span className="text-xs text-muted-foreground">Owner</span> : (
                            <IconButton label={`Remove ${member.name}`} onClick={async () => { await api(`/vaults/${vaultId}/members/${member.id}`, { method: 'DELETE' }); void load(); }}><IconX /></IconButton>
                        )}
                    </li>
                ))}
            </ul>
            <div className="mt-3 space-y-2 border-t pt-3">
                <label className="flex min-h-10 items-center justify-between gap-3 text-sm">
                    Public
                    <input type="checkbox" className="size-4 accent-current" checked={!!share.public} onChange={event => void update({ public: event.target.checked })} />
                </label>
                {link ? (
                    <div className="flex items-center gap-1">
                        <Input readOnly aria-label="Read-only link" value={link} onFocus={event => event.target.select()} className="text-xs" />
                        <IconButton label="Copy link" onClick={async () => { await navigator.clipboard.writeText(link); toast.success('Link copied'); }}><IconCopy /></IconButton>
                        <IconButton label="Turn off link" onClick={() => void update({ link: false })}><IconLinkOff /></IconButton>
                    </div>
                ) : (
                    <Button variant="outline" className="w-full" onClick={() => void update({ link: true })}><IconLink />Create read-only link</Button>
                )}
            </div>
        </Dialog>
    );
}

// --- History ---------------------------------------------------------------

type Version = { id: number; created_at: string; source: string; author: string | null; size: number };
const when = (iso: string) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function HistoryDialog({ vaultId, noteId, current, open, onOpenChange }: { vaultId: number; noteId: number; current: () => string; open: boolean; onOpenChange: (open: boolean) => void }) {
    const [versions, setVersions] = useState<Version[]>([]);
    const [selected, setSelected] = useState<{ id: number; markdown: string } | null>(null);
    useEffect(() => {
        if (!open) return setSelected(null);
        void api<Version[]>(`/vaults/${vaultId}/nodes/${noteId}/versions`).then(setVersions);
    }, [open, noteId]);
    const pick = async (id: number) => setSelected({ id, ...(await api<{ markdown: string }>(`/vaults/${vaultId}/nodes/${noteId}/versions/${id}`)) });
    const parts = selected ? diffLines(selected.markdown, current()) : [];
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="History" top className="flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col sm:max-h-[80dvh]">
            {!versions.length && <p className="py-6 text-center text-sm text-muted-foreground">No earlier versions yet.</p>}
            <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
                <ul className="max-h-40 shrink-0 overflow-y-auto sm:max-h-none sm:w-56">
                    {versions.map(version => (
                        <li key={version.id}>
                            <button type="button" onClick={() => void pick(version.id)} className={cn('flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent', selected?.id === version.id && 'bg-accent')}>
                                <span className="text-sm">{when(version.created_at)}</span>
                                <span className="text-xs text-muted-foreground">{version.author ?? 'Docs'}{version.source === 'mcp' ? ' · agent' : version.source === 'restore' ? ' · restore' : ''}</span>
                            </button>
                        </li>
                    ))}
                </ul>
                {selected && (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                        <pre aria-label="Changes since this version" className="min-h-0 flex-1 overflow-auto rounded-md border p-2 text-xs leading-5 whitespace-pre-wrap">
                            {parts.map((part, i) => (
                                <span key={i} className={cn(part.added && 'bg-green-500/15 text-green-700 dark:text-green-300', part.removed && 'bg-red-500/15 text-red-700 line-through dark:text-red-300', !part.added && !part.removed && 'text-muted-foreground')}>{part.value}</span>
                            ))}
                        </pre>
                        <Button className="self-end" onClick={async () => {
                            await api(`/vaults/${vaultId}/nodes/${noteId}/versions/${selected.id}/restore`, { method: 'POST' });
                            toast.success('Version restored');
                            onOpenChange(false);
                        }}><IconRestore />Restore</Button>
                    </div>
                )}
            </div>
        </Dialog>
    );
}

// --- Trash -----------------------------------------------------------------

type Trashed = { id: number; name: string; kind: string; deleted_at: string; deleted_by: string | null; count: number };
export function TrashDialog({ vaultId, open, onOpenChange, onRestored }: { vaultId: number; open: boolean; onOpenChange: (open: boolean) => void; onRestored: (id: number) => void }) {
    const [items, setItems] = useState<Trashed[]>([]);
    const load = () => api<Trashed[]>(`/vaults/${vaultId}/trash`).then(setItems);
    useEffect(() => { if (open) void load(); }, [open]);
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="Trash" top>
            <p className="-mt-2 mb-2 text-xs text-muted-foreground">Deleted notes are kept for 30 days.</p>
            {!items.length && <p className="py-6 text-center text-sm text-muted-foreground">Trash is empty.</p>}
            <ul className="max-h-[60dvh] divide-y overflow-y-auto">
                {items.map(item => (
                    <li key={item.id} className="flex min-h-12 items-center gap-1">
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{item.name}{item.count > 1 ? ` + ${item.count - 1}` : ''}</p>
                            <p className="truncate text-xs text-muted-foreground">{when(item.deleted_at)}{item.deleted_by ? ` · ${item.deleted_by}` : ''}</p>
                        </div>
                        <IconButton label={`Restore ${item.name}`} onClick={async () => { await api(`/vaults/${vaultId}/trash/${item.id}`, { method: 'POST' }); onRestored(item.id); void load(); }}><IconRestore /></IconButton>
                        <IconButton label={`Delete ${item.name} permanently`} onClick={async () => {
                            if (!confirm(`Delete ${item.name} permanently? This cannot be undone.`)) return;
                            await api(`/vaults/${vaultId}/trash/${item.id}`, { method: 'DELETE' });
                            void load();
                        }}><IconTrash /></IconButton>
                    </li>
                ))}
            </ul>
        </Dialog>
    );
}

// --- Table of contents -----------------------------------------------------

export type Heading = { id: string; text: string; level: number };
export function headingsOf(editor: Editor | null): Heading[] {
    if (!editor) return [];
    const seen = new Map<string, number>();
    const out: Heading[] = [];
    editor.state.doc.descendants(node => {
        if (node.type.name !== 'heading') return;
        const base = slug(node.textContent) || 'section';
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        if (node.attrs.level <= 3) out.push({ id: n ? `${base}-${n}` : base, text: node.textContent, level: node.attrs.level });
        return false;
    });
    return out;
}

export function Contents({ headings, onJump }: { headings: Heading[]; onJump: (id: string) => void }) {
    const [active, setActive] = useState('');
    useEffect(() => {
        const elements = headings.map(h => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
        const observer = new IntersectionObserver(entries => {
            const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
            if (visible) setActive(visible.target.id);
        }, { rootMargin: '0px 0px -70% 0px' });
        elements.forEach(e => observer.observe(e));
        return () => observer.disconnect();
    }, [headings]);
    return (
        <ul aria-label="Contents" className="max-h-[60dvh] w-64 overflow-y-auto">
            {headings.map(h => (
                <li key={h.id}>
                    <button type="button" onClick={() => onJump(h.id)} style={{ paddingLeft: 8 + (h.level - 1) * 12 }} className={cn('flex min-h-9 w-full items-center rounded-md pr-2 text-left text-sm hover:bg-accent sm:min-h-8', active === h.id ? 'text-foreground' : 'text-muted-foreground')}>
                        <span className="truncate">{h.text}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

// --- Find in note ----------------------------------------------------------

export function FindBar({ editor, onClose }: { editor: Editor | null; onClose: () => void }) {
    const [query, setQuery] = useState('');
    const [, tick] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const state = editor ? findKey.getState(editor.state) : undefined;
    const count = state?.matches.length ?? 0;
    const set = (meta: { query?: string; index?: number }) => {
        if (!editor) return;
        editor.view.dispatch(editor.state.tr.setMeta(findKey, meta));
        const next = findKey.getState(editor.state);
        const match = next?.matches[next.index];
        if (match) (editor.view.domAtPos(match.from).node as Element)?.parentElement?.scrollIntoView({ block: 'center' });
        tick(n => n + 1);
    };
    useEffect(() => { input.current?.focus(); return () => { editor?.view.dispatch(editor.state.tr.setMeta(findKey, { query: '' })); }; }, [editor]);
    const step = (delta: number) => count && set({ index: ((state?.index ?? 0) + delta + count) % count });
    return (
        <div role="search" className="flex h-[60px] min-w-0 flex-1 items-center gap-1">
            <input
                ref={input}
                type="search"
                aria-label="Find in note"
                placeholder="Find"
                value={query}
                onChange={event => { setQuery(event.target.value); set({ query: event.target.value, index: 0 }); }}
                onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
                    if (event.key === 'Escape') onClose();
                }}
                className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-live="polite">{query ? `${count ? (state?.index ?? 0) + 1 : 0}/${count}` : ''}</span>
            <IconButton label="Previous match" disabled={!count} onClick={() => step(-1)}><IconChevronUp /></IconButton>
            <IconButton label="Next match" disabled={!count} onClick={() => step(1)}><IconChevronDown /></IconButton>
            <IconButton label="Close find" onClick={onClose}><IconX /></IconButton>
        </div>
    );
}
