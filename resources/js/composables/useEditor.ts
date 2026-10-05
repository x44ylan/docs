import { createLazyLowlight, lazyLanguageFor } from '@/services/lowlight';
import { markedService } from '@/services/marked';
import DOMPurify from 'dompurify';
import { CustomCodeBlockLowlight } from '@/services/tiptap/extension-custom-code-block-low-light';
import { CustomImage } from '@/services/tiptap/extension-custom-image';
import { CustomLink } from '@/services/tiptap/extension-custom-link';
import { CustomTableCell } from '@/services/tiptap/extension-custom-table-cell';
import { CustomTableColumnAlign } from '@/services/tiptap/extension-custom-table-column-align';
import { CustomTableHeader } from '@/services/tiptap/extension-custom-table-header';
import { CustomTaskItem } from '@/services/tiptap/extension-custom-task-item';
import { Hashtag } from '@/services/tiptap/extension-hashtag';
import { SmartBracket } from '@/services/tiptap/extension-smart-bracket';
import { VaultFileDrop } from '@/services/tiptap/extension-vault-file-drop';
import {
    VaultFileUpload,
    VaultFileUploadRequest,
} from '@/services/tiptap/extension-vault-file-upload';
import { blockReplacement, joinReplacements, turndownService } from '@/services/turndown';
import { Editor, getHTMLFromFragment } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Table, TableRow } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { onMounted, onUnmounted, Ref, shallowRef, watch } from 'vue';

interface SetupEditorOptions {
    vaultId: string;
    readonly?: boolean;
    fileUrl?: string;
    element: Ref<HTMLElement | null>;
    markdownElement: Ref<HTMLTextAreaElement | null>;
    autofocus?: boolean;
    content: string;
    isEditMode: Readonly<Ref<boolean>>;
    onUpdate: (markdown: string) => void;
    openFilePath: (path: string) => void;
    uploadFiles: (request: VaultFileUploadRequest) => void;
}

export function useEditor(options: SetupEditorOptions) {
    const editor = shallowRef<Editor | null>(null);
    let isSyncing: boolean = true;
    // Markdown serialization walks the whole document, so it runs after a
    // typing pause (or maxWait) instead of on every keystroke.
    const syncDelay = 300;
    const syncMaxWait = 2000;
    let isDirty = false;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let syncDeadline: ReturnType<typeof setTimeout> | undefined;
    // Unchanged top-level blocks keep their node identity across edits, so
    // only edited blocks are converted again.
    let blockMarkdown = new WeakMap<ProseMirrorNode, string | null>();

    const prepareTiptapHTML = (html: string) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Prepare plain text code
        doc.querySelectorAll('code.language-plaintext').forEach(element => {
            element.classList.remove('language-plaintext');

            if (element.classList.length === 0) {
                element.removeAttribute('class');
            }
        });

        // Prepare links
        doc.querySelectorAll<HTMLAnchorElement>('a[data-href]').forEach(element => {
            element.setAttribute('href', element.dataset.href ?? '');
            delete element.dataset.href;
        });

        return doc.body.innerHTML;
    };

    const encodeText = (text: string) => {
        // Encode paths from Markdown links
        const encoded = text.replace(
            /\[(.*?)\]\((.*?)(\s".*?")?\)/g,
            (match, text, path, title) => {
                if (title === undefined) {
                    title = '';
                }

                try {
                    // Encode raw spaces without encoding existing URL escapes twice.
                    const href = encodeURI(path).replace(/%25([\da-f]{2})/gi, '%$1');
                    return `[${text}](${href}${title})`;
                } catch {
                    return `[${text}](${path}${title})`;
                }
            }
        );

        // The Markdown renderer escapes HTML; leave code source intact.
        return encoded;
    };

    const safeHTML = (html: string) => options.readonly ? DOMPurify.sanitize(html) : html;
    const content = options.content ? safeHTML(markedService.parse(encodeText(options.content)) as string) : '';

    onMounted(() => {
        const lowlight = createLazyLowlight(refreshCodeBlocks);
        editor.value = new Editor({
            element: options.element.value,
            autofocus: options.autofocus,
            extensions: [
                StarterKit.configure({
                    code: {
                        HTMLAttributes: {
                            class: 'not-prose px-1 py-0.5 text-sm rounded-sm bg-light-base-400 dark:bg-base-700',
                        },
                    },
                    codeBlock: false,
                    link: false,
                }),
                SmartBracket,
                Hashtag,
                CustomCodeBlockLowlight.configure({
                    defaultLanguage: 'plaintext',
                    lowlight,
                }),
                CustomImage.configure({
                    vaultId: options.vaultId,
                    fileUrl: options.fileUrl,
                }),
                CustomLink.configure({
                    autolink: false,
                    onOpenFile: href => options.openFilePath(href),
                }),
                TaskList,
                CustomTaskItem.configure({
                    nested: true,
                }),
                Table,
                TableRow,
                CustomTableHeader.configure({
                    HTMLAttributes: {
                        class: 'border border-light-base-400 dark:border-base-700 p-2',
                    },
                }),
                CustomTableCell.configure({
                    HTMLAttributes: {
                        class: 'border border-light-base-400 dark:border-base-700 p-2',
                    },
                }),
                CustomTableColumnAlign,
                ...(options.readonly ? [] : [VaultFileDrop, VaultFileUpload.configure({
                    uploadFiles: options.uploadFiles,
                    placeholderClass:
                        'bg-light-base-300 dark:bg-base-800 text-light-base-700 dark:text-base-200 rounded-sm px-1 text-sm',
                })]),
            ],
            content: content,
            editable: !options.readonly && options.isEditMode.value,
            editorProps: {
                attributes: {
                    class: 'h-full !max-w-none flow-root focus:outline-none prose dark:prose-invert',
                },
            },
            onCreate() {
                isSyncing = false;

                setMarkdownContent(options.content);
            },
            onUpdate() {
                if (isSyncing || options.readonly) {
                    return;
                }

                isDirty = true;
                clearTimeout(syncTimer);
                syncTimer = setTimeout(flushMarkdown, syncDelay);
                syncDeadline ??= setTimeout(flushMarkdown, syncMaxWait);
            },
        });
    });

    // Re-highlight code blocks once their grammar has loaded. Re-setting the same
    // attributes is enough for the highlighter; it is not an edit or a save.
    function refreshCodeBlocks(grammar: string) {
        const instance = editor.value;

        if (!instance || instance.isDestroyed) {
            return;
        }

        const { tr } = instance.state;

        instance.state.doc.descendants((node, pos) => {
            if (node.type.name === 'codeBlock' && lazyLanguageFor(String(node.attrs.language ?? '')) === grammar) {
                tr.setNodeMarkup(pos, undefined, node.attrs);
            }
        });

        if (tr.docChanged) {
            instance.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true));
        }
    }

    function cancelMarkdownSync() {
        isDirty = false;
        clearTimeout(syncTimer);
        clearTimeout(syncDeadline);
        syncTimer = syncDeadline = undefined;
    }

    // Serialize pending rich-text edits now; callers flush before saving,
    // switching notes or showing the Markdown source.
    function flushMarkdown() {
        const dirty = isDirty;
        cancelMarkdownSync();
        if (!dirty || !editor.value) {
            return;
        }

        const markdown = serializeMarkdown(editor.value);
        setMarkdownContent(markdown);

        options.onUpdate(markdown);
    }

    function serializeMarkdown(instance: Editor): string {
        const replacements: string[] = [];

        for (let i = 0; i < instance.state.doc.childCount; i++) {
            const node = instance.state.doc.child(i);
            let replacement = blockMarkdown.get(node);

            if (replacement === undefined) {
                replacement = blockReplacement(
                    prepareTiptapHTML(getHTMLFromFragment(Fragment.from(node), instance.schema))
                );
                blockMarkdown.set(node, replacement);
            }

            if (replacement === null) {
                return turndownService.turndown(prepareTiptapHTML(instance.getHTML()));
            }

            replacements.push(replacement);
        }

        return joinReplacements(replacements);
    }

    function setTiptapContent(html: string) {
        // Replaced content supersedes any unsynced rich-text edits.
        cancelMarkdownSync();
        editor.value?.commands.setContent(html);
    }

    function setMarkdownContent(markdown: string) {
        if (options.markdownElement.value) {
            options.markdownElement.value.value = markdown;
        }
    }

    async function setContent(markdown: string) {
        isSyncing = true;

        const html = await markedService.parse(encodeText(markdown));
        setTiptapContent(safeHTML(html));
        setMarkdownContent(markdown);

        isSyncing = false;
    }

    async function onMarkdownChanged(markdown: string) {
        // Queue the raw draft before parsing so a quick navigation can flush it.
        options.onUpdate(markdown);
        if (isSyncing) {
            return;
        }

        isSyncing = true;

        const html = await markedService.parse(encodeText(markdown));
        setTiptapContent(safeHTML(html));

        isSyncing = false;
    }

    watch(options.isEditMode, value => {
        isSyncing = true;

        editor.value?.setEditable(!options.readonly && value);

        isSyncing = false;
    });

    onUnmounted(() => {
        cancelMarkdownSync();
        blockMarkdown = new WeakMap();
        editor.value?.destroy();
        editor.value = null;
    });

    return {
        editor,
        setContent,
        onMarkdownChanged,
        flushMarkdown,
        isMarkdownPending: () => isDirty,
    };
}
