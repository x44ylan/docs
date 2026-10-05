<script setup lang="ts">
import VaultEditorApplyTemplateController from '@/actions/App/Http/Controllers/VaultEditorApplyTemplateController';
import Menu from '@/components/editor/FormatMenu.vue';
import VaultEditorSearchFileModal from '@/components/modal/VaultEditorSearchModal.vue';
import VaultEditorTemplateListModal from '@/components/modal/VaultEditorTemplateListModal.vue';
import { useEditor } from '@/composables/useEditor';
import { useModalManager } from '@/composables/useModalManager';
import { useRequest } from '@/composables/useRequest';
import { useTiptapPreferences } from '@/composables/useTiptapPreferences';
import { useScreenSize } from '@/composables/useScreenSize';
import { useVaultActions } from '@/composables/useVaultActions';
import AlignCenter from '@/icons/AlignCenter.vue';
import AlignLeft from '@/icons/AlignLeft.vue';
import AlignRight from '@/icons/AlignRight.vue';
import Bold from '@/icons/Bold.vue';
import Code from '@/icons/Code.vue';
import CodeInline from '@/icons/CodeInline.vue';
import DocumentPlus from '@/icons/DocumentPlus.vue';
import Heading from '@/icons/Heading.vue';
import Heading1 from '@/icons/Heading1.vue';
import Heading2 from '@/icons/Heading2.vue';
import Heading3 from '@/icons/Heading3.vue';
import Heading4 from '@/icons/Heading4.vue';
import Heading5 from '@/icons/Heading5.vue';
import Heading6 from '@/icons/Heading6.vue';
import HorizontalRule from '@/icons/HorizontalRule.vue';
import Image from '@/icons/Image.vue';
import Indent from '@/icons/Indent.vue';
import Italic from '@/icons/Italic.vue';
import Link from '@/icons/Link.vue';
import List from '@/icons/List.vue';
import ListOrdered from '@/icons/ListOrdered.vue';
import ListTodo from '@/icons/ListTodo.vue';
import Markdown from '@/icons/Markdown.vue';
import Outdent from '@/icons/Outdent.vue';
import { Eye, PenLine, Ellipsis, ChevronRight, ArrowLeft, Home, Maximize, X, Check, Type } from 'lucide-vue-next';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { router } from '@inertiajs/vue3';
import Pilcrow from '@/icons/Pilcrow.vue';
import Print from '@/icons/Print.vue';
import Quote from '@/icons/Quote.vue';
import Redo from '@/icons/Redo.vue';
import Strike from '@/icons/Strike.vue';
import TableAdd from '@/icons/TableAdd.vue';
import TableAddColumn from '@/icons/TableAddColumn.vue';
import TableAddRow from '@/icons/TableAddRow.vue';
import TableDelete from '@/icons/TableDelete.vue';
import TableDeleteColumn from '@/icons/TableDeleteColumn.vue';
import TableDeleteRow from '@/icons/TableDeleteRow.vue';
import Template from '@/icons/Template.vue';
import Text from '@/icons/Text.vue';
import Undo from '@/icons/Undo.vue';
import { useLayoutStore } from '@/stores/layout';
import { computed, inject, nextTick, ref, watch, type Component, type ShallowRef } from 'vue';
import MarkdownToolbarButton from './MarkdownToolbarButton.vue';
import MarkdownToolbarItemDivider from './MarkdownToolbarItemDivider.vue';
import MarkdownToolbarSubButton from './MarkdownToolbarSubButton.vue';

const props = defineProps<{
    vaultId: number;
    nodeId: number;
    expanded: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();

const editorContext = inject<ShallowRef<ReturnType<typeof useEditor> | null>>('editorContext');

const layoutStore = useLayoutStore();
const vaultActions = useVaultActions();
const { isSmallScreen } = useScreenSize();
const { openModal } = useModalManager();
const { isEditMode, isEditingMarkdown, toggleEditMode, toggleEditingMarkdown } =
    useTiptapPreferences();

const applyTemplateForm = useRequest<{ node_id: number }>({ node_id: props.nodeId });

const editor = computed(() => editorContext?.value?.editor.value ?? null);

const isToolbarLocked = computed(() => !isEditMode.value || isEditingMarkdown.value);
const marks = ref({ bold: false, italic: false });
watch(editor, (instance, _, cleanup) => {
    const update = () => {
        marks.value.bold = !!instance?.isActive('bold');
        marks.value.italic = !!instance?.isActive('italic');
    };
    update();
    instance?.on('transaction', update);
    cleanup(() => { instance?.off('transaction', update); });
}, { immediate: true });

function undo(): void {
    editor.value?.chain().focus().undo().run();
}

function redo(): void {
    editor.value?.chain().focus().redo().run();
}

function toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6): void {
    editor.value?.chain().focus().toggleHeading({ level: level }).run();
}

function setParagraph(): void {
    editor.value?.chain().focus().setParagraph().run();
}

function toggleBlockquote(): void {
    editor.value?.chain().focus().toggleBlockquote().run();
}

function toggleCodeBlock(): void {
    editor.value?.chain().focus().toggleCodeBlock().run();
}

function toggleBold(): void {
    editor.value?.chain().focus().toggleBold().run();
}

function toggleItalic(): void {
    editor.value?.chain().focus().toggleItalic().run();
}

function toggleStrike(): void {
    editor.value?.chain().focus().toggleStrike().run();
}

function toggleCode(): void {
    editor.value?.chain().focus().toggleCode().run();
}

function toggleBulletList(): void {
    editor.value?.chain().focus().toggleBulletList().run();
}

function toggleOrderedList(): void {
    editor.value?.chain().focus().toggleOrderedList().run();
}

function toggleTaskList(): void {
    editor.value?.chain().focus().toggleTaskList().run();
}

function indentList(): void {
    const instance = editor.value;

    if (!instance) {
        return;
    }

    if (instance.can().sinkListItem('listItem')) {
        instance.chain().focus().sinkListItem('listItem').run();
    } else if (instance.can().sinkListItem('taskItem')) {
        instance.chain().focus().sinkListItem('taskItem').run();
    }
}

function outdentList(): void {
    const instance = editor.value;

    if (!instance) {
        return;
    }

    if (instance.can().liftListItem('listItem')) {
        instance.chain().focus().liftListItem('listItem').run();
    } else if (instance.can().liftListItem('taskItem')) {
        instance.chain().focus().liftListItem('taskItem').run();
    }
}

function openSearchFileModal(): void {
    openModal(VaultEditorSearchFileModal, {
        title: 'Insert link',
        top: true,
        initialUrl: editor.value?.getAttributes('link').href ?? '',
        onSelect: (url: string, name: string) => toggleLink(url, name),
    });
}

function toggleLink(url: string, name: string): void {
    const instance = editor.value;

    if (!instance) {
        return;
    }

    if (url === '') {
        instance.chain().focus().extendMarkRange('link').unsetLink().run();

        return;
    }

    const isEmptySelection = instance.state.selection.empty;

    if (isEmptySelection && !instance.isActive('link')) {
        const content = {
            type: 'text',
            text: name || url,
            marks: [{ type: 'link', attrs: { href: url } }],
        };

        instance.chain().focus().insertContent(content).run();

        return;
    }

    instance.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

function openSearchImageModal(): void {
    openModal(VaultEditorSearchFileModal, {
        title: 'Insert image',
        top: true,
        searchType: 'image',
        initialUrl: editor.value?.getAttributes('image').src ?? '',
        onSelect: (url: string, name: string) => setImage(url, name),
    });
}

function setImage(url: string, name: string): void {
    const instance = editor.value;

    if (!instance) {
        return;
    }

    if (url === '') {
        return;
    }

    const { from, to } = instance.state.selection;
    const selectedText = instance.state.doc.textBetween(from, to, ' ');
    const options = { src: url, alt: selectedText || name, title: '' };

    instance.chain().focus().setImage(options).run();
}

function setHorizontalRule(): void {
    editor.value?.chain().focus().setHorizontalRule().run();
}

function openTemplateListModal(): void {
    openModal(VaultEditorTemplateListModal, {
        title: 'Choose a template',
        top: true,
        onSelect: (templateId: number) => applyTemplateToVaultNode(templateId),
    });
}

function applyTemplateToVaultNode(templateId: number): void {
    const url = VaultEditorApplyTemplateController.url({
        vault: props.vaultId,
        template: templateId,
    });

    layoutStore.setAppLoading(true);

    applyTemplateForm.node_id = props.nodeId;

    applyTemplateForm.post(url, {
        onFinish: () => {
            layoutStore.setAppLoading(false);
        },
    });
}

function insertTable(): void {
    editor.value?.chain().focus().insertTable().run();
}

function deleteTable(): void {
    editor.value?.chain().focus().deleteTable().run();
}

function addColumnBefore(): void {
    editor.value?.chain().focus().addColumnBefore().run();
}

function addColumnAfter(): void {
    editor.value?.chain().focus().addColumnAfter().run();
}

function deleteColumn(): void {
    editor.value?.chain().focus().deleteColumn().run();
}

function addRowBefore(): void {
    editor.value?.chain().focus().addRowBefore().run();
}

function addRowAfter(): void {
    editor.value?.chain().focus().addRowAfter().run();
}

function deleteRow(): void {
    editor.value?.chain().focus().deleteRow().run();
}

function setTableColumnAlignment(alignment: 'left' | 'center' | 'right'): void {
    editor.value?.chain().focus().setTableColumnAlignment(alignment).run();
}

function print(): void {
    globalThis.print();
}

type Tool = { title: string; icon: Component; run: () => void; rotate?: boolean };
type ToolGroup = { title: string; icon: Component; items: (Tool | null)[] };
const moreOpen = ref(false);
const selectedGroup = ref<ToolGroup | null>(null);
const moreContent = ref<HTMLElement | null>(null);
watch(moreOpen, open => { if (!open) selectedGroup.value = null; });
watch(isSmallScreen, () => { moreOpen.value = false; });
watch(() => props.expanded, () => { moreOpen.value = false; });

function selectGroup(group: ToolGroup | null, event: Event): void {
    event.preventDefault();
    selectedGroup.value = group;
    nextTick(() => moreContent.value?.querySelectorAll<HTMLElement>('[role="menuitem"]')[group ? 1 : 0]?.focus());
}

const groups: ToolGroup[] = [
    { title: 'Heading', icon: Heading, items: [
        { title: 'Heading 1', icon: Heading1, run: () => toggleHeading(1) },
        { title: 'Heading 2', icon: Heading2, run: () => toggleHeading(2) },
        { title: 'Heading 3', icon: Heading3, run: () => toggleHeading(3) },
        { title: 'Heading 4', icon: Heading4, run: () => toggleHeading(4) },
        { title: 'Heading 5', icon: Heading5, run: () => toggleHeading(5) },
        { title: 'Heading 6', icon: Heading6, run: () => toggleHeading(6) },
    ] },
    { title: 'Block styles', icon: Pilcrow, items: [
        { title: 'Paragraph', icon: Pilcrow, run: setParagraph },
        { title: 'Quote', icon: Quote, run: toggleBlockquote },
        { title: 'Code block', icon: Code, run: toggleCodeBlock },
    ] },
    { title: 'Text styles', icon: Text, items: [
        { title: 'Bold', icon: Bold, run: toggleBold },
        { title: 'Italic', icon: Italic, run: toggleItalic },
        { title: 'Strike', icon: Strike, run: toggleStrike },
        { title: 'Inline code', icon: CodeInline, run: toggleCode },
    ] },
    { title: 'Lists', icon: List, items: [
        { title: 'List', icon: List, run: toggleBulletList },
        { title: 'Ordered list', icon: ListOrdered, run: toggleOrderedList },
        { title: 'Task list', icon: ListTodo, run: toggleTaskList },
        { title: 'Indent', icon: Indent, run: indentList },
        { title: 'Outdent', icon: Outdent, run: outdentList },
    ] },
    { title: 'Insert', icon: DocumentPlus, items: [
        { title: 'Link', icon: Link, run: openSearchFileModal },
        { title: 'Image', icon: Image, run: openSearchImageModal },
        { title: 'Horizontal rule', icon: HorizontalRule, run: setHorizontalRule },
        { title: 'Template', icon: Template, run: openTemplateListModal },
    ] },
    { title: 'Tables', icon: TableAdd, items: [
        { title: 'Insert table', icon: TableAdd, run: insertTable },
        { title: 'Delete table', icon: TableDelete, run: deleteTable },
        null,
        { title: 'Add column before', icon: TableAddColumn, run: addColumnBefore, rotate: true },
        { title: 'Add column after', icon: TableAddColumn, run: addColumnAfter },
        { title: 'Delete column', icon: TableDeleteColumn, run: deleteColumn },
        { title: 'Add row before', icon: TableAddRow, run: addRowBefore, rotate: true },
        { title: 'Add row after', icon: TableAddRow, run: addRowAfter },
        { title: 'Delete row', icon: TableDeleteRow, run: deleteRow },
        null,
        { title: 'Align left', icon: AlignLeft, run: () => setTableColumnAlignment('left') },
        { title: 'Align center', icon: AlignCenter, run: () => setTableColumnAlignment('center') },
        { title: 'Align right', icon: AlignRight, run: () => setTableColumnAlignment('right') },
    ] },
];
</script>

<template>
    <Teleport defer to="#file-actions">
        <MarkdownToolbarButton
            :title="isEditMode ? 'Read document' : 'Edit document'"
            :icon="isEditMode ? Eye : PenLine"
            @click="toggleEditMode"
        />
        <MarkdownToolbarButton
            v-if="isSmallScreen && isEditMode"
            :title="expanded ? 'Close formatting' : 'Show formatting'"
            :icon="expanded ? Check : Type"
            :active="expanded"
            :aria-expanded="expanded"
            aria-controls="file-tools"
            @click="emit('toggle')"
        />
    </Teleport>
    <div v-if="!isSmallScreen || expanded" class="text-muted-foreground min-w-0 max-w-full" role="group" aria-label="Document formatting">
        <div class="border-border/50 bg-muted/25 flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <MarkdownToolbarButton title="Bold" :icon="Bold" :active="marks.bold" :disabled="isToolbarLocked" @click="toggleBold" />
            <MarkdownToolbarButton title="Italic" :icon="Italic" :active="marks.italic" :disabled="isToolbarLocked" @click="toggleItalic" />
            <span class="bg-border/70 mx-1 h-4 w-px shrink-0" aria-hidden="true"></span>
            <Menu v-for="group in groups.filter(group => ['Heading', 'Lists', 'Insert', 'Tables'].includes(group.title))" :key="group.title" :disabled="isToolbarLocked">
                <template #trigger>
                    <MarkdownToolbarButton :title="group.title" :icon="group.icon" :disabled="isToolbarLocked" />
                </template>
                <template v-for="(item, index) in group.items" :key="index">
                    <MarkdownToolbarSubButton v-if="item" :title="item.title" :icon="item.icon" :icon-rotate="item.rotate" @click="item.run" />
                    <MarkdownToolbarItemDivider v-else />
                </template>
            </Menu>
            <span class="bg-border/70 mx-1 h-4 w-px shrink-0" aria-hidden="true"></span>
            <MarkdownToolbarButton title="Undo" :icon="Undo" :disabled="isToolbarLocked" @click="undo" />
            <MarkdownToolbarButton title="Redo" :icon="Redo" :disabled="isToolbarLocked" @click="redo" />
            <Teleport defer to="#file-actions" :disabled="isSmallScreen">
                <Menu v-model:open="moreOpen">
                    <template #trigger>
                        <MarkdownToolbarButton title="More editor options" :icon="Ellipsis" />
                    </template>
                    <div ref="moreContent">
                        <template v-if="selectedGroup">
                            <DropdownMenuItem aria-label="Back to editor options" class="min-h-11 font-medium sm:min-h-8" @select="selectGroup(null, $event)">
                                <ArrowLeft aria-hidden="true" />
                                {{ selectedGroup.title }}
                            </DropdownMenuItem>
                            <MarkdownToolbarItemDivider />
                            <template v-for="(item, index) in selectedGroup.items" :key="index">
                                <MarkdownToolbarSubButton v-if="item" :title="item.title" :icon="item.icon" :icon-rotate="item.rotate" :disabled="isToolbarLocked" @click="item.run" />
                                <MarkdownToolbarItemDivider v-else />
                            </template>
                        </template>
                        <template v-else>
                            <DropdownMenuItem
                                v-for="group in groups.filter(group => ['Block styles', 'Text styles'].includes(group.title))"
                                :key="group.title"
                                :disabled="isToolbarLocked"
                                class="min-h-11 sm:min-h-8"
                                @select="selectGroup(group, $event)"
                            >
                                <component :is="group.icon" class="size-4 shrink-0" aria-hidden="true" />
                                <span>{{ group.title }}</span>
                                <ChevronRight class="ml-auto size-4" aria-hidden="true" />
                            </DropdownMenuItem>
                            <MarkdownToolbarItemDivider />
                            <MarkdownToolbarSubButton
                                :title="isEditingMarkdown ? 'Rich text editor' : 'Markdown source'"
                                :icon="Markdown"
                                @click="toggleEditingMarkdown"
                            />
                            <MarkdownToolbarSubButton v-if="layoutStore.showToggleContentWidthButton" title="Toggle content width" :icon="Maximize" @click="layoutStore.toggleContentWidth" />
                            <MarkdownToolbarSubButton title="Print" :icon="Print" @click="print" />
                            <MarkdownToolbarItemDivider />
                            <MarkdownToolbarSubButton title="Close file" :icon="X" @click="vaultActions.closeFile" />
                            <MarkdownToolbarSubButton title="Docs home" :icon="Home" @click="router.visit('/vaults')" />
                        </template>
                    </div>
                </Menu>
            </Teleport>
        </div>
    </div>
</template>
