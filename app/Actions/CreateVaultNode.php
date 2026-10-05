<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultNodeCreatedEvent;
use App\Events\VaultTemplateListUpdatedEvent;
use App\Models\Vault;
use App\Models\VaultNode;
use App\Services\VaultStorage;
use RuntimeException;

final readonly class CreateVaultNode
{
    /**
     * @param array{parent_id?: int|null, is_file: bool, name: string,
     *   extension?: string|null, content?: string|null} $attributes
     */
    public function handle(
        Vault $vault,
        array $attributes,
        bool $processLinksAndTags = true,
        bool $broadcast = true,
        ?string $sourcePath = null,
    ): VaultNode {
        $storage = app(VaultStorage::class);
        return $storage->run(function () use ($vault, $attributes, $processLinksAndTags, $broadcast, $sourcePath, $storage): VaultNode {
            Vault::whereKey($vault->id)->lockForUpdate()->firstOrFail();
            $vault->refresh();
            $attributes['parent_id'] ??= null;
            $attributes['extension'] ??= null;
            $attributes['content'] ??= null;
            app(CheckParent::class)->handle($vault, $attributes['parent_id']);
            $attributes['name'] = app(GetAvailableVaultNodeName::class)->handle(
                $vault, $attributes['parent_id'], $attributes['is_file'], $attributes['name'], $attributes['extension'],
            );

            $node = $vault->nodes()->create([
                'parent_id' => $attributes['parent_id'],
                'is_file' => $attributes['is_file'],
                'name' => $attributes['name'],
                'extension' => $attributes['extension'],
                'content' => $attributes['extension'] === 'md' ? $attributes['content'] : null,
            ]);
            $nodePath = app(GetPathFromVaultNode::class)->handle($node);
            if (!$node->is_file) {
                $storage->createDirectory($nodePath);
            } else {
                $stream = $sourcePath === null ? null : fopen($sourcePath, 'rb');
                if ($sourcePath !== null && $stream === false) {
                    throw new RuntimeException('Could not read the imported document.');
                }
                try {
                    $storage->write($nodePath, $stream ?? $attributes['content'] ?? '');
                } finally {
                    if (is_resource($stream)) fclose($stream);
                }
                if ($node->extension === 'md' && $processLinksAndTags) {
                    app(ProcessVaultNodeLinks::class)->handle($node);
                    app(ProcessVaultNodeTags::class)->handle($node);
                }
            }

            if ($broadcast) {
                $storage->afterCommit(static function () use ($node, $vault): void {
                    broadcast(new VaultNodeCreatedEvent($node))->toOthers();
                    if ($node->isTemplate()) broadcast(new VaultTemplateListUpdatedEvent($vault));
                });
            }
            return $node;
        });
    }
}
