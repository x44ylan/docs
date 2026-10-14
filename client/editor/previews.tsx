// Diagram (Archify JSON) and Mermaid previews for code blocks, with zoom, pan
// and an expanded view. Ported from the previous Vue components.
import { IconArrowsDiagonal, IconCode, IconFocusCentered, IconMinus, IconPlus, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useTheme } from '../theme.ts';
import { IconButton } from '../ui.tsx';
import { diagram, type Diagram as Model } from './diagram.ts';

type View = [number, number, number, number];

function Panel({ title, expanded, onExpand, onClose, onCode, tools, children }: {
    title: string; expanded: boolean; onExpand?: () => void; onClose: () => void; onCode?: () => void; tools?: ReactNode; children: ReactNode;
}) {
    const panel = (
        <section aria-label={title} className={expanded ? 'flex h-full flex-col' : 'overflow-hidden rounded-lg border bg-background'}>
            <div className="flex items-center gap-0.5 border-b py-1 pr-2 pl-3">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{title}</span>
                {!expanded && onCode && <IconButton label="Show code" onClick={onCode}><IconCode /></IconButton>}
                {tools}
                {!expanded && onExpand && <IconButton label="Expand" onClick={onExpand}><IconArrowsDiagonal /></IconButton>}
                {expanded && <IconButton label="Close" onClick={onClose}><IconX /></IconButton>}
            </div>
            {children}
        </section>
    );
    if (!expanded) return panel;
    return createPortal(
        <div className="fixed inset-0 z-50 flex bg-black/60 sm:p-3" onMouseDown={event => event.target === event.currentTarget && onClose()} onKeyDown={event => event.key === 'Escape' && onClose()}>
            <div role="dialog" aria-modal="true" aria-label={title} className="mx-auto h-full w-full max-w-[1440px] overflow-hidden bg-background sm:rounded-xl sm:border">{panel}</div>
        </div>,
        document.body,
    );
}

export function Diagram({ source, onCode }: { source: string; onCode?: () => void }) {
    const result = useMemo(() => {
        try { return { model: diagram(source), error: '' }; } catch (error) { return { model: undefined, error: error instanceof Error ? error.message : 'Unable to render diagram.' }; }
    }, [source]);
    const model = result.model;
    const [view, setView] = useState<View>(model?.view ?? [0, 0, 1, 1]);
    const [expanded, setExpanded] = useState(false);
    const svg = useRef<SVGSVGElement>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const id = useMemo(() => `d${Math.random().toString(36).slice(2)}`, []);
    useEffect(() => { if (model) setView(model.view); }, [model]);

    const zoom = (factor: number, cx?: number, cy?: number) => setView(([x, y, w, h]) => {
        if (!model) return [x, y, w, h];
        const px = cx ?? x + w / 2, py = cy ?? y + h / 2;
        const scale = Math.min(12, Math.max(0.5, (model.view[2] / w) * factor));
        const ratio = model.view[2] / scale / w;
        return [px - (px - x) * ratio, py - (py - y) * ratio, w * ratio, h * ratio];
    });
    const point = (x: number, y: number) => {
        const matrix = svg.current?.getScreenCTM();
        return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : new DOMPoint();
    };
    const move = (event: React.PointerEvent) => {
        const map = pointers.current;
        if (!map.has(event.pointerId)) return;
        const before = [...map.values()];
        map.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...map.values()];
        const mid = (p: typeof before) => ({ x: p.reduce((n, q) => n + q.x, 0) / p.length, y: p.reduce((n, q) => n + q.y, 0) / p.length });
        const a = point(mid(before).x, mid(before).y), b = point(mid(after).x, mid(after).y);
        if (before.length === 2) {
            const dist = (p: typeof before) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
            if (dist(before) > 2) zoom(dist(after) / dist(before), a.x, a.y);
        }
        setView(([x, y, w, h]) => [x + a.x - b.x, y + a.y - b.y, w, h]);
    };
    const fit = (text: string, width: number, size: number) => (Array.from(text).length * size * 0.6 > width - 16 ? Math.max(1, width - 16) : undefined);
    const tones = ['external', 'backend', 'security'];
    const color = (tone: string) => `diagram-${tone}`;

    return (
        <Panel
            title={model?.title || 'Diagram'}
            expanded={expanded}
            onExpand={model ? () => setExpanded(true) : undefined}
            onClose={() => { setExpanded(false); if (model) setView(model.view); }}
            onCode={onCode}
            tools={model && (
                <>
                    <IconButton label="Zoom out" onClick={() => zoom(0.8)}><IconMinus /></IconButton>
                    <IconButton label="Zoom in" onClick={() => zoom(1.25)}><IconPlus /></IconButton>
                    <IconButton label="Reset view" onClick={() => setView(model.view)}><IconFocusCentered /></IconButton>
                </>
            )}
        >
            {result.error ? <p role="alert" className="m-0 p-4 text-sm text-muted-foreground">{result.error}</p> : model && (
                <div
                    tabIndex={0}
                    role="region"
                    aria-label="Diagram canvas. Drag to pan; use plus, minus and zero to zoom or reset."
                    className={`cursor-grab touch-none outline-none select-none active:cursor-grabbing ${expanded ? 'min-h-0 flex-1' : 'h-[clamp(240px,44vw,440px)] max-h-[60dvh]'}`}
                    onPointerDown={event => { if (event.button) return; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture(event.pointerId); }}
                    onPointerMove={move}
                    onPointerUp={event => pointers.current.delete(event.pointerId)}
                    onPointerCancel={event => pointers.current.delete(event.pointerId)}
                    onWheel={event => {
                        if (!expanded && !event.ctrlKey && !event.metaKey) return;
                        const p = point(event.clientX, event.clientY);
                        zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.006), p.x, p.y);
                    }}
                    onKeyDown={event => {
                        if (event.key === '+' || event.key === '=') zoom(1.25);
                        else if (event.key === '-') zoom(0.8);
                        else if (event.key === '0') setView(model.view);
                        else return;
                        event.preventDefault();
                    }}
                >
                    <svg ref={svg} viewBox={view.join(' ')} role="img" aria-label={model.title} className="block size-full max-w-none">
                        <defs>
                            {tones.map(tone => (
                                <marker key={tone} id={`${id}-${tone}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" className={color(tone)}>
                                    <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                                </marker>
                            ))}
                        </defs>
                        {model.boundaries.map((b, i) => (
                            <g key={`b${i}`}>
                                <rect x={b.x} y={b.y} width={b.width} height={b.height} rx="10" className="diagram-boundary" />
                                <text x={b.x + 10} y={b.y + 16} fontSize="10" className="fill-muted-foreground" textLength={fit(b.label, b.width, 10)} lengthAdjust="spacingAndGlyphs">{b.label}</text>
                            </g>
                        ))}
                        {model.edges.map((e, i) => (
                            <path key={`e${i}`} d={e.path} className={color(e.tone)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={e.dashed ? '6 4' : undefined} markerEnd={`url(#${id}-${e.tone})`} />
                        ))}
                        {model.nodes.map(n => <Box key={n.id} node={n} fit={fit} />)}
                        {model.edges.map((e, i) => e.label && (
                            <text key={`l${i}`} x={e.at[0]} y={e.at[1]} textAnchor="middle" fontSize="10" className="diagram-label">{e.label}</text>
                        ))}
                    </svg>
                </div>
            )}
        </Panel>
    );
}

function Box({ node: n, fit }: { node: Model['nodes'][number]; fit: (t: string, w: number, s: number) => number | undefined }) {
    return (
        <g className={`diagram-${n.tone}`}>
            <title>{[n.label, n.sublabel, n.tag].filter(Boolean).join(' — ')}</title>
            <rect x={n.x} y={n.y} width={n.width} height={n.height} rx="6" className="fill-background" stroke="currentColor" strokeWidth="1.5" />
            <text x={n.x + n.width / 2} y={n.y + n.height / 2 + (n.sublabel ? -2 : 4)} textAnchor="middle" fontSize="12" fontWeight="600" className="fill-foreground" textLength={fit(n.label, n.width, 12)} lengthAdjust="spacingAndGlyphs">{n.label}</text>
            {n.sublabel && <text x={n.x + n.width / 2} y={n.y + n.height / 2 + 14} textAnchor="middle" fontSize="10" className="fill-muted-foreground" textLength={fit(n.sublabel, n.width, 10)} lengthAdjust="spacingAndGlyphs">{n.sublabel}</text>}
            {n.tag && <text x={n.x + n.width / 2} y={n.y + n.height - 6} textAnchor="middle" fontSize="8" className="fill-muted-foreground" textLength={fit(n.tag, n.width, 8)} lengthAdjust="spacingAndGlyphs">{n.tag}</text>}
        </g>
    );
}

export function Mermaid({ source, onCode }: { source: string; onCode?: () => void }) {
    const { dark } = useTheme();
    const frame = useRef<HTMLIFrameElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [status, setStatus] = useState<{ ready: boolean; error: string }>({ ready: false, error: '' });
    const [content, setContent] = useState<{ id: string; html: string }>();
    useEffect(() => {
        let alive = true;
        void import('./mermaid.ts').then(({ mermaid }) => {
            const id = crypto.randomUUID();
            if (alive) setContent({ id, html: mermaid(source, dark, id) });
        });
        return () => { alive = false; };
    }, [source, dark]);
    useEffect(() => {
        if (!content) return;
        setStatus({ ready: false, error: '' });
        const timer = setTimeout(() => setStatus({ ready: false, error: 'Unable to load Mermaid. Reopen the preview to retry.' }), 20_000);
        const listener = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow || event.data?.type !== 'mermaid' || event.data.id !== content.id) return;
            clearTimeout(timer);
            setStatus(event.data.status === 'ready' ? { ready: true, error: '' } : { ready: false, error: String(event.data.error || 'Unable to render diagram.') });
        };
        addEventListener('message', listener);
        return () => { clearTimeout(timer); removeEventListener('message', listener); };
    }, [content]);
    const send = (action: 'in' | 'out' | 'reset') => frame.current?.contentWindow?.postMessage({ type: 'mermaid', action }, '*');
    return (
        <Panel
            title="Mermaid"
            expanded={expanded}
            onExpand={status.ready ? () => setExpanded(true) : undefined}
            onClose={() => setExpanded(false)}
            onCode={onCode}
            tools={status.ready && (
                <>
                    <IconButton label="Zoom out" onClick={() => send('out')}><IconMinus /></IconButton>
                    <IconButton label="Zoom in" onClick={() => send('in')}><IconPlus /></IconButton>
                    <IconButton label="Reset view" onClick={() => send('reset')}><IconFocusCentered /></IconButton>
                </>
            )}
        >
            {status.error && <p role="alert" className="m-0 p-4 text-sm whitespace-pre-wrap text-muted-foreground">{status.error}</p>}
            {!status.error && !status.ready && <p role="status" className="m-0 p-4 text-sm text-muted-foreground">Rendering diagram…</p>}
            <iframe
                ref={frame}
                title="Mermaid preview"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={content?.html ?? ''}
                hidden={!!status.error}
                className={`block w-full border-0 ${expanded ? 'min-h-0 flex-1' : 'h-[clamp(240px,44vw,440px)] max-h-[60dvh]'}`}
            />
        </Panel>
    );
}

// Mount a preview into a plain DOM node (used by the code block node view).
export function mountPreview(element: HTMLElement) {
    const root = createRoot(element);
    return {
        render: (language: string, source: string, onCode: () => void) =>
            root.render(language === 'mermaid' ? <Mermaid source={source} onCode={onCode} /> : <Diagram source={source} onCode={onCode} />),
        unmount: () => queueMicrotask(() => root.unmount()),
    };
}
