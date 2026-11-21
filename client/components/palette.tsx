// Cmd/Ctrl+K: jump to any note or vault, or run an action.
import { IconFileText, IconFolder, IconSearch } from '@tabler/icons-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Home } from '../api.ts';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui.tsx';

export type Action = { label: string; icon: React.ReactNode; run: () => void };
type Result = { id: number; vault_id: number; vault: string; name: string; snippet: string };

export function Palette({ open, onOpenChange, actions = [], vaultId, vaultsOnly = false }: { open: boolean; onOpenChange: (open: boolean) => void; actions?: Action[]; vaultId?: number; vaultsOnly?: boolean }) {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Result[]>([]);
    const [vaults, setVaults] = useState<Home['vaults']>([]);
    const [vaultError, setVaultError] = useState(false);
    useEffect(() => {
        if (!open) return setQuery('');
        let active = true;
        setVaultError(false);
        void api<Home>('/home', { quiet: true }).then(home => { if (active) setVaults(home.vaults); }).catch(() => { if (active) setVaultError(true); });
        return () => { active = false; };
    }, [open]);
    useEffect(() => {
        if (vaultsOnly || !query.trim()) return setResults([]);
        const timer = setTimeout(async () => setResults(await api<Result[]>(`/search?q=${encodeURIComponent(query)}`, { quiet: true })), 120);
        return () => clearTimeout(timer);
    }, [query, vaultsOnly]);
    const go = (to: string) => { onOpenChange(false); navigate(to); };
    const sorted = [...results].sort((a, b) => Number(b.vault_id === vaultId) - Number(a.vault_id === vaultId));
    return (
        <D.Root open={open} onOpenChange={onOpenChange}>
            <D.Portal>
                <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
                <D.Content aria-describedby={undefined} className="fixed top-0 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden border-b bg-popover shadow-lg outline-none sm:top-[12vh] sm:w-[calc(100vw-1rem)] sm:rounded-xl sm:border">
                    <D.Title className="sr-only">{vaultsOnly ? 'Switch vault' : 'Search'}</D.Title>
                    <Command shouldFilter={false} loop>
                        <div className="flex items-center gap-2 px-3 [&_input]:border-0">
                            <IconSearch className="size-4 shrink-0 text-muted-foreground" />
                            <CommandInput autoFocus placeholder={vaultsOnly ? 'Find a vault' : 'Search notes'} value={query} onValueChange={setQuery} className="px-0" />
                        </div>
                        <CommandList className="border-t">
                            {query && <CommandEmpty>No results</CommandEmpty>}
                            {!vaultsOnly && !!sorted.length && (
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
                            {!vaultsOnly && !query && !!actions.length && (
                                <CommandGroup heading="Actions">
                                    {actions.map(action => (
                                        <CommandItem key={action.label} onSelect={() => { onOpenChange(false); action.run(); }}>{action.icon}{action.label}</CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            {vaultError && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">Could not refresh vaults. Close and reopen to retry.</p>}
                            <CommandGroup heading="Vaults">
                                {vaults.filter(v => v.name.toLowerCase().includes(query.trim().toLowerCase())).map(vault => (
                                    <CommandItem key={vault.id} value={`vault-${vault.id}`} onSelect={() => vaultsOnly && vault.id === vaultId ? onOpenChange(false) : go(`/vaults/${vault.id}`)}><IconFolder /><span className="min-w-0 truncate">{vault.name}</span>{vaultsOnly && vault.id === vaultId && <span className="ml-auto text-xs text-muted-foreground">Current</span>}</CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </D.Content>
            </D.Portal>
        </D.Root>
    );
}
