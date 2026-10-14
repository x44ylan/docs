// Tree helpers shared by the sidebar, links and the command menu. Paths match
// the server: a note's sub-notes live in a folder named after it.
import type { TreeNode } from './api.ts';

export type Tree = { nodes: Map<number, TreeNode>; children: Map<number | null, TreeNode[]> };

const rank = { folder: 0, note: 1, file: 2 };
export function buildTree(list: TreeNode[]): Tree {
    const nodes = new Map(list.map(node => [node.id, node]));
    const children = new Map<number | null, TreeNode[]>();
    for (const node of list) {
        const siblings = children.get(node.parent_id) ?? [];
        siblings.push(node);
        children.set(node.parent_id, siblings);
    }
    // Always A-Z, folders first.
    for (const siblings of children.values()) {
        siblings.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    }
    return { nodes, children };
}

export const fileName = (node: TreeNode) => (node.kind === 'note' ? `${node.name}.md` : node.kind === 'file' && node.ext ? `${node.name}.${node.ext}` : node.name);

export function ancestors(tree: Tree, id: number): TreeNode[] {
    const chain: TreeNode[] = [];
    for (let node = tree.nodes.get(id); node; node = node.parent_id ? tree.nodes.get(node.parent_id) : undefined) chain.unshift(node);
    return chain;
}

export function pathOf(tree: Tree, id: number): string {
    const chain = ancestors(tree, id);
    return '/' + chain.map((node, i) => (i < chain.length - 1 ? node.name : fileName(node))).join('/');
}

// Resolve a link in note `fromId` to a node (absolute `/A/B.md` or relative).
export function resolve(tree: Tree, fromId: number, href: string): TreeNode | undefined {
    if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href)) return;
    let target = href.split('#')[0];
    try { target = decodeURI(target); } catch { /* raw */ }
    const base = pathOf(tree, fromId).split('/').slice(0, -1);
    const parts = target.startsWith('/') ? [] : [...base];
    for (const part of target.split('/')) {
        if (part === '..') parts.pop();
        else if (part && part !== '.') parts.push(part);
    }
    let parent: number | null = null;
    let found: TreeNode | undefined;
    for (const [i, part] of parts.entries()) {
        const last = i === parts.length - 1;
        const siblings: TreeNode[] = tree.children.get(parent) ?? [];
        found = last
            ? siblings.find(node => fileName(node).toLowerCase() === part.toLowerCase())
            : siblings.find(node => node.kind === 'folder' && node.name.toLowerCase() === part.toLowerCase()) ??
              siblings.find(node => node.kind === 'note' && node.name.toLowerCase() === part.toLowerCase());
        if (!found) return;
        parent = found.id;
    }
    return found;
}

export const isInside = (tree: Tree, id: number, ancestorId: number) => ancestors(tree, id).some(node => node.id === ancestorId);
