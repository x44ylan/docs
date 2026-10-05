<?php

declare(strict_types=1);

namespace App\Actions;

use App\Models\Vault;
use App\Models\VaultNode;
use App\Services\VaultFiles\Types\Note;
use RuntimeException;

final readonly class ProcessImportedFile
{
    public function handle(Vault $vault, ?VaultNode $parent, string $fileName, string $filePath): VaultNode
    {
        $createVaultNode = app(CreateVaultNode::class);

        $attributes = [
            'parent_id' => $parent?->id,
            'is_file' => true,
        ];
        $pathInfo = pathinfo($fileName);
        $attributes['name'] = $pathInfo['filename'];
        $attributes['extension'] = $pathInfo['extension'] ?? '';
        $attributes['content'] = null;

        if (in_array($attributes['extension'], Note::extensions())) {
            $attributes['extension'] = 'md';
            $content = file_get_contents($filePath);
            if ($content === false) throw new RuntimeException('Could not read the imported document.');
            $attributes['content'] = $content;
        }

        return $createVaultNode->handle($vault, $attributes, sourcePath: $attributes['extension'] === 'md' ? null : $filePath);
    }
}
