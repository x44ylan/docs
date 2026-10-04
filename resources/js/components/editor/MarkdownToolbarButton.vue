<script setup lang="ts">
import { Button } from '@/components/ui/button';
import type { Component } from 'vue';

defineProps<{ icon: Component; title: string; active?: boolean }>();
</script>

<template>
    <Button
        variant="ghost"
        size="icon"
        class="size-9 shrink-0"
        :title="title"
        :aria-label="title"
        :aria-pressed="active"
        :class="active ? 'bg-accent text-accent-foreground' : ''"
    >
        <component :is="icon" class="size-4" aria-hidden="true" />
    </Button>
</template>
