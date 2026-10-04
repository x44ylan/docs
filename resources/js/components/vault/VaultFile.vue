<script setup lang="ts">
import VaultNodeController from '@/actions/App/Http/Controllers/VaultNodeController';
import TextError from '@/components/form/TextError.vue';
import VaultFileUpdatingSpinner from '@/components/vault/VaultFileUpdatingSpinner.vue';
import VaultToggleContentWidthButton from '@/components/vault/VaultToggleContentWidthButton.vue';
import { useRequest } from '@/composables/useRequest';
import { useAutosave } from '@/composables/useAutosave';
import { useVaultActions } from '@/composables/useVaultActions';
import XMark from '@/icons/XMark.vue';
import { useLayoutStore } from '@/stores/layout';
import { useVaultTreeStore } from '@/stores/vaultTree';
import { VaultNode } from '@/types/vault';
import { computed, onBeforeUnmount, ref, useId, useSlots, watch } from 'vue';

interface VaultFileProps {
    node: VaultNode;
}

interface VaultFileEmits {
    nameUpdated: [name: string];
}

const props = defineProps<VaultFileProps>();
const emit = defineEmits<VaultFileEmits>();

const slots = useSlots();
const layoutStore = useLayoutStore();
const vaultTreeStore = useVaultTreeStore();
const vaultActions = useVaultActions();

const form = useRequest<{ name: string }>({ name: props.node.name });

const name = ref(props.node.name);

const nameError = computed(() => form.errors.name);
const nameErrorId = `file-name-${useId()}-error`;

let mounted = true;
const url = VaultNodeController.update.url({ vault: props.node.vault_id, node: props.node.id });
const save = useAutosave(value => new Promise(resolve => {
    layoutStore.setVaultNodeUpdating(true);
    form.name = value;
    let saved = false;
    form.patch(url, {
        onSuccess: (response: { data: VaultNode }) => {
            saved = true;
            if (mounted && name.value === value) emit('nameUpdated', response.data.name);
            vaultTreeStore.handleNodeSaved(response.data);
        },
        onFinish: () => {
            layoutStore.setVaultNodeUpdating(false);
            resolve(saved);
        },
    });
}));
onBeforeUnmount(() => { mounted = false; });
function rename(value: string): void { form.clearErrors('name'); save(value); }

watch(
    () => props.node.name,
    value => {
        name.value = value;
        form.clearErrors('name');
    }
);
</script>

<template>
    <div class="flex h-full w-full flex-col">
        <Teleport defer to="#file-header">
            <div class="relative flex w-full min-w-0 items-center" :inert="layoutStore.isFileLoading">
                <input
                    v-model="name"
                    class="text-foreground min-w-0 flex-1 truncate rounded-sm border-0 bg-transparent p-0 text-base font-medium focus-visible:ring-1 focus-visible:ring-ring lg:text-sm"
                    type="text"
                    aria-label="Document title"
                    :title="name"
                    spellcheck="false"
                    autocomplete="off"
                    :aria-invalid="!!nameError"
                    :aria-describedby="nameError ? nameErrorId : undefined"
                    @input="rename(name)"
                />
                <div class="text-muted-foreground pointer-events-none absolute right-0 flex items-center bg-background">
                    <VaultFileUpdatingSpinner />
                </div>
            </div>
        </Teleport>
        <Teleport defer to="#file-tools">
            <slot name="toolbar" />
        </Teleport>
        <Teleport defer to="#file-actions">
            <div v-if="!slots.toolbar" class="text-muted-foreground flex shrink-0 items-center gap-1">
                <VaultToggleContentWidthButton />
                <button class="hover:bg-accent hover:text-foreground inline-flex size-9 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring" title="Close file" @click="vaultActions.closeFile">
                    <XMark class="size-4" />
                </button>
            </div>
        </Teleport>
        <TextError v-if="nameError" :id="nameErrorId" class="px-4 pt-2 sm:px-8" :text="nameError" />
        <div class="mb-4 flex min-h-0 w-full flex-grow overflow-y-auto pt-5 sm:pt-8">
            <slot />
        </div>
    </div>
</template>
