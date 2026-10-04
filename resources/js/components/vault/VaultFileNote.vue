<script setup lang="ts">
import VaultNodeController from '@/actions/App/Http/Controllers/VaultNodeController';
import { useEditor } from '@/composables/useEditor';
import { useAutosave } from '@/composables/useAutosave';
import { useTiptapPreferences } from '@/composables/useTiptapPreferences';
import { useRequest } from '@/composables/useRequest';
import { useVaultActions } from '@/composables/useVaultActions';
import { useVaultFileUpload } from '@/composables/useVaultFileUpload';
import { useLayoutStore } from '@/stores/layout';
import { VaultNode } from '@/types/vault';
import { inject, onBeforeUnmount, onMounted, ref, ShallowRef, watch } from 'vue';

interface VaultFileNodeProps {
    node: VaultNode;
}

interface VaultFileNodeEmits {
    contentUpdated: [content: string];
}

const props = defineProps<VaultFileNodeProps>();
const emit = defineEmits<VaultFileNodeEmits>();

const editorContext = inject<ShallowRef<ReturnType<typeof useEditor> | null>>('editorContext');

if (!editorContext) {
    throw new Error('editorContext is not provided');
}

const layoutStore = useLayoutStore();
const vaultActions = useVaultActions();
const { importFiles } = useVaultFileUpload();
const { isEditMode, isEditingMarkdown } = useTiptapPreferences();

const form = useRequest<{ content: string }>({ content: props.node.content ?? '' });

const noteEditorRef = ref<HTMLElement | null>(null);
const noteMarkdownRef = ref<HTMLTextAreaElement | null>(null);

let isUnmounted = false;
// Assigned once the editor exists; autosave flushes pending rich-text edits first.
let flushEditor: (() => void) | undefined;
let isEditorPending: (() => boolean) | undefined;
const url = VaultNodeController.update.url({ vault: props.node.vault_id, node: props.node.id });
const save = useAutosave(markdown => new Promise(resolve => {
    layoutStore.setVaultNodeUpdating(true);
    form.content = markdown;
    let saved = false;
    form.patch(url, {
        onSuccess: (response: { data: VaultNode }) => {
            saved = true;
            if (!isUnmounted) emit('contentUpdated', response.data.content ?? '');
        },
        onFinish: () => {
            layoutStore.setVaultNodeUpdating(false);
            resolve(saved);
        },
    });
}), {
    flush: () => flushEditor?.(),
    pending: () => !!isEditorPending?.(),
});

const { editor, setContent, onMarkdownChanged, flushMarkdown, isMarkdownPending } = useEditor({
    vaultId: String(props.node.vault_id),
    element: noteEditorRef,
    markdownElement: noteMarkdownRef,
    autofocus: false,
    content: props.node.content ?? '',
    isEditMode: isEditMode,
    onUpdate: save,
    openFilePath: vaultActions.openFilePath,
    uploadFiles: request =>
        importFiles({
            vaultId: props.node.vault_id,
            parentId: props.node.parent_id,
            files: request.files,
            onSuccess: request.onSuccess,
            onFinish: request.onFinish,
        }),
});

flushEditor = flushMarkdown;
isEditorPending = isMarkdownPending;

onMounted(() => {
    editorContext.value = { editor, setContent, onMarkdownChanged, flushMarkdown, isMarkdownPending };
});

// The source view must show edits made moments ago in the rich editor.
watch(isEditingMarkdown, value => {
    if (value) flushMarkdown();
}, { flush: 'sync' });

watch(() => props.node.content, content => {
    if (!save.pending() && content !== noteMarkdownRef.value?.value) {
        void setContent(content ?? '');
    }
});

onBeforeUnmount(() => {
    isUnmounted = true;
});
</script>

<template>
    <div class="note-content flex h-full w-full flex-col">
        <div
            ref="noteEditorRef"
            class="h-full px-4 pb-8 sm:px-8 sm:pb-12"
            :class="isEditingMarkdown ? 'hidden' : ''"
        ></div>

        <textarea
            ref="noteMarkdownRef"
            class="h-full w-full resize-none border-0 bg-transparent px-4 pb-8 font-mono text-sm leading-relaxed break-words whitespace-break-spaces focus:outline-none focus:ring-0 sm:px-8 sm:pb-12"
            :class="isEditingMarkdown ? '' : 'hidden'"
            :readonly="!isEditMode"
            aria-label="Markdown source"
            :spellcheck="false"
            @input="editorContext?.onMarkdownChanged(noteMarkdownRef?.value ?? '')"
        />
    </div>
</template>
