import { useEffect, useState } from 'react';
import { cn } from '../ui.tsx';

export type Heading = { id: string; text: string; level: number };

export function Contents({ headings, onJump, inline = false }: { headings: Heading[]; onJump: (id: string) => void; inline?: boolean }) {
    const [active, setActive] = useState('');
    useEffect(() => {
        const elements = headings.map(h => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
        const root = elements[0]?.closest('main');
        if (!root || !elements.length) return;
        let frame = 0;
        const update = () => {
            frame = 0;
            const top = root.getBoundingClientRect().top + 32;
            let current = elements[0];
            for (const element of elements) {
                if (element.getBoundingClientRect().top <= top) current = element;
            }
            if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = elements[elements.length - 1];
            setActive(current.id);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
        update();
        root.addEventListener('scroll', schedule, { passive: true });
        const resize = new ResizeObserver(schedule);
        resize.observe(root);
        if (root.firstElementChild) resize.observe(root.firstElementChild);
        return () => { root.removeEventListener('scroll', schedule); resize.disconnect(); cancelAnimationFrame(frame); };
    }, [headings]);
    return (
        <ul aria-label="Contents" className={inline ? 'w-full border-l' : 'max-h-[60dvh] w-64 overflow-y-auto'}>
            {headings.map(h => (
                <li key={h.id}>
                    <button type="button" aria-current={active === h.id ? 'location' : undefined} title={h.text} onClick={() => onJump(h.id)} style={{ paddingLeft: (inline ? 16 : 8) + (h.level - 1) * 12 }} className={cn('flex min-h-9 w-full items-center border-l-2 py-1 pr-2 text-left text-sm hover:text-foreground sm:min-h-8', inline && '-ml-px', active === h.id ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground')}>
                        <span className="min-w-0 break-words">{h.text}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

export function PageOutline({ headings }: { headings: Heading[] }) {
    return (
        <nav aria-label="On this page" className="page-outline hidden xl:block mr-10 sticky top-0 max-h-[calc(100dvh-3.5rem)] w-[14.5rem] shrink-0 self-start overflow-y-auto overscroll-contain pr-6 pt-10 pb-6 print:hidden">
            <h2 className="mb-3 pl-4 text-sm font-semibold">On this page</h2>
            <Contents headings={headings} inline onJump={id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        </nav>
    );
}
