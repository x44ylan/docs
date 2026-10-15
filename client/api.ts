// Small fetch wrapper; Cloudflare Access cookies authenticate every request.
import { toast } from 'sonner';

export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData; quiet?: boolean } = {}): Promise<T> {
    // A GET started early (see `prefetch`) is reused once.
    const early = !init.method && !init.body && !init.form ? prefetched.get(path) : undefined;
    if (early) {
        prefetched.delete(path);
        return early.then(r => r as T, () => api<T>(path, init));
    }
    const response = await fetch(`/api${path}`, {
        method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
        headers: init.form ? undefined : { 'Content-Type': 'application/json' },
        body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
        credentials: 'same-origin',
    });
    if (response.status === 401 || response.redirected) {
        // The Access session expired: reload to sign in again.
        location.reload();
        throw new ApiError(401, 'Sign in again.');
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const error = new ApiError(response.status, data?.error ?? 'Something went wrong.');
        if (!init.quiet) toast.error(error.message);
        throw error;
    }
    return data as T;
}

const prefetched = new Map<string, Promise<unknown>>();
// Start GETs before the page that needs them has loaded its code.
export function prefetch(path: string) {
    if (!prefetched.has(path)) {
        const request = api(path, { quiet: true });
        request.catch(() => undefined);
        prefetched.set(path, request);
        setTimeout(() => prefetched.delete(path), 10_000);
    }
}

export type User = { id: number; email: string; name: string };
export type Kind = 'note' | 'folder' | 'file';
export type TreeNode = { id: number; vault_id: number; parent_id: number | null; name: string; kind: Kind; ext: string | null; updated_at: string };
export type Vault = { id: number; name: string; owner_id: number; public: number; share_token: string | null; main: number | null; nodes: TreeNode[]; pins: number[] };
export type Note = TreeNode & { path: string; markdown: string; backlinks: { id: number; name: string }[]; pinned: boolean };
export type Home = {
    user: User;
    vaults: { id: number; name: string; owner_id: number; public: number; shared: number; notes: number }[];
    pins: { id: number; vault_id: number; vault: string; name: string }[];
    recent: { id: number; vault_id: number; vault: string; name: string; updated_at: string }[];
};

// Session cache so pages paint instantly from the last response, then refresh.
export function cached<T>(key: string): T | undefined {
    try {
        const value = sessionStorage.getItem(key);
        return value ? (JSON.parse(value) as T) : undefined;
    } catch {
        return undefined;
    }
}
export function cache(key: string, value: unknown) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* full */ }
}
