// Adapted from Archify's architecture/grid, roundedPath, anchor and labelPoint
// helpers at 9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993 (MIT).
// See public/assets/archify.txt. No CLI, HTML template or viewer is bundled.
type Point = [number, number];
type Data = Record<string, unknown>;
type Box = { x: number; y: number; width: number; height: number };
type Component = Box & { id: string; label: string; sublabel: string; tag: string; tone: string };
type Edge = { path: string; label: string; at: Point; tone: string; dashed: boolean };
type Boundary = Box & { label: string };
export type Diagram = { title: string; view: [number, number, number, number]; nodes: Component[]; edges: Edge[]; boundaries: Boundary[] };

function object(value: unknown, name: string): Data {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
    return value as Data;
}
function list(value: unknown, name: string, limit: number): unknown[] {
    if (!Array.isArray(value) || value.length > limit) throw new Error(`${name} must be an array with at most ${limit} items.`);
    return value;
}
function text(value: unknown, name: string, fallback?: string): string {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || !value.length || value.length > 240) throw new Error(`${name} must contain 1–240 characters.`);
    return value;
}
function number(value: unknown, name: string, fallback?: number): number {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100000) throw new Error(`${name} must be a finite coordinate between -100000 and 100000.`);
    return value;
}
function point(value: unknown, name: string): Point {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`${name} must be [x, y].`);
    return [number(value[0], name), number(value[1], name)];
}
function choice(value: unknown, choices: string[], name: string, fallback: string): string {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`Unsupported ${name}. Use ${choices.join(', ')}.`);
    return value;
}
function anchor(box: Box, side: string): Point {
    switch (side) {
        case 'left': return [box.x, box.y + box.height / 2];
        case 'right': return [box.x + box.width, box.y + box.height / 2];
        case 'top': return [box.x + box.width / 2, box.y];
        default: return [box.x + box.width / 2, box.y + box.height];
    }
}
// Archify's rounded polyline construction, with duplicate points removed.
function roundedPath(raw: Point[]): string {
    const points = raw.filter((p, i) => !i || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
    const commands = [`M ${points[0][0]} ${points[0][1]}`];
    for (let i = 1; i < points.length - 1; i++) {
        const [px, py] = points[i - 1];
        const [cx, cy] = points[i];
        const [nx, ny] = points[i + 1];
        const prevLen = Math.hypot(cx - px, cy - py);
        const nextLen = Math.hypot(nx - cx, ny - cy);
        const r = Math.min(8, prevLen / 2, nextLen / 2);
        const before = [cx - ((cx - px) / prevLen) * r, cy - ((cy - py) / prevLen) * r];
        const after = [cx + ((nx - cx) / nextLen) * r, cy + ((ny - cy) / nextLen) * r];
        commands.push(`L ${before[0]} ${before[1]}`, `Q ${cx} ${cy} ${after[0]} ${after[1]}`);
    }
    const end = points[points.length - 1];
    commands.push(`L ${end[0]} ${end[1]}`);
    return commands.join(' ');
}

export function diagram(source: string): Diagram {
    if (source.length > 100000) throw new Error('Diagram JSON is limited to 100,000 characters.');
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { throw new Error('Invalid JSON. Edit the code to finish your diagram.'); }
    const input = object(parsed, 'Diagram');
    if (input.schema_version !== undefined && input.schema_version !== 1) throw new Error('Only schema_version 1 is supported.');
    if (input.diagram_type !== 'architecture') throw new Error('Only architecture diagrams are supported here.');
    const meta = object(input.meta ?? {}, 'meta');
    const grid = input.layout === undefined ? undefined : object(input.layout, 'layout');
    if (grid && grid.mode !== 'grid') throw new Error('Use layout.mode "grid", or omit layout and set component positions.');
    const origin = point(grid?.origin ?? [40, 80], 'grid origin');
    const nodes: Component[] = list(input.components, 'components', 150).map((value, i) => {
        const c = object(value, `Component ${i + 1}`);
        const id = text(c.id, 'Component id');
        let pos: Point;
        if (c.pos !== undefined) pos = point(c.pos, `${id} pos`);
        else if (grid) {
            const row = number(c.row, `${id} row`), col = number(c.col, `${id} col`);
            const cols = number(grid.cols, 'grid cols', 4);
            if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || col >= cols) throw new Error(`${id} needs valid non-negative grid row/col.`);
            pos = [origin[0] + col * (number(grid.cellW, 'cellW', 130) + number(grid.gapX, 'gapX', 30)), origin[1] + row * (number(grid.cellH, 'cellH', 64) + number(grid.gapY, 'gapY', 40))];
        } else throw new Error(`${id} needs pos [x, y].`);
        const size = point(c.size ?? [120, 60], `${id} size`);
        if (size.some(n => n < 20 || n > 20000)) throw new Error(`${id} size must be between 20 and 20000.`);
        return { id, x: pos[0], y: pos[1], width: size[0], height: size[1],
            label: text(c.label, `${id} label`), sublabel: c.sublabel === '' ? '' : text(c.sublabel, 'sublabel', ''), tag: c.tag === '' ? '' : text(c.tag, 'tag', ''),
            tone: choice(c.type, ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'], 'component type', 'external') };
    });
    if (!nodes.length) throw new Error('Add at least one component.');
    const byId = new Map(nodes.map(n => [n.id, n]));
    if (byId.size !== nodes.length) throw new Error('Component IDs must be unique.');
    const bounds: Box[] = [...nodes];
    const boundaries = list(input.boundaries ?? [], 'boundaries', 40).map(value => {
        const b = object(value, 'Boundary');
        const members = list(b.wraps, 'boundary wraps', 150).map(id => {
            const node = byId.get(text(id, 'wrapped component'));
            if (!node) throw new Error(`Unknown boundary component: ${id}.`);
            return node;
        });
        if (!members.length) throw new Error('A boundary must wrap at least one component.');
        const pad = number(b.pad, 'boundary pad', 30);
        if (pad < 20 || pad > 1000) throw new Error('Boundary padding must be between 20 and 1000.');
        const x = Math.min(...members.map(n => n.x)) - pad;
        const y = Math.min(...members.map(n => n.y)) - pad;
        const box = { x, y, width: Math.max(...members.map(n => n.x + n.width)) + pad - x,
            height: Math.max(...members.map(n => n.y + n.height)) + pad - y, label: text(b.label, 'boundary label', '') };
        bounds.push(box);
        return box;
    });
    const edges: Edge[] = list(input.connections ?? [], 'connections', 300).map(value => {
        const c = object(value, 'Connection');
        const from = byId.get(text(c.from, 'connection from')), to = byId.get(text(c.to, 'connection to'));
        if (!from || !to) throw new Error('A connection references a missing component.');
        const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
        const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
        const sides = ['left', 'right', 'top', 'bottom', 'auto'];
        let fs = choice(c.fromSide, sides, 'fromSide', 'auto');
        let ts = choice(c.toSide, sides, 'toSide', 'auto');
        if (fs === 'auto') fs = dx < 0 ? 'left' : dx > 0 ? 'right' : dy > 0 ? 'bottom' : 'top';
        if (ts === 'auto') ts = dx < 0 ? 'right' : dx > 0 ? 'left' : dy > 0 ? 'top' : 'bottom';
        const start = anchor(from, fs), end = anchor(to, ts);
        const route = choice(c.route, ['auto', 'straight', 'orthogonal-h', 'orthogonal-v'], 'route', 'auto');
        let via: Point[] = [];
        if (c.via !== undefined) via = list(c.via, 'via', 40).map(p => point(p, 'via point'));
        else if (from === to) {
            // Keep self-loops outside their box.
            start.splice(0, 2, from.x + from.width, from.y + from.height / 2);
            end.splice(0, 2, from.x + from.width / 2, from.y);
            via = [[from.x + from.width + 32, start[1]], [from.x + from.width + 32, from.y - 32], [end[0], from.y - 32]];
        } else if (route !== 'straight' && (route !== 'auto' || (start[0] !== end[0] && start[1] !== end[1]))) {
            if (route === 'orthogonal-v' || (route === 'auto' && ['top', 'bottom'].includes(fs))) {
                const mid = (start[1] + end[1]) / 2;
                via = [[start[0], mid], [end[0], mid]];
            } else {
                const mid = (start[0] + end[0]) / 2;
                via = [[mid, start[1]], [mid, end[1]]];
            }
        }
        const points = [start, ...via, end];
        points.forEach(([x, y]) => bounds.push({ x, y, width: 0, height: 0 }));
        const segment = Math.min(points.length - 2, Math.max(0, Math.floor(number(c.labelSegment, 'labelSegment', points.length === 2 ? 0 : 1))));
        const a = points[segment], b = points[segment + 1];
        const at = c.labelAt !== undefined ? point(c.labelAt, 'labelAt') : [(a[0] + b[0]) / 2 + number(c.labelDx, 'labelDx', 0), (a[1] + b[1]) / 2 - 10 + number(c.labelDy, 'labelDy', 0)] as Point;
        const label = c.label === '' ? '' : text(c.label, 'connection label', '');
        if (label) bounds.push({ x: at[0] - label.length * 3, y: at[1] - 12, width: label.length * 6, height: 18 });
        const variant = choice(c.variant, ['default', 'emphasis', 'security', 'dashed'], 'connection variant', 'default');
        return { path: roundedPath(points), label, at, tone: variant === 'emphasis' ? 'backend' : variant === 'security' ? 'security' : 'external', dashed: variant === 'dashed' };
    });
    const authored = meta.viewBox === undefined ? [0, 0] : point(meta.viewBox, 'viewBox');
    if (authored.some(n => n < 0)) throw new Error('viewBox dimensions must be positive.');
    const x = Math.min(0, ...bounds.map(b => b.x - 24)), y = Math.min(0, ...bounds.map(b => b.y - 24));
    const width = Math.max(authored[0], ...bounds.map(b => b.x + b.width + 24)) - x;
    const height = Math.max(authored[1], ...bounds.map(b => b.y + b.height + 24)) - y;
    return { title: text(meta.title, 'title', 'Diagram'), view: [x, y, width, height], nodes, edges, boundaries };
}
