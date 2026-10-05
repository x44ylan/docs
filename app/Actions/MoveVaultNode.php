<?php

declare(strict_types=1);

namespace App\Actions;

use App\Models\Vault;
use App\Models\VaultNode;
use App\Services\VaultStorage;

final readonly class MoveVaultNode
{
    public function handle(VaultNode $node, ?int $parentId): VaultNode
    {
        return app(VaultStorage::class)->run(function () use ($node, $parentId): VaultNode {
            $vault = Vault::whereKey($node->vault_id)->lockForUpdate()->firstOrFail();
            $node->refresh();
            app(CheckParent::class)->handle($vault, $parentId, $node);

            $name = app(GetAvailableVaultNodeName::class)->handle(
                $vault,
                $parentId,
                $node->is_file,
                $node->name,
                $node->extension,
                $node->id,
            );

            return app(UpdateVaultNode::class)->handle($node, [
                'parent_id' => $parentId,
                'name' => $name,
            ]);
        });
    }
}
