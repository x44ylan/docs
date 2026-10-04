<script setup lang="ts">
import Fullscreen from '@/icons/Fullscreen.vue';
import { useLayoutStore } from '@/stores/layout';

const layoutStore = useLayoutStore();
</script>

<template>
    <button
        v-if="layoutStore.showToggleContentWidthButton"
        type="button"
        class="hover:bg-accent hover:text-foreground inline-flex size-9 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        title="Toggle content width"
        @click="layoutStore.toggleContentWidth"
    >
        <Fullscreen class="size-4" />
    </button>
</template>
