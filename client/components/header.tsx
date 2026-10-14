// One 60px header shared by every page; pages fill the left, centre and right.
import { IconMoon, IconPencil, IconSun, IconUser } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, type User } from '../api.ts';
import { useTheme } from '../theme.ts';
import { Button, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui.tsx';

export function Header({ left, center, right }: { left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
    return (
        <header id="app-header" className="flex h-[60px] shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-4 print:hidden">
            <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
            {center && <div className="flex min-w-0 items-center">{center}</div>}
            <div className="flex shrink-0 items-center justify-end gap-0.5 lg:flex-1">{right}</div>
        </header>
    );
}

export const DocIcon = ({ className = 'size-[18px]' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 4H9a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V11L18 4Z" />
        <path d="M18 4v5a2 2 0 0 0 2 2h5M12 17h8M12 22h5" />
    </svg>
);

export const HomeLink = ({ className }: { className?: string }) => (
    <Link to="/" aria-label="Docs home" title="Docs" className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}>
        <DocIcon />
    </Link>
);

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
