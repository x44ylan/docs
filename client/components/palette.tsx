// Cmd/Ctrl+K: jump to any note or vault, or run an action.
import { IconFileText, IconFolder, IconSearch } from '@tabler/icons-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Home } from '../api.ts';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui.tsx';

export type Action = { label: string; icon: React.ReactNode; run: () => void };
type Result = { id: number; vault_id: number; vault: string; name: string; snippet: string };

export function Palette({ open, onOpenChange, actions = [], vaultId }: { open: boolean; onOpenChange: (open: boolean) => void; actions?: Action[]; vaultId?: number }) {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Result[]>([]);
    const [vaults, setVaults] = useState<Home['vaults']>([]);
    useEffect(() => {
        if (!open) return setQuery('');
        void api<Home>('/home', { quiet: true }).then(home => setVaults(home.vaults));
    }, [open]);
    useEffect(() => {
        if (!query.trim()) return setResults([]);
        const timer = setTimeout(async () => setResults(await api<Result[]>(`/search?q=${encodeURIComponent(query)}`, { quiet: true })), 120);
        return () => clearTimeout(timer);
    }, [query]);
    const go = (to: string) => { onOpenChange(false); navigate(to); };
    const sorted = [...results].sort((a, b) => Number(b.vault_id === vaultId) - Number(a.vault_id === vaultId));
    return (
        <D.Root open={open} onOpenChange={onOpenChange}>
            <D.Portal>
                <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
                <D.Content aria-describedby={undefined} className="fixed top-0 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden border-b bg-popover shadow-lg outline-none sm:top-[12vh] sm:w-[calc(100vw-1rem)] sm:rounded-xl sm:border">
                    <D.Title className="sr-only">Search</D.Title>
                    <Command shouldFilter={false} loop>
                        <div className="flex items-center gap-2 px-3 [&_input]:border-0">
                            <IconSearch className="size-4 shrink-0 text-muted-foreground" />
                            <CommandInput autoFocus placeholder="Search notes" value={query} onValueChange={setQuery} className="px-0" />
                        </div>
                        <CommandList className="border-t">
                            {query && <CommandEmpty>No results</CommandEmpty>}
                            {!!sorted.length && (
                                <CommandGroup heading="Notes">
                                    {sorted.map(result => (
                                        <CommandItem key={result.id} value={`note-${result.id}`} onSelect={() => go(`/vaults/${result.vault_id}?file=${result.id}`)}>
                                            <IconFileText />
                                            <span className="flex min-w-0 flex-col py-1">
                                                <span className="truncate">{result.name}<span className="text-muted-foreground"> · {result.vault}</span></span>
                                                {result.snippet && <span className="truncate text-xs text-muted-foreground">{result.snippet}</span>}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            {!query && !!actions.length && (
                                <CommandGroup heading="Actions">
                                    {actions.map(action => (
                                        <CommandItem key={action.label} onSelect={() => { onOpenChange(false); action.run(); }}>{action.icon}{action.label}</CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            <CommandGroup heading="Vaults">
                                {vaults.filter(v => v.name.toLowerCase().includes(query.trim().toLowerCase())).map(vault => (
                                    <CommandItem key={vault.id} value={`vault-${vault.id}`} onSelect={() => go(`/vaults/${vault.id}`)}><IconFolder />{vault.name}</CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </D.Content>
            </D.Portal>
        </D.Root>
    );
}
