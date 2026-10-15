// Vault tree: A-Z, folders first, chevrons only where there are children,
// drag and drop to nest, pins at the top. Large vaults are virtualised.
import { IconChevronRight, IconDots, IconFilePlus, IconFileText, IconFolder, IconFolderPlus, IconPencil, IconPhoto, IconPin, IconPinnedOff, IconPlus, IconShare, IconTrash } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import type { TreeNode } from '../api.ts';
import { isInside, type Tree } from '../tree.ts';
import { cn, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui.tsx';

export type TreeActions = {
    open: (node: TreeNode) => void;
    create: (parentId: number | null, kind: 'note' | 'folder') => void;
    rename: (node: TreeNode) => void;
    remove: (node: TreeNode) => void;
    move: (node: TreeNode, parentId: number | null) => void;
    pin: (node: TreeNode, pinned: boolean) => void;
    share: () => void;
    trash: () => void;
};

export function Sidebar({ name, tree, pins, selected, main, actions }: { name: string; tree: Tree; pins: number[]; selected: number | null; main: number | null; actions: TreeActions }) {
    // The vault's main note starts expanded so its sub-notes are visible.
    const [open, setOpen] = useState<Set<number>>(() => new Set(main ? [main] : []));
    const [drag, setDrag] = useState<{ id: number; over: number | null | 'root' } | null>(null);
    const scroller = useRef<HTMLDivElement>(null);

    // Keep the selected note's ancestors expanded, and show its own sub-notes
    // (until the user collapses it).
    const [closed, setClosed] = useState<Set<number>>(() => new Set());
    const expanded = useMemo(() => {
        const set = new Set(open);
        for (let node = selected ? tree.nodes.get(selected) : undefined; node?.parent_id; node = tree.nodes.get(node.parent_id)) set.add(node.parent_id);
        if (selected && !closed.has(selected)) set.add(selected);
        return set;
    }, [open, closed, selected, tree]);

    const rows = useMemo(() => {
        const out: { node: TreeNode; depth: number }[] = [];
        const walk = (parent: number | null, depth: number) => {
            for (const node of tree.children.get(parent) ?? []) {
                out.push({ node, depth });
                if (expanded.has(node.id)) walk(node.id, depth + 1);
            }
        };
        walk(null, 0);
        return out;
    }, [tree, expanded]);

    const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 32, overscan: 12 });
    const toggle = (id: number) => {
        const opening = !expanded.has(id);
        setOpen(prev => { const next = new Set(prev); if (opening) { next.add(id); } else { next.delete(id); } return next; });
        setClosed(prev => { const next = new Set(prev); if (opening) { next.delete(id); } else { next.add(id); } return next; });
    };
    const pinned = pins.map(id => tree.nodes.get(id)).filter((n): n is TreeNode => !!n);
    const canDrop = (target: number | null) => drag && drag.id !== target && (target === null || (!isInside(tree, target, drag.id) && tree.nodes.get(target)?.kind !== 'file'));

    return (
        <nav aria-label="Notes" className="flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-1 pr-1 pl-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={name}>{name}</h2>
                <Menu>
                    <MenuTrigger asChild><IconButton label="Vault menu"><IconDots /></IconButton></MenuTrigger>
                    <MenuContent>
                        <MenuItem onSelect={() => actions.create(null, 'note')}><IconPlus />New note</MenuItem>
                        <MenuItem onSelect={() => actions.create(null, 'folder')}><IconFolderPlus />New folder</MenuItem>
                        <MenuItem onSelect={actions.share}><IconShare />Share</MenuItem>
                        <MenuSeparator />
                        <MenuItem onSelect={actions.trash}><IconTrash />Trash</MenuItem>
                    </MenuContent>
                </Menu>
            </div>
            {!!pinned.length && (
                <ul aria-label="Pinned" className="mb-1 border-b px-2 pb-1">
                    {pinned.map(node => (
                        <li key={node.id}>
                            <button type="button" onClick={() => actions.open(node)} className={cn('flex min-h-11 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-8', selected === node.id && 'text-foreground')}>
                                <IconPin className="size-3.5 shrink-0" /><span className="truncate">{node.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div
                ref={scroller}
                className={cn('min-h-0 flex-1 overflow-y-auto px-2 pb-6', drag?.over === 'root' && 'ring-2 ring-ring ring-inset')}
                onDragOver={event => { if (canDrop(null) && event.target === event.currentTarget) { event.preventDefault(); setDrag(d => d && { ...d, over: 'root' }); } }}
                onDrop={event => { if (drag && event.target === event.currentTarget) { event.preventDefault(); actions.move(tree.nodes.get(drag.id)!, null); setDrag(null); } }}
            >
                <div role="tree" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                    {virtual.getVirtualItems().map(item => {
                        const { node, depth } = rows[item.index];
                        const kids = tree.children.get(node.id)?.length ?? 0;
                        const isOpen = expanded.has(node.id);
                        const isPinned = pins.includes(node.id);
                        return (
                            <div
                                key={node.id}
                                role="treeitem"
                                aria-expanded={kids ? isOpen : undefined}
                                aria-selected={selected === node.id}
                                data-node={node.id}
                                draggable
                                onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(node.id)); setDrag({ id: node.id, over: null }); }}
                                onDragEnd={() => setDrag(null)}
                                onDragOver={event => { if (canDrop(node.id)) { event.preventDefault(); event.stopPropagation(); setDrag(d => d && { ...d, over: node.id }); } }}
                                onDrop={event => { event.preventDefault(); event.stopPropagation(); if (drag && canDrop(node.id)) actions.move(tree.nodes.get(drag.id)!, node.id); setDrag(null); }}
                                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)`, paddingLeft: depth * 14 }}
                                className={cn(
                                    'group flex min-h-11 items-center rounded-md text-sm sm:min-h-8',
                                    selected === node.id ? 'bg-selected text-selected-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                    drag?.over === node.id && 'ring-2 ring-ring ring-inset',
                                    drag?.id === node.id && 'opacity-40',
                                )}
                                ref={virtual.measureElement}
                                data-index={item.index}
                            >
                                {kids ? (
                                    <button type="button" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`} onClick={() => toggle(node.id)} className="flex h-11 w-7 shrink-0 items-center justify-center sm:h-8 sm:w-6">
                                        <IconChevronRight className={cn('size-3.5 opacity-70 transition-transform', isOpen && 'rotate-90')} />
                                    </button>
                                ) : <span className="w-7 shrink-0 sm:w-6" />}
                                <button
                                    type="button"
                                    title={node.name}
                                    onClick={() => (node.kind === 'folder' ? toggle(node.id) : actions.open(node))}
                                    className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline sm:min-h-8"
                                >
                                    {node.kind === 'folder' ? <IconFolder className="size-3.5 shrink-0 opacity-70" /> : node.kind === 'file' ? <IconPhoto className="size-3.5 shrink-0 opacity-70" /> : <IconFileText className="size-3.5 shrink-0 opacity-70" />}
                                    <span className="truncate">{node.name}</span>
                                </button>
                                <Menu>
                                    <MenuTrigger asChild>
                                        <button type="button" aria-label={`Actions for ${node.name}`} className="flex h-11 w-8 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 sm:h-8 sm:w-7 [@media(hover:none)]:opacity-100">
                                            <IconDots className="size-3.5" />
                                        </button>
                                    </MenuTrigger>
                                    <MenuContent>
                                        {node.kind !== 'file' && <MenuItem onSelect={() => { setOpen(prev => new Set(prev).add(node.id)); actions.create(node.id, 'note'); }}><IconFilePlus />{node.kind === 'note' ? 'New sub-note' : 'New note'}</MenuItem>}
                                        {node.kind === 'folder' && <MenuItem onSelect={() => actions.create(node.id, 'folder')}><IconFolderPlus />New folder</MenuItem>}
                                        {node.kind === 'note' && <MenuItem onSelect={() => actions.pin(node, !isPinned)}>{isPinned ? <IconPinnedOff /> : <IconPin />}{isPinned ? 'Unpin' : 'Pin'}</MenuItem>}
                                        <MenuItem onSelect={() => actions.rename(node)}><IconPencil />Rename</MenuItem>
                                        <MenuSeparator />
                                        <MenuItem destructive onSelect={() => actions.remove(node)}><IconTrash />Delete</MenuItem>
                                    </MenuContent>
                                </Menu>
                            </div>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
