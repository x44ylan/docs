<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultNodeUpdatedEvent;
use App\Events\VaultOpenedFileDataUpdatedEvent;
use App\Events\VaultTagListUpdatedEvent;
use App\Events\VaultTemplateListUpdatedEvent;
use App\Models\Vault;
use App\Models\VaultNode;
use App\Services\VaultFiles\Types\Note;
use App\Services\VaultStorage;
use Illuminate\Validation\ValidationException;

final readonly class UpdateVaultNode
{
    /** @param array{parent_id?: int|null, name?: string, content?: string|null} $attributes */
    public function handle(
        VaultNode $node,
        array $attributes,
        bool $broadcastToCurrentUser = false,
    ): VaultNode {
        $storage = app(VaultStorage::class);
        return $storage->run(function () use ($node, $attributes, $broadcastToCurrentUser, $storage): VaultNode {
            $vault = Vault::whereKey($node->vault_id)->lockForUpdate()->firstOrFail();
            $node->refresh();
            $node->setRelation('vault', $vault);
            $originalPath = app(GetPathFromVaultNode::class)->handle($node);
            $hasChildren = $node->children()->exists();
            $locationChanged = (array_key_exists('name', $attributes) && $attributes['name'] !== $node->name)
                || (array_key_exists('parent_id', $attributes) && $attributes['parent_id'] !== $node->parent_id);
            $contentChanged = array_key_exists('content', $attributes) && $attributes['content'] !== $node->content;
            $nameChanged = isset($attributes['name']) && $attributes['name'] !== $node->name;
            $wasInTemplatesFolder = $locationChanged && $node->isInTemplatesFolder();
            $originalLinkPath = $locationChanged ? $node->fullPath() : '';

            if (array_key_exists('parent_id', $attributes)) {
                app(CheckParent::class)->handle($vault, $attributes['parent_id'], $node);
            }
            if ($locationChanged) {
                $requested = $attributes['name'] ?? $node->name;
                $available = app(GetAvailableVaultNodeName::class)->handle(
                    $vault, array_key_exists('parent_id', $attributes) ? $attributes['parent_id'] : $node->parent_id,
                    $node->is_file, $requested, $node->extension, $node->id,
                );
                if ($available !== $requested) {
                    throw ValidationException::withMessages(['name' => 'A document with this name already exists.']);
                }
            }
            $previousLinks = $contentChanged && $node->extension === 'md' ? $this->getLinks($node) : [];
            $previousTags = $contentChanged && $node->extension === 'md' ? $this->getTags($node) : [];

            $node->update($attributes);
            $node->unsetRelation('parent');
            if ($node->is_file && array_key_exists('content', $attributes) && in_array($node->extension, Note::extensions())) {
                $storage->write($originalPath, $attributes['content'] ?? '', true);
            }
            if ($node->is_file && $node->extension === 'md' && $contentChanged) {
                app(ProcessVaultNodeLinks::class)->handle($node);
                app(ProcessVaultNodeTags::class)->handle($node);
                $linksChanged = $previousLinks !== $this->getLinks($node);
                $tagsChanged = $previousTags !== $this->getTags($node);
                if ($linksChanged || $tagsChanged) {
                    $storage->afterCommit(static function () use ($node): void {
                        broadcast(new VaultOpenedFileDataUpdatedEvent($node));
                    });
                }
                if ($tagsChanged) {
                    $storage->afterCommit(static function () use ($vault): void {
                        broadcast(new VaultTagListUpdatedEvent($vault));
                    });
                }
            }

            if ($locationChanged) {
                $path = app(GetPathFromVaultNode::class)->handle($node);
                $storage->move($originalPath, $path);
                if ($node->is_file && $hasChildren) {
                    $suffix = strlen('.' . $node->extension);
                    $storage->move(substr($originalPath, 0, -$suffix), substr($path, 0, -$suffix));
                }
                app(UpdateVaultNodeBacklinks::class)->handle($node, $originalLinkPath);
                // Backlink processing can save a separately loaded copy of this note.
                $node->refresh();
            }

            $storage->afterCommit(static function () use ($node, $vault, $broadcastToCurrentUser, $locationChanged, $wasInTemplatesFolder, $nameChanged): void {
                $pending = broadcast(new VaultNodeUpdatedEvent($node));
                if (!$broadcastToCurrentUser) $pending->toOthers();
                unset($pending);

                if ($locationChanged && ($wasInTemplatesFolder || $node->isInTemplatesFolder())) {
                    broadcast(new VaultTemplateListUpdatedEvent($vault));
                }
                if ($nameChanged) {
                    foreach ($node->backlinks()->get() as $backlink) {
                        broadcast(new VaultOpenedFileDataUpdatedEvent($backlink))->toOthers();
                    }
                }
            });
            return $node;
        });
    }

    /** @return array<mixed> */
    private function getLinks(VaultNode $node): array
    {
        return $node->links()->get()->pluck('pivot.destination_id', 'pivot.position')->toArray();
    }

    /** @return array<mixed> */
    private function getTags(VaultNode $node): array
    {
        return $node->tags()->get()->pluck('pivot.tag_id', 'pivot.position')->toArray();
    }
}
