<?php

declare(strict_types=1);

namespace App\Actions;

use App\Events\VaultListUpdatedEvent;
use App\Models\User;
use App\Models\Vault;
use App\Models\VaultNode;
use App\Rules\VaultNodeName;
use App\Services\VaultFile;
use App\Services\VaultFiles\Types\Note;
use App\Services\VaultStorage;
use finfo;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use ZipArchive;

final readonly class ProcessImportedVault
{
    public function handle(User $user, string $fileName, string $filePath): void
    {
        $vaultName = pathinfo(basename(str_replace('\\', '/', $fileName)), PATHINFO_FILENAME);
        Validator::make(['name' => $vaultName], ['name' => ['required', 'string', 'max:255', new VaultNodeName()]])->validate();
        $zip = new ZipArchive();
        if ($zip->open($filePath) !== true) $this->invalid('Could not open the vault archive.');

        $temporaryFiles = [];
        try {
            // Validate all declared and actual sizes before changing the database or vault storage.
            $entries = $this->entries($zip);
            $files = [];
            $directories = [];
            $metadata = [];
            $total = 0;
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            foreach ($entries as $path => $entry) {
                if ($entry['directory']) {
                    $directories[$path] = true;
                    continue;
                }
                $temporaryPath = tempnam(sys_get_temp_dir(), 'docs-import-');
                if ($temporaryPath === false) $this->invalid('Could not prepare the imported document.');
                $temporaryFiles[] = $temporaryPath;
                $temporary = fopen($temporaryPath, 'wb');
                if ($temporary === false) $this->invalid('Could not prepare the imported document.');
                $source = $zip->getStreamIndex($entry['index']);
                if ($source === false) {
                    fclose($temporary);
                    $this->invalid('Could not read an archive entry.');
                }
                try {
                    $bytes = 0;
                    while (!feof($source)) {
                        $chunk = fread($source, 65536);
                        if ($chunk === false || ($chunk === '' && !feof($source))) {
                            $this->invalid('Could not read an archive entry.');
                        }
                        $bytes += strlen($chunk);
                        $total += strlen($chunk);
                        if ($bytes > $this->limit('max_entry_bytes') || $total > $this->limit('max_total_bytes')
                            || ($path === '.docs.json' && $bytes > $this->limit('max_metadata_bytes'))) {
                            $this->invalid('The expanded archive exceeds the import limit.');
                        }
                        if (fwrite($temporary, $chunk) !== strlen($chunk)) {
                            $this->invalid('Could not prepare the imported document.');
                        }
                    }
                    if ($bytes !== $entry['size']) $this->invalid('An archive entry has an invalid size.');
                } finally {
                    fclose($source);
                    fclose($temporary);
                }
                if ($path === '.docs.json') {
                    try {
                        $metadata = json_decode((string) file_get_contents($temporaryPath), true, 64, JSON_THROW_ON_ERROR);
                    } catch (\JsonException) {
                        $this->invalid('The archive metadata is invalid.');
                    }
                    if (!is_array($metadata)) $this->invalid('The archive metadata is invalid.');
                    continue;
                }

                $info = pathinfo($path);
                $extension = strtolower($info['extension'] ?? '');
                $isNote = in_array($extension, Note::extensions(), true);
                $mime = $finfo->file($temporaryPath) ?: '';
                if (!($bytes === 0 && $isNote) && !VaultFile::validate($extension, $mime)) continue;
                $files[$path] = [
                    'name' => $info['filename'],
                    'extension' => $isNote ? 'md' : $extension,
                    'source' => $temporaryPath,
                ];
            }

            $noteParents = $metadata['note_parents'] ?? [];
            if (!is_array($noteParents) || !array_is_list($noteParents)) $this->invalid('The archive note parents are invalid.');
            $noteFiles = [];
            foreach ($files as $path => $file) {
                if ($file['extension'] !== 'md') continue;
                $parent = dirname($path);
                $stem = ($parent === '.' ? '' : $parent . '/') . $file['name'];
                $noteFiles[$stem][] = $path;
            }
            $parentNotes = [];
            foreach ($noteParents as $parentPath) {
                if (!is_string($parentPath)) $this->invalid('The archive note parents are invalid.');
                $parentPath = $this->path($parentPath);
                $matches = $noteFiles[$parentPath] ?? [];
                if (count($matches) !== 1) $this->invalid('An archive note parent is missing or ambiguous.');
                $parentNotes[$parentPath] = $matches[0];
                $directories[$parentPath] = true;
            }
            foreach (array_keys($files) as $path) {
                $parent = dirname($path);
                while ($parent !== '.') {
                    $directories[$parent] = true;
                    $parent = dirname($parent);
                }
            }
            foreach (array_keys($directories) as $path) {
                $parent = dirname($path);
                while ($parent !== '.') {
                    $directories[$parent] = true;
                    $parent = dirname($parent);
                }
            }
            if (count($files) + count($directories) > $this->limit('max_entries')) {
                $this->invalid('The archive contains too many documents or folders.');
            }

            $storage = app(VaultStorage::class);
            $storage->run(function () use ($user, $vaultName, $files, $directories, $parentNotes, $storage): void {
                $vault = app(CreateVault::class)->handle($user, ['name' => $vaultName], false);
                $ids = ['.' => null];
                $createdFiles = [];
                $createDirectory = function (string $path) use (&$createDirectory, &$ids, &$createdFiles, $files, $parentNotes, $vault): ?int {
                    if (array_key_exists($path, $ids)) return $ids[$path];
                    $parentId = $createDirectory(dirname($path));
                    if (isset($parentNotes[$path])) {
                        $filePath = $parentNotes[$path];
                        $node = $this->createFile($vault, $parentId, $files[$filePath]);
                        $createdFiles[$filePath] = true;
                    } else {
                        $node = app(CreateVaultNode::class)->handle($vault, [
                            'parent_id' => $parentId, 'is_file' => false, 'name' => basename($path),
                        ], false, false);
                    }
                    return $ids[$path] = $node->id;
                };
                foreach (array_keys($directories) as $path) $createDirectory($path);
                foreach ($files as $path => $file) {
                    if (!isset($createdFiles[$path])) $this->createFile($vault, $createDirectory(dirname($path)), $file);
                }
                app(ProcessVaultLinks::class)->handle($vault);
                app(ProcessVaultTags::class)->handle($vault);
                $storage->afterCommit(static function () use ($user): void {
                    broadcast(new VaultListUpdatedEvent($user))->toOthers();
                });
            });
        } finally {
            foreach ($temporaryFiles as $temporaryPath) {
                if (is_file($temporaryPath) && !unlink($temporaryPath)) {
                    report(new \RuntimeException('Could not remove an import temporary file.'));
                }
            }
            $zip->close();
        }
    }

    /** @return array<string, array{index: int, size: int, directory: bool}> */
    private function entries(ZipArchive $zip): array
    {
        if ($zip->numFiles > $this->limit('max_entries')) $this->invalid('The archive contains too many entries.');
        $entries = [];
        $total = 0;
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $stat = $zip->statIndex($index);
            if ($stat === false) $this->invalid('Could not read an archive entry.');
            $directory = str_ends_with(str_replace('\\', '/', $stat['name']), '/');
            $path = $this->path(rtrim($stat['name'], '/\\'));
            if (isset($entries[$path])) $this->invalid('The archive contains duplicate paths.');
            $size = (int) $stat['size'];
            if ($size < 0 || $size > $this->limit('max_entry_bytes')) $this->invalid('An archive entry exceeds the import limit.');
            $total += $size;
            if ($total > $this->limit('max_total_bytes')) $this->invalid('The expanded archive exceeds the import limit.');
            $entries[$path] = ['index' => $index, 'size' => $size, 'directory' => $directory];
        }
        return $entries;
    }

    private function path(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        $pieces = explode('/', $path);
        if ($path === '' || str_starts_with($path, '/') || preg_match('/^[a-z]:/i', $path)
            || preg_match('/[\x00-\x1f\x7f]/', $path) || !mb_check_encoding($path, 'UTF-8')
            || count($pieces) > $this->limit('max_depth')) {
            $this->invalid('The archive contains an invalid document path.');
        }
        foreach ($pieces as $piece) {
            if ($piece === '' || $piece === '.' || $piece === '..' || strlen($piece) > 255) {
                $this->invalid('The archive contains an invalid document path.');
            }
        }
        return $path;
    }

    /** @param array{name: string, extension: string, source: string} $file */
    private function createFile(Vault $vault, ?int $parentId, array $file): VaultNode
    {
        $content = null;
        if ($file['extension'] === 'md') {
            $content = file_get_contents($file['source']);
            if ($content === false) $this->invalid('Could not read the imported document.');
        }
        return app(CreateVaultNode::class)->handle($vault, [
            'parent_id' => $parentId, 'is_file' => true, 'name' => $file['name'],
            'extension' => $file['extension'], 'content' => $content,
        ], false, false, $file['extension'] === 'md' ? null : $file['source']);
    }

    private function limit(string $name): int
    {
        return max(1, (int) config('docs.import.' . $name));
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['file' => $message]);
    }
}
