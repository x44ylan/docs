<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultNodeDeletedEvent;
use App\Events\VaultTemplateListUpdatedEvent;
use App\Models\Vault;
use App\Models\VaultNode;
use App\Services\VaultStorage;

final readonly class DeleteVaultNode
{
    /** @return array<int> */
    public function handle(VaultNode $node, bool $deleteFromDisk = true): array
    {
        $storage = app(VaultStorage::class);
        return $storage->run(function () use ($node, $deleteFromDisk, $storage): array {
            $vault = Vault::whereKey($node->vault_id)->lockForUpdate()->firstOrFail();
            $node->refresh();
            $node->setRelation('vault', $vault);
            $wasInTemplatesFolder = $node->isInTemplatesFolder();
            $path = app(GetPathFromVaultNode::class)->handle($node);
            $hasChildren = $node->children()->exists();
            $deletedNodeIds = $this->deleteFromDatabase($node);

            if ($deleteFromDisk) {
                $storage->remove($path, !$node->is_file);
                if ($node->is_file && $hasChildren) {
                    $storage->remove(substr($path, 0, -strlen('.' . $node->extension)), true);
                }
            }
            $storage->afterCommit(static function () use ($node, $deletedNodeIds, $wasInTemplatesFolder, $vault): void {
                broadcast(new VaultNodeDeletedEvent($node, $deletedNodeIds))->toOthers();
                if ($wasInTemplatesFolder) broadcast(new VaultTemplateListUpdatedEvent($vault));
            });
            return $deletedNodeIds;
        });
    }

    /** @return array<int> */
    private function deleteFromDatabase(VaultNode $node): array
    {
        $deletedNodeIds = [$node->id];
        foreach ($node->children()->get() as $child) {
            $deletedNodeIds = [...$deletedNodeIds, ...$this->deleteFromDatabase($child)];
        }
        $node->links()->detach();
        $node->backlinks()->detach();
        $node->tags()->detach();
        $node->delete();
        return $deletedNodeIds;
    }
}
