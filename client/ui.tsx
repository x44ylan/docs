// shadcn-style primitives on Radix, sized for the 36px icon header.
import { clsx, type ClassValue } from 'clsx';
import { Command as Cmdk } from 'cmdk';
import { Dialog as D, DropdownMenu as M, Popover as P } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'outline' | 'destructive'; icon?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'default', icon, type = 'button', ...props }, ref) => (
    <button
        ref={ref}
        type={type}
        className={cn(
            'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
            icon ? 'size-9' : 'h-9 px-3',
            variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
            variant === 'ghost' && 'text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:text-foreground',
            variant === 'outline' && 'border bg-transparent hover:bg-accent',
            variant === 'destructive' && 'bg-destructive text-white hover:bg-destructive/90',
            className,
        )}
        {...props}
    />
));

// Icon-only button: the label is for screen readers and the tooltip.
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(({ label, ...props }, ref) => (
    <Button ref={ref} variant="ghost" icon aria-label={label} title={label} {...props} />
));

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn('h-9 w-full rounded-md bg-muted px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm', className)}
        {...props}
    />
));

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ className, align = 'end', ...props }: ComponentProps<typeof M.Content>) {
    return (
        <M.Portal>
            <M.Content
                align={align}
                sideOffset={6}
                collisionPadding={8}
                className={cn('z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0', className)}
                {...props}
            />
        </M.Portal>
    );
}
export function MenuItem({ className, destructive, ...props }: ComponentProps<typeof M.Item> & { destructive?: boolean }) {
    return (
        <M.Item
            className={cn(
                'flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 sm:min-h-8 [&_svg]:size-4 [&_svg]:text-muted-foreground',
                destructive && 'text-destructive [&_svg]:text-destructive',
                className,
            )}
            {...props}
        />
    );
}
export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />;

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, align = 'end', ...props }: ComponentProps<typeof P.Content>) {
    return (
        <P.Portal>
            <P.Content
                align={align}
                sideOffset={6}
                collisionPadding={8}
                className={cn('z-50 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none', className)}
                {...props}
            />
        </P.Portal>
    );
}

export function Dialog({ open, onOpenChange, title, children, className, top }: {
    open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; className?: string; top?: boolean;
}) {
    return (
        <D.Root open={open} onOpenChange={onOpenChange}>
            <D.Portal>
                <D.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <D.Content
                    aria-describedby={undefined}
                    className={cn(
                        'fixed left-1/2 z-50 w-[calc(100vw-1rem)] max-w-md -translate-x-1/2 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none',
                        top ? 'top-2 sm:top-[12vh]' : 'top-1/2 -translate-y-1/2',
                        className,
                    )}
                >
                    <D.Title className="mb-3 text-base font-semibold">{title}</D.Title>
                    {children}
                </D.Content>
            </D.Portal>
        </D.Root>
    );
}

export const Command = ({ className, ...props }: ComponentProps<typeof Cmdk>) => (
    <Cmdk className={cn('flex flex-col overflow-hidden', className)} {...props} />
);
export const CommandInput = ({ className, ...props }: ComponentProps<typeof Cmdk.Input>) => (
    <Cmdk.Input className={cn('h-11 w-full border-b bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground sm:text-sm', className)} {...props} />
);
export const CommandList = ({ className, ...props }: ComponentProps<typeof Cmdk.List>) => (
    <Cmdk.List className={cn('max-h-[min(60dvh,24rem)] overflow-y-auto p-1', className)} {...props} />
);
export const CommandEmpty = (props: ComponentProps<typeof Cmdk.Empty>) => (
    <Cmdk.Empty className="px-3 py-6 text-center text-sm text-muted-foreground" {...props} />
);
export const CommandGroup = ({ className, ...props }: ComponentProps<typeof Cmdk.Group>) => (
    <Cmdk.Group className={cn('[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />
);
export const CommandItem = ({ className, ...props }: ComponentProps<typeof Cmdk.Item>) => (
    <Cmdk.Item
        className={cn('flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[selected=true]:bg-accent sm:min-h-9 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground', className)}
        {...props}
    />
);
