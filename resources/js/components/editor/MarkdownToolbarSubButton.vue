<script setup lang="ts">
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { Component } from 'vue';

defineProps<{ icon: Component; iconRotate?: boolean; title: string }>();
const emit = defineEmits<{ click: [event: Event] }>();
</script>

<template>
    <DropdownMenuItem class="min-h-11 sm:min-h-8" @select="emit('click', $event)">
        <component :is="icon" :class="iconRotate ? 'rotate-180' : ''" aria-hidden="true" />
        <span>{{ title }}</span>
    </DropdownMenuItem>
</template>
