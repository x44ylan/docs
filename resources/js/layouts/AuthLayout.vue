<script setup lang="ts">
import ModalManager from '@/components/modal/ModalManager.vue';
import Sonner from '@/components/ui/sonner/Sonner.vue';
import Spinner from '@/icons/Spinner.vue';
import { useLayoutStore } from '@/stores/layout';
import { hydrateStoresFromPageProps } from '@/inertia/hydrateStores';
import { usePage } from '@inertiajs/vue3';
import { watch } from 'vue';
import AppLayout from './AppLayout.vue';

const page = usePage();
const layoutStore = useLayoutStore();

watch(
    () => page.props.app,
    () => hydrateStoresFromPageProps(page.props),
    { immediate: true }
);
</script>

<template>
    <AppLayout>
        <header
            class="bg-background text-muted-foreground border-border/60 relative z-40 h-15 shrink-0 border-b print:hidden"
        >
            <div id="app-header" class="flex h-full min-w-0 items-center justify-between gap-3 px-4"></div>
        </header>

        <main class="bg-background relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <slot />
        </main>

        <div
            v-if="layoutStore.isAppLoading"
            role="status"
            aria-label="Loading"
            class="bg-background/60 fixed inset-0 z-40 backdrop-blur-sm"
        >
            <div class="flex h-full items-center justify-center">
                <Spinner class="text-primary h-5 w-5 animate-spin" />
            </div>
        </div>

        <ModalManager />

        <Sonner />
    </AppLayout>
</template>
