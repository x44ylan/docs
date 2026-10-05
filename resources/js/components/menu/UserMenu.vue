<script setup lang="ts">
import { useModalManager } from '@/composables/useModalManager';
import { useTheme } from '@/composables/useTheme';
import ProfileEditModal from '@/components/modal/ProfileEditModal.vue';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Moon from '@/icons/Moon.vue';
import Sun from '@/icons/Sun.vue';
import User from '@/icons/User.vue';
import ArrowUpTray from '@/icons/ArrowUpTray.vue';
import { logout } from '@/routes/index';
import { useUserStore } from '@/stores/user';
import { Link } from '@inertiajs/vue3';
import { computed } from 'vue';

const { isDark, toggleTheme } = useTheme();
const { openModal } = useModalManager();
const userStore = useUserStore();

const name = computed(() => userStore.name ?? '');
const email = computed(() => userStore.email ?? '');
</script>

<template>
    <DropdownMenu>
        <DropdownMenuTrigger
            class="hover:bg-accent hover:text-accent-foreground inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors"
            aria-label="User menu"
        >
            <User class="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" :side-offset="8" class="w-60">
            <div class="flex min-w-0 flex-col gap-0.5 px-2 py-2.5">
                <span class="truncate text-sm font-semibold" :title="name">{{ name }}</span>
                <span class="text-muted-foreground truncate text-xs" :title="email">
                    {{ email }}
                </span>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem @click="openModal(ProfileEditModal, { title: 'Rename' })">
                <User />
                Rename
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem @click="toggleTheme">
                <Sun v-if="isDark" />
                <Moon v-else />
                {{ isDark ? 'Light mode' : 'Dark mode' }}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem class="text-destructive focus:text-destructive" :as-child="true">
                <Link :href="logout.url()" method="post">
                    <ArrowUpTray class="rotate-90" />
                    Logout
                </Link>
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
</template>
