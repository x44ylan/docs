// Home: vaults first, then pinned and recent notes.
import { IconDots, IconDownload, IconFileText, IconFolder, IconPencil, IconPin, IconPlus, IconTrash, IconUpload, IconUsers, IconWorld } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, cache, cached, type Home as HomeData } from '../api.ts';
import { BarSearch, Header, UserMenu } from '../components/header.tsx';
import { title } from '../theme.ts';
import { Button, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui.tsx';

export function Home() {
    const navigate = useNavigate();
    const [data, setData] = useState<HomeData | undefined>(() => cached('home'));
    const [filter, setFilter] = useState('');
    const [searching, setSearching] = useState(false);
    const [dialog, setDialog] = useState<{ kind: 'new' | 'rename'; id?: number; name: string } | null>(null);
    const upload = useRef<HTMLInputElement>(null);

    const load = () => api<HomeData>('/home').then(next => { setData(next); cache('home', next); });
    useEffect(() => { title(); void load(); }, []);

    const vaults = (data?.vaults ?? []).filter(v => v.name.toLowerCase().includes(filter.trim().toLowerCase()));

    async function importZip(file: File) {
        const form = new FormData();
        form.set('file', file);
        const vault = await api<{ id: number }>('/import', { form });
        navigate(`/vaults/${vault.id}`);
    }

    return (
        <div className="flex h-dvh flex-col">
            <Header
                title="Docs"
                actions={
                    <>
                        <IconButton label="Import vault" onClick={() => upload.current?.click()}><IconUpload /></IconButton>
                        <IconButton label="New vault" onClick={() => setDialog({ kind: 'new', name: '' })}><IconPlus /></IconButton>
                    </>
                }
                search={() => setSearching(true)}
                account={<UserMenu user={data?.user} onRenamed={name => data && setData({ ...data, user: { ...data.user, name } })} />}
                replace={searching ? <BarSearch label="Find a vault" value={filter} onChange={setFilter} onClose={() => { setFilter(''); setSearching(false); }} /> : undefined}
            />
            <input ref={upload} type="file" accept=".zip" hidden onChange={event => event.target.files?.[0] && void importZip(event.target.files[0])} />
            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl space-y-8 px-3 py-4 sm:px-6 sm:py-8">
                    <section aria-label="Vaults">
                        {data && !data.vaults.length ? (
                            <div className="flex flex-col items-center rounded-lg border border-dashed px-5 py-14 text-center">
                                <IconFolder className="mb-4 size-7 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Create a vault to start writing.</p>
                                <Button className="mt-4" onClick={() => setDialog({ kind: 'new', name: '' })}><IconPlus />New vault</Button>
                            </div>
                        ) : (
                            <ul className="divide-y overflow-hidden rounded-lg border">
                                {vaults.map(vault => (
                                    <li key={vault.id} className="flex items-center pr-1 hover:bg-accent/50">
                                        <Link to={`/vaults/${vault.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                                            <IconFolder className="size-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm font-medium">{vault.name}</span>
                                            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={`${vault.notes} notes`}>
                                                {vault.public ? <IconWorld className="size-3.5" aria-label="Everyone" /> : vault.shared || vault.owner_id !== data?.user.id ? <IconUsers className="size-3.5" aria-label="Shared" /> : null}
                                                <span>{vault.notes}</span>
                                            </span>
                                        </Link>
                                        <Menu>
                                            <MenuTrigger asChild><IconButton label={`Actions for ${vault.name}`}><IconDots /></IconButton></MenuTrigger>
                                            <MenuContent>
                                                <MenuItem onSelect={() => setDialog({ kind: 'rename', id: vault.id, name: vault.name })}><IconPencil />Rename</MenuItem>
                                                <MenuItem onSelect={() => { location.href = `/api/vaults/${vault.id}/export`; }}><IconDownload />Export</MenuItem>
                                                <MenuItem destructive onSelect={async () => {
                                                    const owner = vault.owner_id === data?.user.id;
                                                    if (!confirm(owner ? `Delete ${vault.name} and all its notes?` : `Leave ${vault.name}?`)) return;
                                                    await api(`/vaults/${vault.id}`, { method: 'DELETE' });
                                                    void load();
                                                }}><IconTrash />{vault.owner_id === data?.user.id ? 'Delete' : 'Leave'}</MenuItem>
                                            </MenuContent>
                                        </Menu>
                                    </li>
                                ))}
                                {data && !vaults.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching vaults</li>}
                            </ul>
                        )}
                    </section>
                    {!!data?.pins.length && <NoteList label="Pinned" icon={<IconPin />} notes={data.pins} />}
                    {!!data?.recent.length && <NoteList label="Recent" icon={<IconFileText />} notes={data.recent} />}
                </div>
            </main>
            <Dialog open={!!dialog} onOpenChange={open => !open && setDialog(null)} title={dialog?.kind === 'new' ? 'New vault' : 'Rename'}>
                <form
                    className="flex gap-2"
                    onSubmit={async event => {
                        event.preventDefault();
                        if (!dialog) return;
                        if (dialog.kind === 'new') {
                            const vault = await api<{ id: number }>('/vaults', { body: { name: dialog.name } });
                            navigate(`/vaults/${vault.id}`);
                        } else {
                            await api(`/vaults/${dialog.id}`, { method: 'PATCH', body: { name: dialog.name } });
                            setDialog(null);
                            void load();
                        }
                    }}
                >
                    <Input autoFocus aria-label="Name" maxLength={255} value={dialog?.name ?? ''} onChange={event => dialog && setDialog({ ...dialog, name: event.target.value })} />
                    <Button type="submit">{dialog?.kind === 'new' ? 'Create' : 'Save'}</Button>
                </form>
            </Dialog>
        </div>
    );
}

function NoteList({ label, icon, notes }: { label: string; icon: React.ReactNode; notes: { id: number; vault_id: number; vault: string; name: string }[] }) {
    // Phones show only vaults, as on the previous home page.
    return (
        <section aria-label={label} className="max-sm:hidden">
            <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">{icon}{label}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {notes.map(note => (
                    <Link key={note.id} to={`/vaults/${note.vault_id}?file=${note.id}`} className="flex min-w-0 flex-col rounded-lg border px-3 py-2.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="truncate text-sm font-medium">{note.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{note.vault}</span>
                    </Link>
                ))}
            </div>
        </section>
    );
}
