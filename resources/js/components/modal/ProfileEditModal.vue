<script setup lang="ts">
import { update } from '@/actions/App/Http/Controllers/ProfileController';
import ModelInput from '@/components/form/ModelInput.vue';
import Submit from '@/components/form/Submit.vue';
import { Button } from '@/components/ui/button';
import { useModalManager } from '@/composables/useModalManager';
import { useRequest } from '@/composables/useRequest';
import { useToast } from '@/composables/useToast';
import { useUserStore } from '@/stores/user';
import { User } from '@/types';

const userStore = useUserStore();
const { closeModal } = useModalManager();
const { createToast } = useToast();

const form = useRequest<{ name: string }>({
    name: userStore.name ?? '',
});

const handleSubmit = () => {
    form.patch(update.url(), {
        onSuccess: (response: { user: User }) => {
            closeModal();
            createToast('Name updated', 'success');
            userStore.setUser(response.user);
        },
    });
};
</script>

<template>
    <form
        class="flex flex-col gap-6 inert:pointer-events-none"
        autocomplete="off"
        novalidate
        :inert="form.processing"
        @submit.prevent="handleSubmit"
    >
        <ModelInput
            v-model="form.name"
            name="name"
            type="text"
            label="Display name"
            :error="form.errors.name"
            required
            autofocus
        />
        <div class="flex justify-end gap-2 py-1">
            <Button variant="outline" @click="closeModal">Cancel</Button>
            <Submit label="Save" :processing="form.processing" />
        </div>
    </form>
</template>
