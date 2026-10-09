import { type Editor, type NodeViewRenderer } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { type Node } from '@tiptap/pm/model';
import { preview } from '@/services/preview';
import { defineAsyncComponent, h, render as renderVue } from 'vue';

const Diagram = defineAsyncComponent(() => import('@/components/Diagram.vue'));
const Mermaid = defineAsyncComponent(() => import('@/components/Mermaid.vue'));
const isDiagramLanguage = (language?: string) => ['archify', 'mermaid'].includes(language?.toLowerCase() ?? '');

export const CustomCodeBlockLowlight = CodeBlockLowlight.extend({
    addNodeView(): NodeViewRenderer {
        return ({
            editor,
            node,
            getPos,
        }: {
            editor: Editor;
            node: Node;
            getPos: () => number | undefined;
        }) => {
            let current = node;
            let showingPreview = isDiagramLanguage(node.attrs.language);
            let frame: HTMLIFrameElement | undefined;
            let diagramRoot: HTMLDivElement | undefined;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const container = document.createElement('div');
            container.className = 'min-w-0';
            const pre = document.createElement('pre');

            const header = document.createElement('div');
            header.contentEditable = 'false';
            header.classList.add(
                'flex',
                'items-center',
                'justify-between',
                'mb-2',
                'text-light-base-700',
                'dark:text-base-200',
                'print:hidden',
            );

            const languageSpan = document.createElement('span');
            languageSpan.innerText =
                node.attrs.language === 'plaintext' ? 'text' : (node.attrs.language ?? 'text');
            header.appendChild(languageSpan);

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-3';
            header.appendChild(actions);
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className =
                'min-h-9 rounded-md px-2 text-xs font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2';
            toggle.addEventListener('click', event => {
                event.preventDefault();
                showingPreview = !showingPreview;
                render();
            });
            actions.appendChild(toggle);

            if (navigator.clipboard) {
                const button = document.createElement('button');
                button.classList.add('w-4', 'h-4', 'mt-1', 'focus:outline-none');
                button.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

                button.addEventListener('click', async (e: MouseEvent) => {
                    e.preventDefault();

                    const pos = getPos();

                    if (pos === undefined) {
                        return;
                    }

                    const domNode = editor.view.nodeDOM(pos);
                    const code = (domNode as Element | null)?.querySelector('code');

                    if (!code) {
                        return;
                    }

                    editor.commands.focus();
                    editor.commands.setTextSelection(pos + 1);
                    await navigator.clipboard.writeText(code.textContent ?? '');
                });

                button.type = 'button';
                button.setAttribute('aria-label', 'Copy code');
                actions.appendChild(button);
            }

            const code = document.createElement('code');
            // Keep Chrome from dropping this editing surface when replacing
            // all its text; inline wrappers can be lifted into the parent pre.
            code.style.display = 'block';
            code.classList.add(`language-${node.attrs.language || 'text'}`);

            pre.appendChild(header);
            pre.appendChild(code);
            container.appendChild(pre);

            function render() {
                clearTimeout(timer);
                const language = current.attrs.language || 'text';
                const isHtml = language.toLowerCase() === 'html';
                const isDiagram = isDiagramLanguage(language);
                const isMermaid = language.toLowerCase() === 'mermaid';
                languageSpan.textContent = language === 'plaintext' ? 'text' : language;
                code.className = `language-${language}`;
                toggle.hidden = !isHtml && !isDiagram;
                if (!isHtml && !isDiagram) showingPreview = false;
                toggle.textContent = showingPreview ? 'Code' : 'Preview';
                toggle.setAttribute(
                    'aria-label',
                    isMermaid
                        ? (showingPreview ? 'Show Mermaid code' : 'Preview Mermaid')
                        : isDiagram
                        ? (showingPreview ? 'Show diagram code' : 'Preview diagram')
                        : (showingPreview ? 'Show HTML code' : 'Preview HTML'),
                );
                toggle.setAttribute('aria-pressed', String(showingPreview));
                code.hidden = showingPreview;
                code.style.display = showingPreview ? 'none' : 'block';
                pre.hidden = isDiagram && showingPreview;
                header.style.marginBottom = showingPreview ? '0' : '';
                pre.style.marginBottom = showingPreview ? '0' : '';
                pre.style.borderBottomLeftRadius = showingPreview ? '0' : '';
                pre.style.borderBottomRightRadius = showingPreview ? '0' : '';
                if (showingPreview && isHtml) {
                    if (!frame) {
                        frame = document.createElement('iframe');
                        frame.title = 'HTML preview';
                        frame.setAttribute('sandbox', '');
                        frame.referrerPolicy = 'no-referrer';
                        frame.contentEditable = 'false';
                        frame.className =
                            'block h-80 max-h-[60dvh] w-full rounded-b-md border border-t-0 bg-white';
                        container.appendChild(frame);
                    }
                    frame.srcdoc = preview(current.textContent);
                } else {
                    frame?.remove();
                    frame = undefined;
                }
                if (showingPreview && isDiagram) {
                    if (!diagramRoot) {
                        diagramRoot = document.createElement('div');
                        diagramRoot.contentEditable = 'false';
                        container.appendChild(diagramRoot);
                    }
                    renderVue(h(isMermaid ? Mermaid : Diagram, {
                        source: current.textContent,
                        onCode: () => { showingPreview = false; render(); },
                    }), diagramRoot);
                } else if (diagramRoot) {
                    renderVue(null, diagramRoot);
                    diagramRoot.remove();
                    diagramRoot = undefined;
                }
            }
            render();

            return {
                dom: container,
                contentDOM: code,
                update(updated) {
                    if (updated.type !== current.type) return false;
                    const changed =
                        updated.textContent !== current.textContent ||
                        updated.attrs.language !== current.attrs.language;
                    if (updated.attrs.language !== current.attrs.language) {
                        showingPreview = isDiagramLanguage(updated.attrs.language);
                    }
                    current = updated;
                    if (changed) {
                        clearTimeout(timer);
                        timer = setTimeout(render, 150);
                    }
                    return true;
                },
                stopEvent: event =>
                    header.contains(event.target as globalThis.Node) || event.target === frame ||
                    !!diagramRoot?.contains(event.target as globalThis.Node),
                ignoreMutation: mutation =>
                    (mutation.type !== 'selection' && !code.contains(mutation.target)) ||
                    (mutation.type === 'attributes' && mutation.target === code),
                destroy() {
                    clearTimeout(timer);
                    frame?.remove();
                    if (diagramRoot) renderVue(null, diagramRoot);
                },
            };
        };
    },
});
