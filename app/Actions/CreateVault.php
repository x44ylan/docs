<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultListUpdatedEvent;
use App\Models\User;
use App\Models\Vault;
use App\Services\VaultStorage;
use Illuminate\Support\Facades\Storage;

final readonly class CreateVault
{
    /** @param array{name: string} $attributes */
    public function handle(User $user, array $attributes, bool $broadcast = true): Vault
    {
        $storage = app(VaultStorage::class);
        return $storage->run(function () use ($user, $attributes, $broadcast, $storage): Vault {
            User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            $baseName = $attributes['name'];
            $userPath = app(GetPathFromUser::class)->handle($user);
            $suffix = 0;
            while ($user->vaults()->whereRaw('LOWER(name) = LOWER(?)', [$attributes['name']])->exists()
                || Storage::disk('local')->exists($userPath . $attributes['name'])) {
                $ending = '-' . ++$suffix;
                $attributes['name'] = mb_substr($baseName, 0, 255 - strlen($ending)) . $ending;
            }

            $vault = $user->vaults()->create($attributes);
            $storage->createDirectory(app(GetPathFromVault::class)->handle($vault));
            if ($broadcast) {
                $storage->afterCommit(static function () use ($user): void {
                    broadcast(new VaultListUpdatedEvent($user))->toOthers();
                });
            }
            return $vault;
        });
    }
}
