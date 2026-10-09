<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Code2, Maximize2, Minus, Plus, Scan, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { mermaid } from '@/services/mermaid';

const props = defineProps<{ source: string }>();
const emit = defineEmits<{ code: [] }>();
const dark = ref(document.documentElement.classList.contains('dark'));
const content = computed(() => {
    const id = crypto.randomUUID();
    return { id, html: mermaid(props.source, dark.value, id) };
});
const frame = ref<HTMLIFrameElement>();
const modal = ref<HTMLDialogElement>();
const expanded = ref(false);
const ready = ref(false);
const error = ref('');
const expandButton = ref<InstanceType<typeof Button>>();
let timer: ReturnType<typeof setTimeout> | undefined;
const observer = new MutationObserver(() => { dark.value = document.documentElement.classList.contains('dark'); });
function pending() {
    ready.value = false;
    error.value = '';
    clearTimeout(timer);
    timer = setTimeout(() => { error.value = 'Unable to load Mermaid. Switch to code or reopen the preview to retry.'; }, 20000);
}
watch(content, pending, { immediate: true });
function message(event: MessageEvent) {
    if (event.source !== frame.value?.contentWindow || event.data?.type !== 'mermaid' || event.data.id !== content.value.id) return;
    if (!['ready', 'error'].includes(event.data.status)) return;
    clearTimeout(timer);
    ready.value = event.data.status === 'ready';
    error.value = ready.value ? '' : String(event.data.error || 'Unable to render diagram.');
}
function action(action: 'in' | 'out' | 'reset') {
    frame.value?.contentWindow?.postMessage({ type: 'mermaid', action }, '*');
}
async function open() {
    expanded.value = true;
    await nextTick();
    modal.value?.showModal();
}
async function close() {
    modal.value?.close();
    expanded.value = false;
    await nextTick();
    (expandButton.value?.$el as HTMLButtonElement | undefined)?.focus({ preventScroll: true });
}
onMounted(() => {
    window.addEventListener('message', message);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});
onBeforeUnmount(() => {
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('message', message);
    modal.value?.close();
});
</script>

<template>
    <div class="mermaid not-prose min-w-0" contenteditable="false">
        <dialog ref="modal" class="mermaid-modal" aria-label="Mermaid" @cancel.prevent="close" @click="event => { if (event.target === modal) close(); }" />
        <Teleport :to="modal || 'body'" :disabled="!expanded">
            <section class="mermaid-panel" :class="{ expanded }" aria-label="Mermaid diagram">
                <div class="mermaid-bar">
                    <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">Mermaid</span>
                    <Button v-if="!expanded" variant="ghost" size="icon" aria-label="Show Mermaid code" title="Code" @click="emit('code')"><Code2 class="size-4" /></Button>
                    <template v-if="ready">
                        <Button variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out" @click="action('out')"><Minus class="size-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label="Zoom in" title="Zoom in" @click="action('in')"><Plus class="size-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label="Reset view" title="Reset view" @click="action('reset')"><Scan class="size-4" /></Button>
                        <Button v-if="!expanded" ref="expandButton" variant="ghost" size="icon" aria-label="Expand Mermaid" title="Expand" @click="open"><Maximize2 class="size-4" /></Button>
                    </template>
                    <Button v-if="expanded" variant="ghost" size="icon" aria-label="Close Mermaid" title="Close" @click="close"><X class="size-4" /></Button>
                </div>
                <p v-if="error" role="alert" class="m-0 whitespace-pre-wrap break-words p-4 text-sm text-muted-foreground">{{ error }}</p>
                <p v-else-if="!ready" role="status" class="m-0 p-4 text-sm text-muted-foreground">Rendering diagram…</p>
                <iframe ref="frame" v-show="!error" title="Mermaid preview" sandbox="allow-scripts" referrerpolicy="no-referrer" :srcdoc="content.html" />
            </section>
        </Teleport>
    </div>
</template>

<style scoped>
.mermaid-panel { border: 1px solid var(--border); border-radius: .5rem; overflow: hidden; background: var(--background); color: var(--foreground); font-family: ui-sans-serif, system-ui, sans-serif; }
.mermaid-bar { display: flex; align-items: center; gap: 2px; padding: 4px 8px 4px 12px; border-bottom: 1px solid var(--border); }
.mermaid-bar button { flex-shrink: 0; width: 36px; height: 36px; }
iframe { display: block; width: 100%; height: clamp(240px, 44vw, 440px); max-height: 60dvh; border: 0; }
.mermaid-modal { margin: auto; padding: 0; border: 1px solid var(--border); border-radius: .75rem; width: calc(100vw - 24px); max-width: 1440px; height: calc(100dvh - 24px); max-height: 100dvh; background: var(--background); color: var(--foreground); overflow: hidden; }
.mermaid-modal::backdrop { background: rgb(0 0 0 / .65); }
.expanded { display: flex; flex-direction: column; height: 100%; border: 0; border-radius: 0; }
.expanded iframe { flex: 1; min-height: 0; height: auto; max-height: none; }
@media (max-width: 639px) { .mermaid-modal { width: 100vw; height: 100dvh; max-width: 100vw; border-radius: 0; border: 0; } }
</style>
