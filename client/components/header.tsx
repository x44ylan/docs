// One 56px top bar for every page, the same layout everywhere:
//   [mark → home] [sidebar] Vault / Parent / Note   [centre]   [page actions] [⋯] [account]
// Every page action lives in its ⋯ menu; only Read/Edit and formatting stay out.
// Pages pass their own pieces; spacing, sizes and order stay identical.
import { IconChevronDown, IconDots, IconMoon, IconPencil, IconSearch, IconSun, IconUser, IconX } from '@tabler/icons-react';
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, type User } from '../api.ts';
import { useTheme } from '../theme.ts';
import { Button, cn, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui.tsx';

// A step in the path. The last one is the current page.
export type Crumb = { label: string; onClick?: () => void };

export function Header({ brand, lead, crumbs, onTitle, center, actions, account, replace }: {
    // Public pages show the mark without linking home (visitors cannot sign in).
    brand?: ReactNode;
    lead?: ReactNode;
    crumbs: Crumb[];
    // On phones only the current page shows; tapping it opens the notes tree.
    onTitle?: () => void;
    center?: ReactNode;
    actions?: ReactNode;
    account?: ReactNode;
    // Takes over the whole bar (find in note, search, phone formatting strip).
    replace?: ReactNode;
}) {
    return (
        <header id="app-header" className="flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur sm:px-3 print:hidden">
            {replace ?? (
                <>
                    <div className="flex min-w-0 flex-1 items-center gap-0.5">
                        {brand ?? <HomeLink />}
                        {lead}
                        <Crumbs items={crumbs} onTitle={onTitle} tight={!!center} />
                    </div>
                    {center && <div className="flex min-w-0 items-center">{center}</div>}
                    <div className="flex shrink-0 items-center justify-end gap-0.5 lg:flex-1">
                        {actions}
                        {account}
                    </div>
                </>
            )}
        </header>
    );
}

const step = 'h-8 min-w-0 truncate rounded-md px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Vault / Parent / Note. Long paths fold the middle into "…" (all of it when the
// toolbar shares the bar); phones show only the current page.
function Crumbs({ items, onTitle, tight }: { items: Crumb[]; onTitle?: () => void; tight?: boolean }) {
    const current = items.at(-1);
    const parents = items.slice(0, -1);
    const keep = tight ? 1 : 2;
    const folded = parents.length > keep ? parents.slice(1, tight ? undefined : -1) : [];
    const shown: (Crumb | null)[] = !folded.length ? parents : tight ? [parents[0], null] : [parents[0], null, parents.at(-1)!];
    const slash = <span className="px-0.5 text-sm text-muted-foreground/50" aria-hidden="true">/</span>;
    return (
        <nav aria-label="Breadcrumb" className="ml-1 flex min-w-0 flex-1 items-center">
            {shown.map((crumb, i) => (
                <Fragment key={i}>
                    <span className={cn("hidden min-w-0 items-center sm:flex", i === 0 ? "shrink-0" : "shrink")}>
                        {crumb ? (
                            crumb.onClick
                                ? <button type="button" onClick={crumb.onClick} className={cn(step, 'max-w-40 text-muted-foreground hover:bg-accent hover:text-foreground')}>{crumb.label}</button>
                                : <span className={cn(step, 'flex max-w-40 items-center text-muted-foreground')}>{crumb.label}</span>
                        ) : (
                            <Menu>
                                <MenuTrigger asChild><IconButton label="Show path" className="size-8"><IconDots /></IconButton></MenuTrigger>
                                <MenuContent align="start">
                                    {folded.map((c, j) => <MenuItem key={j} disabled={!c.onClick} onSelect={c.onClick}>{c.label}</MenuItem>)}
                                </MenuContent>
                            </Menu>
                        )}
                    </span>
                    <span className="hidden sm:inline">{slash}</span>
                </Fragment>
            ))}
            {current && (onTitle
                ? (
                    <button type="button" onClick={onTitle} aria-label={`${current.label}, show notes`} className={cn(step, 'flex items-center gap-1 font-medium hover:bg-accent')}>
                        <span className="truncate">{current.label}</span>
                        <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                )
                : <span aria-current="page" className={cn(step, 'flex items-center font-medium')}><span className="truncate">{current.label}</span></span>)}
        </nav>
    );
}

export const DocIcon = ({ className = 'size-[18px]' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 4H9a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V11L18 4Z" />
        <path d="M18 4v5a2 2 0 0 0 2 2h5M12 17h8M12 22h5" />
    </svg>
);

// "Text initial" formatting icon (Lucide, ISC), drawn like Tabler icons.
export const FormatIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 5h6M15 12h6M3 19h18M3 12l3.553-7.724a.5.5 0 0 1 .894 0L11 12M3.92 10h6.16" />
    </svg>
);

export const HomeLink = ({ className }: { className?: string }) => (
    <Link to="/" aria-label="Docs home" title="Docs" className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}>
        <DocIcon />
    </Link>
);

// Header-sized dot for the offline state (sits with the page actions).
export const OfflineDot = () => (
    <span className="flex size-9 items-center justify-center" role="status" aria-label="Offline" title="Offline. Changes will sync when you reconnect.">
        <span className="size-2 rounded-full bg-amber-500" />
    </span>
);

// Search field that takes over the bar: icon, input, then extras and close,
// laid out like the regular bar (same height, padding and button sizes).
export function BarSearch({ label, value, onChange, onClose, onKeyDown, inputRef, children }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onClose: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    inputRef?: React.Ref<HTMLInputElement>;
    children?: ReactNode;
}) {
    return (
        <div role="search" className="flex min-w-0 flex-1 items-center gap-0.5">
            <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"><IconSearch className="size-4" /></span>
            <input
                ref={inputRef}
                autoFocus
                type="search"
                aria-label={label}
                placeholder={label}
                value={value}
                onChange={event => onChange(event.target.value)}
                onKeyDown={event => { onKeyDown?.(event); if (event.key === 'Escape') onClose(); }}
                className="h-9 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground sm:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {children}
            <IconButton label={`Close ${label.toLowerCase()}`} onClick={onClose}><IconX /></IconButton>
        </div>
    );
}

export function UserMenu({ user, onRenamed }: { user?: User; onRenamed?: (name: string) => void }) {
    const { dark, toggle } = useTheme();
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(user?.name ?? '');
    return (
        <>
            <Menu>
                <MenuTrigger asChild>
                    <IconButton label="User menu"><IconUser /></IconButton>
                </MenuTrigger>
                <MenuContent className="w-60">
                    {user && (
                        <div className="flex min-w-0 flex-col px-2 py-2">
                            <span className="truncate text-sm font-semibold">{user.name}</span>
                            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                        </div>
                    )}
                    <MenuSeparator />
                    <MenuItem onSelect={() => { setName(user?.name ?? ''); setRenaming(true); }}><IconPencil />Rename</MenuItem>
                    <MenuItem onSelect={toggle}>{dark ? <IconSun /> : <IconMoon />}{dark ? 'Light mode' : 'Dark mode'}</MenuItem>
                </MenuContent>
            </Menu>
            <Dialog open={renaming} onOpenChange={setRenaming} title="Rename">
                <form
                    className="flex gap-2"
                    onSubmit={async event => {
                        event.preventDefault();
                        const result = await api<{ name: string }>('/me', { method: 'PATCH', body: { name } });
                        onRenamed?.(result.name);
                        setRenaming(false);
                    }}
                >
                    <Input autoFocus value={name} onChange={event => setName(event.target.value)} aria-label="Name" maxLength={255} />
                    <Button type="submit">Save</Button>
                </form>
            </Dialog>
        </>
    );
}
