// One WebSocket per tab; each open note attaches a provider to it. Notes are
// also cached offline (IndexedDB) so edits survive a dropped connection.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

let socket: HocuspocusProviderWebsocket | undefined;
export const websocket = () =>
    (socket ??= new HocuspocusProviderWebsocket({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`, maxDelay: 10_000 }));

const colors = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
export const colorFor = (id: number) => colors[id % colors.length];

export type Session = { doc: Y.Doc; provider: HocuspocusProvider; offline: IndexeddbPersistence; synced: Promise<void>; destroy: () => void };

export async function openNote(id: number, epoch: string | null): Promise<Session> {
    const doc = new Y.Doc();
    // A new epoch means the server rebuilt this note; drop any stale offline copy.
    const key = `note:${id}:${epoch ?? '0'}`;
    const offline = new IndexeddbPersistence(key, doc);
    await offline.whenSynced.catch(() => undefined);
    const provider = new HocuspocusProvider({ websocketProvider: websocket(), name: `note:${id}`, document: doc, token: 'access' });
    provider.attach();
    const synced = new Promise<void>(resolve => {
        if (provider.isSynced) resolve();
        provider.on('synced', () => resolve());
    });
    return {
        doc,
        provider,
        offline,
        synced,
        destroy: () => {
            provider.destroy();
            void offline.destroy();
            doc.destroy();
        },
    };
}

// Read-only channel: the server says when this vault's tree changed.
export function watchVault(id: number, onChange: () => void) {
    const provider = new HocuspocusProvider({ websocketProvider: websocket(), name: `vault:${id}`, token: 'access', onStateless: () => onChange() });
    provider.attach();
    return () => provider.destroy();
}
