<script setup lang="ts">
import { destroy } from '@/actions/App/Http/Controllers/VaultNodeController';
import Menu from '@/components/menu/Menu.vue';
import MenuItem from '@/components/menu/MenuItem.vue';
import RequestConfirmationModal from '@/components/modal/RequestConfirmationModal.vue';
import VaultFilesImportModal from '@/components/modal/VaultFilesImportModal.vue';
import VaultNodeCreateModal from '@/components/modal/VaultNodeCreateModal.vue';
import VaultNodeEditModal from '@/components/modal/VaultNodeEditModal.vue';
import MoveModal from '@/components/modal/MoveModal.vue';
import { FileText, Folder, FolderOpen, FolderInput } from 'lucide-vue-next';
import { useModalManager } from '@/composables/useModalManager';
import { useScreenSize } from '@/composables/useScreenSize';
import { useVaultActions } from '@/composables/useVaultActions';
import { useVaultTreeActions } from '@/composables/useVaultTreeActions';
import ArrowUpTray from '@/icons/ArrowUpTray.vue';
import ChevronDown from '@/icons/ChevronDown.vue';
import DocumentDuplicate from '@/icons/DocumentDuplicate.vue';
import DocumentPlus from '@/icons/DocumentPlus.vue';
import EllipsisVertical from '@/icons/EllipsisVertical.vue';
import FileAudio from '@/icons/FileAudio.vue';
import FileImage from '@/icons/FileImage.vue';
import FilePDF from '@/icons/FilePDF.vue';
import FileVideo from '@/icons/FileVideo.vue';
import FolderPlus from '@/icons/FolderPlus.vue';
import PencilSquare from '@/icons/PencilSquare.vue';
import Spinner from '@/icons/Spinner.vue';
import Trash from '@/icons/Trash.vue';
import { useLayoutStore } from '@/stores/layout';
import { useVaultStore } from '@/stores/vault';
import { useVaultTreeStore } from '@/stores/vaultTree';
import { VaultNodeTreeDropIndicator, VaultNodeTreeItem } from '@/types/vault';
import { VaultShowPageProps } from '@/types/vault.pages';
import { usePage } from '@inertiajs/vue3';
import { computed, inject, Ref } from 'vue';
import VaultTreeChildren from './VaultTreeChildren.vue';

interface VaultTreeNodeProps {
    nodeId: number;
    depth: number;
}

const props = defineProps<VaultTreeNodeProps>();

const page = usePage<VaultShowPageProps>();
const vaultTreeDragAndDrop = inject<{
    draggingNodeId: Ref<number | null>;
    dropIndicator: Ref<VaultNodeTreeDropIndicator | null>;
    onDragStart: (event: DragEvent, id: number) => void;
    onDragEnd: () => void;
    onDragOverNode: (event: DragEvent, node: VaultNodeTreeItem) => void;
    onDrop: (event: DragEvent) => void;
}>('vaultTreeDragAndDrop')!;

const layoutStore = useLayoutStore();
const vaultStore = useVaultStore();
const vaultTreeStore = useVaultTreeStore();
const { openModal } = useModalManager();
const { isSmallScreen } = useScreenSize();
const vaultActions = useVaultActions();
const vaultTreeActions = useVaultTreeActions();

const node = computed(() => {
    const node = vaultTreeStore.getNodeById(props.nodeId);

    if (!node) {
        throw new Error('Node not found');
    }

    return node;
});

const isTemplateFolder = computed(() => vaultStore.isTemplateFolder(props.nodeId));
const isExpanded = computed(() => vaultTreeStore.isFolderExpanded(props.nodeId));
const isSelected = computed(() => vaultTreeStore.getSelectedFileId() === props.nodeId);
const isLoading = computed(() => vaultTreeStore.isFolderLoading(props.nodeId));
const canNest = computed(() => !node.value.is_file || node.value.type === 'note');
const renameLabel = computed(() => node.value.type === 'note' ? 'Rename note' : node.value.is_file ? 'Rename file' : 'Rename folder');
const hasChildren = computed(() => canNest.value && (vaultTreeStore.isFolderLoaded(node.value.id)
    ? vaultTreeStore.getChildren(node.value.id).length > 0 : node.value.has_children));

const isValidDropInside = computed(() => {
    return (
        vaultTreeDragAndDrop.dropIndicator.value?.type === 'inside' &&
        vaultTreeDragAndDrop.dropIndicator.value.targetId === node.value.id
    );
});

function handleClick() {
    if (node.value.is_file) {
        if (isSmallScreen.value) {
            layoutStore.closePanels();
        }

        vaultActions.openFile(node.value.id);
    } else {
        vaultTreeActions.toggleFolder(node.value.id);
    }
}
</script>

<template>
    <div
        class="relative"
        :data-node="node.id"
    >
        <div
            class="group relative flex min-h-11 items-center rounded-md transition-colors sm:min-h-8"
            :draggable="!layoutStore.isTreeViewLoading"
            @dragstart.stop="vaultTreeDragAndDrop.onDragStart($event, node.id)"
            @dragend="vaultTreeDragAndDrop.onDragEnd()"
            @dragover.prevent.stop="vaultTreeDragAndDrop.onDragOverNode($event, node)"
            @drop.stop="vaultTreeDragAndDrop.onDrop"
            :class="[
                isSelected
                    ? 'bg-[#27272a] text-[#fafafa]'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                isValidDropInside ? 'ring-2 ring-inset ring-ring' : '',
                vaultTreeDragAndDrop.draggingNodeId.value === node.id ? 'opacity-40' : '',
            ]"
        >
            <button v-if="hasChildren" type="button" class="flex h-11 w-8 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:h-8 sm:w-6"
                :aria-label="`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`" :aria-expanded="isExpanded"
                :title="`${isExpanded ? 'Collapse' : 'Expand'} sub-notes`"
                :disabled="isLoading" @click.stop="vaultTreeActions.toggleFolder(node.id)">
                <Spinner v-if="isLoading" class="size-3.5 animate-spin" />
                <ChevronDown v-else class="size-3.5 opacity-70 transition-transform" :class="{ '-rotate-90': !isExpanded }" />
            </button>
            <span v-else class="w-8 shrink-0 sm:w-6" aria-hidden="true" />
            <button
                type="button"
                class="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:min-h-8"
                :title="node.name"
                :aria-current="isSelected ? 'page' : undefined"
                @click="handleClick"
            >
                <span class="flex shrink-0 items-center justify-center">
                    <FileText v-if="node.extension === 'md'" class="size-4 opacity-70 sm:size-3.5" />
                    <FileAudio v-else-if="node.type === 'audio'" class="size-4 opacity-70 sm:size-3.5" />
                    <FileImage v-else-if="node.type === 'image'" class="size-4 opacity-70 sm:size-3.5" />
                    <FilePDF v-else-if="node.type === 'pdf'" class="size-4 opacity-70 sm:size-3.5" />
                    <FileVideo v-else-if="node.type === 'video'" class="size-4 opacity-70 sm:size-3.5" />
                    <component :is="isExpanded ? FolderOpen : Folder" v-else class="size-4 opacity-70 sm:size-3.5" />
                </span>
                <span class="truncate">
                    {{ node.name }}
                </span>
            </button>
            <Menu type="dropdown">
                <template #trigger>
                    <button
                        type="button"
                        :aria-label="`Actions for ${node.name}`"
                        class="flex h-11 w-8 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 sm:h-8 sm:w-7 [@media(hover:none)]:opacity-100"
                    >
                        <EllipsisVertical class="size-4 sm:size-3.5" />
                    </button>
                </template>
                <template #default="{ closeMenu }">
                    <div class="min-w-[10rem]">
                        <MenuItem
                            v-if="canNest"
                            :label="node.is_file ? 'New sub-note' : 'New note'"
                            :icon="DocumentPlus"
                            @click="
                                closeMenu();
                                openModal(VaultNodeCreateModal, {
                                    title: 'New note',
                                    vaultId: page.props.vault.id,
                                    parentId: node.id,
                                    isFile: true,
                                });
                            "
                        />
                        <MenuItem
                            v-if="!node.is_file"
                            label="New folder"
                            :icon="FolderPlus"
                            @click="
                                closeMenu();
                                openModal(VaultNodeCreateModal, {
                                    title: 'New folder',
                                    vaultId: page.props.vault.id,
                                    parentId: node.id,
                                    isFile: false,
                                });
                            "
                        />
                        <MenuItem
                            v-if="!node.is_file"
                            label="Import files"
                            :icon="ArrowUpTray"
                            @click="
                                closeMenu();
                                openModal(VaultFilesImportModal, {
                                    title: 'Import files',
                                    vaultId: page.props.vault.id,
                                    parentId: node.id,
                                });
                            "
                        />
                        <MenuItem label="Move to…" :icon="FolderInput" @click="closeMenu(); openModal(MoveModal, { title: 'Move to', node });" />
                        <MenuItem
                            :label="renameLabel"
                            :icon="PencilSquare"
                            @click="
                                closeMenu();
                                openModal(VaultNodeEditModal, {
                                    title: renameLabel,
                                    id: node.id,
                                    vaultId: page.props.vault.id,
                                    type: node.type,
                                    name: node.name,
                                });
                            "
                        />
                        <MenuItem
                            v-if="!node.is_file"
                            label="Template folder"
                            :label-class="
                                isTemplateFolder ? 'text-success-600 dark:text-success-500' : ''
                            "
                            :icon="DocumentDuplicate"
                            @click="
                                closeMenu();
                                vaultTreeActions.setTemplateFolder(node.id);
                            "
                        />
                        <MenuItem
                            label="Delete"
                            :icon="Trash"
                            @click="
                                closeMenu();
                                openModal(RequestConfirmationModal, {
                                    title: node.is_file ? 'Delete file' : 'Delete folder',
                                    url: destroy.url({
                                        vault: page.props.vault.id,
                                        node: node.id,
                                    }),
                                    method: 'delete',
                                    content: canNest
                                        ? `Delete “${node.name}” and everything nested inside it? This cannot be undone.`
                                        : 'Are you sure you want to delete this file?',
                                    successMessage: node.is_file
                                        ? 'File deleted'
                                        : 'Folder deleted',
                                    onSuccess: (response: { data: { deleted_ids: number[] } }) => {
                                        vaultActions.handleNodesDeleted(
                                            response.data.deleted_ids,
                                            false
                                        );
                                    },
                                });
                            "
                        />
                    </div>
                </template>
            </Menu>
        </div>
        <VaultTreeChildren
            v-if="hasChildren && isExpanded"
            :parent-id="nodeId"
            :depth="depth + 1"
            :expanded="isExpanded"
        />
    </div>
</template>
