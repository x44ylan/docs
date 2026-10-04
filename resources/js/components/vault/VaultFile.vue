<script setup lang="ts">
import VaultNodeController from '@/actions/App/Http/Controllers/VaultNodeController';
import TextError from '@/components/form/TextError.vue';
import VaultFileUpdatingSpinner from '@/components/vault/VaultFileUpdatingSpinner.vue';
import VaultToggleContentWidthButton from '@/components/vault/VaultToggleContentWidthButton.vue';
import { useRequest } from '@/composables/useRequest';
import { useAutosave } from '@/composables/useAutosave';
import { useScreenSize } from '@/composables/useScreenSize';
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
const { isSmallScreen: isPhone } = useScreenSize(640);

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
        <div v-show="slots.toolbar || !isPhone || nameError" class="z-[15] flex flex-col px-4 pt-2 pb-3 sm:px-8 sm:pt-5 print:hidden" :class="slots.toolbar ? 'gap-2' : ''">
            <Teleport defer to="#file-header" :disabled="!isPhone">
                <div class="flex min-w-0 w-full items-center justify-between gap-2">
                    <input
                        v-model="name"
                        class="text-foreground min-w-0 flex-1 truncate rounded-sm border-0 bg-transparent p-0 text-base font-medium focus-visible:ring-1 focus-visible:ring-ring"
                        type="text"
                        aria-label="Document title"
                        :title="name"
                        spellcheck="false"
                        autocomplete="off"
                        :aria-invalid="!!nameError"
                        :aria-describedby="nameError ? nameErrorId : undefined"
                        @input="rename(name)"
                    />
                    <div class="text-muted-foreground flex shrink-0 items-center gap-1">
                        <VaultFileUpdatingSpinner />
                        <VaultToggleContentWidthButton />
                        <button v-if="!isPhone" class="hover:bg-accent hover:text-foreground inline-flex size-9 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring" title="Close file" @click="vaultActions.closeFile">
                            <XMark class="size-4" />
                        </button>
                    </div>
                </div>
            </Teleport>
            <TextError v-if="nameError" :id="nameErrorId" class="px-1" :text="nameError" />
            <slot name="toolbar" />
        </div>
        <div class="mb-4 flex min-h-0 w-full flex-grow overflow-y-auto">
            <slot />
        </div>
    </div>
</template>
