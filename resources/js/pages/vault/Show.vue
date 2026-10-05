<script setup lang="ts">
import MarkdownToolbar from '@/components/editor/MarkdownToolbar.vue';
import UserMenu from '@/components/menu/UserMenu.vue';
import VaultNodeCreateModal from '@/components/modal/VaultNodeCreateModal.vue';
import VaultSearchModal from '@/components/modal/VaultSearchModal.vue';
import VaultTree from '@/components/tree/VaultTree.vue';
import { Button } from '@/components/ui/button';
import VaultFile from '@/components/vault/VaultFile.vue';
import VaultFileAudio from '@/components/vault/VaultFileAudio.vue';
import VaultFileImage from '@/components/vault/VaultFileImage.vue';
import VaultFileNote from '@/components/vault/VaultFileNote.vue';
import VaultFilePdf from '@/components/vault/VaultFilePdf.vue';
import VaultFileVideo from '@/components/vault/VaultFileVideo.vue';
import { useContentWidthPreference } from '@/composables/useContentWidthPreference';
import { useEditor } from '@/composables/useEditor';
import { useModalManager } from '@/composables/useModalManager';
import { useScreenSize } from '@/composables/useScreenSize';
import { useToast } from '@/composables/useToast';
import { useTiptapPreferences } from '@/composables/useTiptapPreferences';
import { useVaultActions } from '@/composables/useVaultActions';
import { useVaultTreeActions } from '@/composables/useVaultTreeActions';
import Bars3BottomLeft from '@/icons/Bars3BottomLeft.vue';
import Doc from '@/icons/Doc.vue';
import MagnifyingGlass from '@/icons/MagnifyingGlass.vue';
import Plus from '@/icons/Plus.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import { index } from '@/routes/vaults';
import { useLayoutStore } from '@/stores/layout';
import { useVaultStore } from '@/stores/vault';
import { useVaultOpenedFileStore } from '@/stores/vaultOpenedFile';
import { useVaultRecentFileStore } from '@/stores/vaultRecentFile';
import { useVaultTemplateStore } from '@/stores/vaultTemplate';
import { useVaultTreeStore } from '@/stores/vaultTree';
import {
    VaultCollaborator,
    VaultEditorTemplateFile,
    VaultNode,
    VaultOpenedFileData,
} from '@/types/vault';
import { VaultUpdated } from '@/types/vault.events';
import { VaultShowPageProps } from '@/types/vault.pages';
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { useEcho } from '@laravel/echo-vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, provide, ref, shallowRef, watch } from 'vue';

defineOptions({ layout: AuthLayout });

const props = defineProps<VaultShowPageProps>();
const page = usePage();
const channel = `Vault.${props.vault.id}.${page.props.app?.user?.id}`;

const layoutStore = useLayoutStore();
const { isLeftPanelOpen } = storeToRefs(layoutStore);
const { toggleLeftPanel, closePanels, syncPanelsWithScreen } = layoutStore;
const vaultStore = useVaultStore();
const vaultRecentFileStore = useVaultRecentFileStore();
const vaultOpenedFileStore = useVaultOpenedFileStore();
const vaultTreeStore = useVaultTreeStore();
const vaultTemplateStore = useVaultTemplateStore();
const { openModal } = useModalManager();
const { createToast } = useToast();
useEcho<{ data: { vault_id: number } }>(`User.${page.props.app?.user?.id}`, 'VaultCollaborationAccessRevokedEvent', ({ data }) => {
    if (data.vault_id === props.vault.id) {
        createToast('Your access to this vault has changed.', 'error');
        router.visit('/vaults');
    }
});
const { isSmallScreen } = useScreenSize();
const vaultActions = useVaultActions();
const vaultTreeActions = useVaultTreeActions();

const mainSectionRef = ref<HTMLElement | null>(null);
useContentWidthPreference(mainSectionRef);
syncPanelsWithScreen(isSmallScreen.value);

const openedFile = ref(props.openedFile ?? null);
const showFormatting = ref(false);
const { isEditMode } = useTiptapPreferences();
watch(isEditMode, () => { showFormatting.value = false; });
watch(isSmallScreen, () => { showFormatting.value = false; });
watch(() => openedFile.value?.file.id, () => { showFormatting.value = false; });
const documentPath = computed(() => {
    const parts = [
        vaultStore.name || props.vault.name,
        ...(openedFile.value?.ancestors ?? []).map(node => vaultTreeStore.getNodeById(node.id)?.name ?? node.name),
        ...(openedFile.value ? [openedFile.value.file.name] : []),
    ];
    return parts.length > 1 && parts[0].toLowerCase() === parts[1].toLowerCase()
        ? parts.slice(1) : parts;
});
const parentPath = computed(() => documentPath.value.slice(0, -1));
const fileComponents = {
    note: VaultFileNote,
    image: VaultFileImage,
    pdf: VaultFilePdf,
    video: VaultFileVideo,
    audio: VaultFileAudio,
};

const editorContext = shallowRef<ReturnType<typeof useEditor> | null>(null);
provide('editorContext', editorContext);

onMounted(() => {
    // History restores the page component, but the current vault's tree stays in memory.
    if (vaultStore.id !== props.vault.id) {
        vaultTreeStore.initializeVaultTree(
            openedFile.value?.file.id ?? null,
            props.rootNodes,
            openedFile.value?.ancestors,
            openedFile.value?.ancestorsChildren
        );
    }
    vaultStore.setVault(props.vault);
    vaultRecentFileStore.setRecentFiles(props.recentFiles);
});

watch(
    () => props.openedFile,
    (openedFileProp, previous) => {
        openedFile.value = openedFileProp ?? null;
        vaultOpenedFileStore.set(
            openedFile.value?.links,
            openedFile.value?.backlinks,
            openedFile.value?.tags
        );

        if (openedFile.value) {
            // Local save/history updates must not replay an older tree snapshot.
            if (openedFileProp?.file.id !== previous?.file.id ||
                openedFileProp?.ancestors !== previous?.ancestors ||
                openedFileProp?.ancestorsChildren !== previous?.ancestorsChildren) {
                vaultTreeStore.handleFileOpened(
                    openedFile.value.file.id,
                    openedFile.value.ancestors ?? [],
                    openedFile.value.ancestorsChildren ?? {}
                );
            }
        } else {
            vaultTreeStore.setSelectedFileId(null);
            editorContext.value = null;
        }
    },
    { immediate: true }
);

watch(
    () => props.recentFiles,
    files => vaultRecentFileStore.setRecentFiles(files),
    { immediate: true }
);

watch(
    () => props.templateNodes,
    templates => vaultTemplateStore.setTemplates(templates ?? null),
    { immediate: true }
);

watch(isSmallScreen, value => {
    syncPanelsWithScreen(value);
});

useEcho<{ data: VaultUpdated }>(channel, 'VaultUpdatedEvent', payload => {
    vaultTreeActions.handleVaultUpdated(payload.data);
});

useEcho(channel, 'VaultDeletedEvent', () => {
    router.visit(index.url(), {
        replace: true,
        fresh: true,
        onSuccess: () => {
            createToast('Vault deleted', 'warning');
        },
    });
});

useEcho<{ data: VaultEditorTemplateFile[] | null }>(
    channel,
    'VaultTemplateListUpdatedEvent',
    payload => {
        vaultTemplateStore.setTemplates(payload.data);
    }
);

useEcho<{ data: VaultNode }>(channel, 'VaultNodeCreatedEvent', payload => {
    vaultTreeStore.handleNodeSaved(payload.data);

    if (payload.data.is_file) {
        vaultRecentFileStore.upsertRecentFile(payload.data);
    }
});

useEcho<{ data: VaultNode }>(channel, 'VaultNodeUpdatedEvent', payload => {
    vaultTreeActions.handleNodeUpdated(payload.data);

    if (payload.data.is_file) {
        vaultRecentFileStore.upsertRecentFile(payload.data);

        if (openedFile.value?.file.id === payload.data.id) {
            if (openedFile.value?.file.name !== payload.data.name) {
                openedFile.value.file.name = payload.data.name;
            }

            if (openedFile.value?.file.parent_id !== payload.data.parent_id) {
                openedFile.value.file.parent_id = payload.data.parent_id;
            }

            if (
                payload.data.type === 'note' &&
                openedFile.value?.file.content !== payload.data.content
            ) {
                openedFile.value.file.content = payload.data.content;
                editorContext.value?.setContent(payload.data.content ?? '');
            }
        }
    }
});

useEcho<{ data: VaultOpenedFileData }>(
    channel,
    'VaultOpenedFileDataUpdatedEvent',
    payload => {
        if (openedFile.value?.file.id !== payload.data.file.id) {
            return;
        }

        vaultOpenedFileStore.set(payload.data.links, payload.data.backlinks, payload.data.tags);
    }
);

useEcho<{ data: { deleted_ids: number[] } }>(
    channel,
    'VaultNodeDeletedEvent',
    payload => {
        vaultActions.handleNodesDeleted(payload.data.deleted_ids);
    }
);

useEcho<{ data: VaultCollaborator }>(
    channel,
    'VaultCollaborationCreatedEvent',
    ({ data }) => {
        vaultStore.addCollaborator(data);
    }
);

useEcho<{ data: VaultCollaborator }>(
    channel,
    'VaultCollaborationAcceptedEvent',
    ({ data }) => {
        vaultStore.updateCollaborator(data);
    }
);

useEcho<{ data: { user_id: number } }>(
    channel,
    'VaultCollaborationDeletedEvent',
    ({ data }) => {
        vaultStore.removeCollaborator(data.user_id);
    }
);
</script>

<template>
    <Head :title="openedFile?.file.name || vaultStore.name || vault.name || 'Docs'" />

    <Teleport defer to="#app-header">
        <div class="flex min-w-0 items-center gap-1 sm:gap-3" :class="isSmallScreen && showFormatting ? 'shrink-0' : 'flex-1'">
            <div class="flex shrink-0 items-center gap-1">
                <Link v-show="!isSmallScreen || !showFormatting" href="/vaults" aria-label="Docs home" title="Docs" class="hidden size-9 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring sm:inline-flex">
                    <Doc class="size-4.5" />
                </Link>
                <button
                    class="hover:bg-accent hover:text-accent-foreground inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors"
                    type="button"
                    aria-label="Toggle document tree"
                    :aria-expanded="isLeftPanelOpen"
                    @click="showFormatting = false; toggleLeftPanel(isSmallScreen)"
                >
                    <Bars3BottomLeft class="size-4" />
                </button>
            </div>
            <div v-show="!isSmallScreen || !showFormatting" id="file-header" class="flex min-w-0 flex-1 flex-col justify-center" aria-label="Document path" :title="documentPath.join(' / ')">
                <span v-if="openedFile && parentPath.length" class="text-muted-foreground w-full truncate text-[11px] leading-4" aria-label="Parent path">
                    {{ parentPath.join(' / ') }}
                </span>
                <span v-if="!openedFile" class="text-foreground truncate text-sm font-medium">{{ vaultStore.name || vault.name }}</span>
            </div>
        </div>
        <div id="file-tools" class="flex min-w-0 items-center" :class="isSmallScreen && showFormatting ? 'flex-1' : 'shrink-0'" :inert="layoutStore.isFileLoading"></div>
        <div class="flex shrink-0 items-center gap-1 lg:min-w-0 lg:flex-1 lg:justify-end">
            <div id="file-actions" class="flex shrink-0 items-center" :inert="layoutStore.isFileLoading"></div>
            <div v-show="!isSmallScreen || !showFormatting" class="flex shrink-0 items-center gap-1" :class="openedFile ? 'lg:ml-2 lg:border-l lg:pl-2' : ''">
            <button
                class="hover:bg-accent hover:text-accent-foreground inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors"
                type="button"
                aria-label="Search documents"
                @click="
                    openModal(VaultSearchModal, {
                        title: 'Search',
                        compact: true,
                        onSelect: (fileId: number) => vaultActions.openFile(fileId),
                    })
                "
            >
                <MagnifyingGlass class="size-4" />
            </button>
            <UserMenu />
            </div>
        </div>
    </Teleport>

    <Transition
        enter-active-class="ease-out duration-300"
        leave-active-class="ease-in duration-200"
    >
        <div
            v-if="isSmallScreen && isLeftPanelOpen"
            class="bg-background/60 fixed inset-0 z-20 opacity-50"
            @click="closePanels"
        ></div>
    </Transition>

    <aside
        scroll-region
        class="bg-popover border-border/60 absolute top-0 bottom-0 left-0 z-30 w-[80%] max-w-[300px] overflow-y-auto border-r transition-all duration-300 ease-in-out lg:static lg:max-w-[240px] print:hidden"
        :class="{
            '-translate-x-full': isSmallScreen && !isLeftPanelOpen,
            'translate-x-0': isSmallScreen && isLeftPanelOpen,
            'lg:w-0 lg:min-w-0': !isLeftPanelOpen,
            'lg:w-[240px] lg:min-w-[240px]': isLeftPanelOpen,
        }"
    >
        <VaultTree
            :vault-id="props.vault.id"
            :vault-name="vault.name"
            :vault-created-by="props.vault.created_by"
        />
    </aside>

    <section
        ref="mainSectionRef"
        :aria-busy="layoutStore.isFileLoading"
        class="relative h-full min-w-0 max-w-full flex-1 transition-all duration-300 ease-in-out"
    >
        <div v-if="layoutStore.isFileLoading" role="status" aria-label="Loading document" class="pointer-events-none absolute inset-x-0 top-0 z-20 h-px animate-pulse bg-foreground/40 motion-reduce:animate-none"></div>
        <div
            class="mx-auto flex h-full w-full flex-col transition-all duration-300 ease-in-out"
            :class="layoutStore.isContentWidthFull ? 'max-w-full' : 'max-w-[46rem]'"
        >
            <VaultFile
                v-if="openedFile"
                :key="openedFile.file.id"
                :inert="layoutStore.isFileLoading"
                :node="openedFile.file"
                @close="vaultActions.closeFile"
                @name-updated="router.replaceProp('openedFile.file.name', $event)"
            >
                <template v-if="openedFile.file.type === 'note'" #toolbar>
                    <MarkdownToolbar :vault-id="props.vault.id" :node-id="openedFile.file.id" :expanded="showFormatting" @toggle="showFormatting = !showFormatting" />
                </template>
                <component
                    :is="fileComponents[openedFile.file.type]"
                    v-if="openedFile.file.type !== 'folder'"
                    :node="openedFile.file"
                    @content-updated="router.replaceProp('openedFile.file.content', $event)"
                />
            </VaultFile>
            <div v-else class="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
                <p class="text-muted-foreground text-sm">Select a note</p>
                <Button variant="outline" class="h-11" @click="openModal(VaultNodeCreateModal, {
                    title: 'New note',
                    vaultId: props.vault.id,
                    parentId: null,
                    isFile: true,
                })">
                    <Plus class="size-3.5" aria-hidden="true" />
                    New note
                </Button>
            </div>
        </div>
    </section>

</template>
