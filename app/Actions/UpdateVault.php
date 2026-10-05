<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultListUpdatedEvent;
use App\Events\VaultUpdatedEvent;
use App\Models\Vault;
use App\Models\User;
use App\Services\VaultStorage;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

final readonly class UpdateVault
{
    /** @param array{name?: string, templates_node_id?: int|null} $attributes */
    public function handle(Vault $vault, array $attributes): Vault
    {
        $storage = app(VaultStorage::class);
        return $storage->run(function () use ($vault, $attributes, $storage): Vault {
            User::whereKey($vault->created_by)->lockForUpdate()->firstOrFail();
            Vault::whereKey($vault->id)->lockForUpdate()->firstOrFail();
            $vault->refresh();
            $originalName = $vault->name;
            $renamed = isset($attributes['name']) && $attributes['name'] !== $vault->name;

            if ($renamed) {
                $taken = Vault::where('created_by', $vault->created_by)->whereKeyNot($vault->id)
                    ->whereRaw('LOWER(name) = LOWER(?)', [$attributes['name']])->exists();
                $relativePath = app(GetPathFromUser::class)->handle($vault->user);
                if ($taken || Storage::disk('local')->exists($relativePath . $attributes['name'])) {
                    throw ValidationException::withMessages(['name' => 'A vault with this name already exists.']);
                }
            }
            if (isset($attributes['templates_node_id'])
                && $attributes['templates_node_id'] === $vault->templates_node_id) {
                $attributes['templates_node_id'] = null;
            }
            $vault->update($attributes);
            if ($renamed) $storage->move($relativePath . $originalName, $relativePath . $vault->name);

            $storage->afterCommit(static function () use ($vault, $renamed): void {
                broadcast(new VaultUpdatedEvent($vault))->toOthers();
                if (!$renamed) return;
                $collaborators = $vault->is_public
                    ? User::where('email', '!=', config('docs.agent'))->where('id', '!=', $vault->created_by)->get()
                    : $vault->collaborators()->get();
                broadcast(new VaultListUpdatedEvent($vault->user))->toOthers();
                foreach ($collaborators as $collaborator) {
                    broadcast(new VaultListUpdatedEvent($collaborator))->toOthers();
                }
            });
            return $vault;
        });
    }
}
