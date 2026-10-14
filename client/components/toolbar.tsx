// Formatting toolbar: centred on desktop, a swipeable strip on phones.
import { IconArrowBackUp, IconArrowForwardUp, IconBold, IconCode, IconH1, IconH2, IconH3, IconItalic, IconList, IconListCheck, IconListNumbers, IconQuote, IconStrikethrough, IconTable } from '@tabler/icons-react';
import type { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { IconButton } from '../ui.tsx';

type Tool = { label: string; icon: React.ReactNode; run: (e: Editor) => void; active?: (e: Editor) => boolean };
const tools: (Tool | null)[] = [
    { label: 'Bold', icon: <IconBold />, run: e => e.chain().focus().toggleBold().run(), active: e => e.isActive('bold') },
    { label: 'Italic', icon: <IconItalic />, run: e => e.chain().focus().toggleItalic().run(), active: e => e.isActive('italic') },
    { label: 'Strike', icon: <IconStrikethrough />, run: e => e.chain().focus().toggleStrike().run(), active: e => e.isActive('strike') },
    { label: 'Inline code', icon: <IconCode />, run: e => e.chain().focus().toggleCode().run(), active: e => e.isActive('code') },
    null,
    { label: 'Heading 1', icon: <IconH1 />, run: e => e.chain().focus().toggleHeading({ level: 1 }).run(), active: e => e.isActive('heading', { level: 1 }) },
    { label: 'Heading 2', icon: <IconH2 />, run: e => e.chain().focus().toggleHeading({ level: 2 }).run(), active: e => e.isActive('heading', { level: 2 }) },
    { label: 'Heading 3', icon: <IconH3 />, run: e => e.chain().focus().toggleHeading({ level: 3 }).run(), active: e => e.isActive('heading', { level: 3 }) },
    null,
    { label: 'List', icon: <IconList />, run: e => e.chain().focus().toggleBulletList().run(), active: e => e.isActive('bulletList') },
    { label: 'Numbered list', icon: <IconListNumbers />, run: e => e.chain().focus().toggleOrderedList().run(), active: e => e.isActive('orderedList') },
    { label: 'Task list', icon: <IconListCheck />, run: e => e.chain().focus().toggleTaskList().run(), active: e => e.isActive('taskList') },
    { label: 'Quote', icon: <IconQuote />, run: e => e.chain().focus().toggleBlockquote().run(), active: e => e.isActive('blockquote') },
    { label: 'Table', icon: <IconTable />, run: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    null,
    { label: 'Undo', icon: <IconArrowBackUp />, run: e => e.chain().focus().undo().run() },
    { label: 'Redo', icon: <IconArrowForwardUp />, run: e => e.chain().focus().redo().run() },
];

export function Toolbar({ editor }: { editor: Editor | null }) {
    const [, tick] = useState(0);
    useEffect(() => {
        if (!editor) return;
        const update = () => tick(n => n + 1);
        editor.on('transaction', update);
        return () => { editor.off('transaction', update); };
    }, [editor]);
    return (
        <div role="toolbar" aria-label="Formatting" className="scrollbar-none flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-border/50 bg-muted/25 p-0.5">
            {tools.map((tool, i) => tool ? (
                <IconButton
                    key={tool.label}
                    label={tool.label}
                    disabled={!editor}
                    aria-pressed={editor && tool.active ? tool.active(editor) : undefined}
                    className="size-8 aria-pressed:bg-accent"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => editor && tool.run(editor)}
                >
                    {tool.icon}
                </IconButton>
            ) : <span key={i} className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />)}
        </div>
    );
}
