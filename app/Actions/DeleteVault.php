<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultDeletedEvent;
use App\Events\VaultListUpdatedEvent;
use App\Models\Vault;
use App\Models\User;
use App\Services\VaultStorage;

final readonly class DeleteVault
{
    public function handle(Vault $vault): void
    {
        $storage = app(VaultStorage::class);
        $storage->run(function () use ($vault, $storage): void {
            User::whereKey($vault->created_by)->lockForUpdate()->firstOrFail();
            Vault::whereKey($vault->id)->lockForUpdate()->firstOrFail();
            $vault->refresh();
            $collaborators = $vault->is_public
                ? User::where('email', '!=', config('docs.agent'))->where('id', '!=', $vault->created_by)->get()
                : $vault->collaborators()->get();
            $deleted = new VaultDeletedEvent($vault);
            $path = app(GetPathFromVault::class)->handle($vault);

            $vault->collaborators()->detach();
            foreach ($vault->nodes()->with('vault.user')->whereNull('parent_id')->get() as $node) {
                app(DeleteVaultNode::class)->handle($node, false);
            }
            $vault->delete();
            $storage->remove($path, true);
            $storage->afterCommit(static function () use ($vault, $collaborators, $deleted): void {
                broadcast(new VaultListUpdatedEvent($vault->user))->toOthers();
                foreach ($collaborators as $collaborator) {
                    broadcast(new VaultListUpdatedEvent($collaborator))->toOthers();
                }
                broadcast($deleted)->toOthers();
            });
        });
    }
}
