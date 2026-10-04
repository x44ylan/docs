<script setup lang="ts">
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

defineProps<{ disabled?: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const closeMenu = () => {
    open.value = false;
};
</script>

<template>
    <DropdownMenu v-model:open="open" :modal="false">
        <DropdownMenuTrigger as-child :disabled="disabled">
            <slot name="trigger" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
            align="start"
            :side-offset="6"
            class="max-h-[var(--reka-dropdown-menu-content-available-height)] max-w-[calc(100vw-1rem)] overflow-y-auto"
        >
            <slot :close-menu="closeMenu" />
        </DropdownMenuContent>
    </DropdownMenu>
</template>
