<script setup lang="ts">
import Menu from '@/components/menu/Menu.vue';
import MenuItem from '@/components/menu/MenuItem.vue';
import { Button } from '@/components/ui/button';
import VaultCollaborationModal from '@/components/modal/VaultCollaborationModal.vue';
import VaultEditModal from '@/components/modal/VaultEditModal.vue';
import VaultFilesImportModal from '@/components/modal/VaultFilesImportModal.vue';
import VaultNodeCreateModal from '@/components/modal/VaultNodeCreateModal.vue';
import { useModalManager } from '@/composables/useModalManager';
import { useVaultActions } from '@/composables/useVaultActions';
import { useVaultTreeActions } from '@/composables/useVaultTreeActions';
import ArrowUpTray from '@/icons/ArrowUpTray.vue';
import Bars3 from '@/icons/Bars3.vue';
import DocumentPlus from '@/icons/DocumentPlus.vue';
import FolderPlus from '@/icons/FolderPlus.vue';
import PencilSquare from '@/icons/PencilSquare.vue';
import Spinner from '@/icons/Spinner.vue';
import { Plus, Share2 } from 'lucide-vue-next';
import { useLayoutStore } from '@/stores/layout';
import { useVaultStore } from '@/stores/vault';
import { useVaultTreeStore } from '@/stores/vaultTree';
import { VaultNodeTreeItem, VaultNodeTreeDropIndicator } from '@/types/vault';
import { VaultUpdated } from '@/types/vault.events';
import { computed, onBeforeUnmount, provide, ref } from 'vue';
import VaultTreeNode from './VaultTreeNode.vue';

const props = defineProps<{
    vaultId: number;
}>();

const { openModal } = useModalManager();
const layoutStore = useLayoutStore();
const vaultStore = useVaultStore();
const vaultActions = useVaultActions();
const treeActions = useVaultTreeActions();
const vaultTreeStore = useVaultTreeStore();

const children = computed(() => vaultTreeStore.getChildren(null));

const draggingNodeId = ref<number | null>(null);
const dropIndicator = ref<VaultNodeTreeDropIndicator>(null);
const isValidDropAfter = computed(() => dropIndicator.value?.type === 'root');
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
const dropLabel = computed(() => dropIndicator.value?.type === 'root' ? 'Move to vault root'
    : dropIndicator.value ? `Move into ${vaultTreeStore.getNodeById(dropIndicator.value.targetId)?.name}` : 'Drop on a note or folder to nest');

function canDrop(draggedId: number, target: VaultNodeTreeItem): boolean {
    const node = vaultTreeStore.getNodeById(draggedId);

    if (node === null || node.id === target.id || (target.is_file && target.type !== 'note')) {
        return false;
    }

    let parentId = target.parent_id;

    while (parentId) {
        if (parentId === draggedId) {
            return false;
        }

        parentId = vaultTreeStore.getNodeById(parentId)?.parent_id ?? null;
    }

    return true;
}

function onDragStart(event: DragEvent, nodeId: number): void {
    if (!event.dataTransfer) {
        return;
    }

    draggingNodeId.value = nodeId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/docs-node', String(nodeId));

    const node = vaultTreeStore.getNodeById(nodeId);

    if (node !== null && node.is_file) {
        event.dataTransfer.setData(
            'application/vault-file',
            JSON.stringify({ type: node.type, name: node.name, url: encodeURI(node.full_path) })
        );
    }
}

function onDragEnd(): void {
    clearTimeout(hoverTimer);
    draggingNodeId.value = null;
    dropIndicator.value = null;
}
onBeforeUnmount(onDragEnd);

function onDragOverNode(event: DragEvent, node: VaultNodeTreeItem): void {
    if (!event.dataTransfer || layoutStore.isTreeViewLoading) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const externalFiles = !draggingNodeId.value && event.dataTransfer.types.includes('Files');
    if (externalFiles ? node.is_file && node.type !== 'note' : !draggingNodeId.value || !canDrop(draggingNodeId.value, node)) {
        clearTimeout(hoverTimer);
        event.dataTransfer.dropEffect = 'none';
        dropIndicator.value = null;

        return;
    }

    event.dataTransfer.dropEffect = externalFiles ? 'copy' : 'move';
    if (dropIndicator.value?.targetId !== node.id) {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            if (!vaultTreeStore.isFolderExpanded(node.id)) treeActions.toggleFolder(node.id);
        }, 600);
    }
    dropIndicator.value = { type: 'inside', targetId: node.id };
}

function onDragOverRoot(event: DragEvent): void {
    if (layoutStore.isTreeViewLoading || (!draggingNodeId.value && !event.dataTransfer?.types.includes('Files'))) {
        return;
    }
    clearTimeout(hoverTimer);
    if (event.dataTransfer) event.dataTransfer.dropEffect = draggingNodeId.value ? 'move' : 'copy';
    dropIndicator.value = { type: 'root', targetId: 0 };
}

function onLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
        clearTimeout(hoverTimer);
        dropIndicator.value = null;
    }
}

function onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (!dropIndicator.value || layoutStore.isTreeViewLoading) { onDragEnd(); return; }
    const node = draggingNodeId.value ? vaultTreeStore.getNodeById(draggingNodeId.value) : null;
    const target = vaultTreeStore.getNodeById(dropIndicator.value.targetId);
    const parentId = dropIndicator.value.type === 'root' ? null : target?.id;
    if (parentId === undefined || (node && target && !canDrop(node.id, target))) { onDragEnd(); return; }
    onDragEnd();

    if (!node && event.dataTransfer?.files.length) {
        openModal(VaultFilesImportModal, {
            vaultId: props.vaultId,
            parentId,
            dropEvent: event,
        });

        return;
    }

    if (node) vaultActions.moveNode(node.id, parentId);
}

provide('vaultTreeDragAndDrop', {
    draggingNodeId,
    dropIndicator,
    onDragStart,
    onDragEnd,
    onDragOverNode,
    onDrop,
});
</script>

<template>
    <div class="text-muted-foreground relative flex h-full w-full flex-col text-sm sm:text-[13px]" @keydown.esc="onDragEnd">
        <div v-if="layoutStore.isTreeViewLoading" class="absolute inset-0 z-30"></div>
        <div class="flex shrink-0 flex-col gap-2 px-3 py-2">
            <div class="flex w-full items-center justify-between gap-2">
                <div
                    class="text-foreground min-w-0 flex-1 truncate text-[15px] font-semibold"
                    :title="vaultStore.name ?? ''"
                >
                    {{ vaultStore.name }}
                </div>

                <div class="flex shrink-0 items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-11 shrink-0 sm:size-9"
                        aria-label="New note"
                        title="New note"
                        @click="openModal(VaultNodeCreateModal, {
                            title: 'New note',
                            vaultId,
                            parentId: null,
                            isFile: true,
                        })"
                    >
                        <Plus class="size-4 sm:size-3.5" aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" class="size-11 sm:size-9" aria-label="Collaboration" title="Collaboration"
                        @click="openModal(VaultCollaborationModal, { title: 'Collaboration', top: true, vaultId })">
                        <Share2 class="size-3.5" aria-hidden="true" />
                    </Button>
                    <Spinner
                        v-if="layoutStore.isTreeViewLoading"
                        class="h-4 w-4 animate-spin opacity-70"
                    />
                    <Menu v-else type="dropdown">
                        <template #trigger>
                            <Button variant="ghost" size="icon" class="size-11 sm:size-9" aria-label="Vault menu" title="Vault menu">
                                <Bars3 class="size-4 sm:size-3.5" aria-hidden="true" />
                            </Button>
                        </template>

                        <template #default="{ closeMenu }">
                            <div class="min-w-[10rem]">
                                <MenuItem
                                    label="New note"
                                    :icon="DocumentPlus"
                                    @click="
                                        closeMenu();
                                        openModal(VaultNodeCreateModal, {
                                            title: 'New note',
                                            vaultId: vaultId,
                                            parentId: null,
                                            isFile: true,
                                        });
                                    "
                                />
                                <MenuItem
                                    label="New folder"
                                    :icon="FolderPlus"
                                    @click="
                                        closeMenu();
                                        openModal(VaultNodeCreateModal, {
                                            title: 'New folder',
                                            vaultId: vaultId,
                                            parentId: null,
                                            isFile: false,
                                        });
                                    "
                                />
                                <MenuItem
                                    label="Import files"
                                    :icon="ArrowUpTray"
                                    @click="
                                        closeMenu();
                                        openModal(VaultFilesImportModal, {
                                            title: 'Import files',
                                            vaultId: vaultId,
                                            parentId: null,
                                        });
                                    "
                                />
                                <MenuItem
                                    label="Rename vault"
                                    :icon="PencilSquare"
                                    @click="
                                        closeMenu();
                                        openModal(VaultEditModal, {
                                            title: 'Rename vault',
                                            id: vaultId,
                                            name: vaultStore.name,
                                            onSuccess: (data: VaultUpdated) => {
                                                vaultStore.updateVault(data);
                                            },
                                        });
                                    "
                                />
                            </div>
                        </template>
                    </Menu>
                </div>
            </div>
        </div>

        <div id="vault-tree-scroll-container" aria-label="Documents" class="mb-2 min-h-0 flex-1 overflow-y-auto"
            @dragleave="onLeave">
            <div class="min-h-full px-2" @dragover.self.prevent="onDragOverRoot" @drop.self="onDrop">
                <VaultTreeNode v-for="id in children" :key="id" :node-id="id" :depth="0" />
                <div v-if="draggingNodeId" class="text-muted-foreground mt-2 flex min-h-11 items-center justify-center rounded-md border border-dashed px-2 text-xs"
                    :class="isValidDropAfter ? 'border-ring bg-accent text-foreground' : 'border-border'"
                    @dragover.prevent.stop="onDragOverRoot" @drop.stop="onDrop">Move to vault root</div>
            </div>
        </div>
        <p v-if="draggingNodeId" role="status" class="text-muted-foreground truncate border-t px-3 py-2 text-xs">{{ dropLabel }}</p>
    </div>
</template>
