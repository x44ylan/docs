<?php

declare(strict_types=1);

namespace App\Services;

use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Coordinates database changes with reversible local filesystem operations. */
final class VaultStorage
{
    private bool $active = false;

    /** @var list<Closure> */
    private array $undo = [];

    /** @var list<Closure> */
    private array $complete = [];

    /** @template T @param Closure(): T $operation @return T */
    public function run(Closure $operation): mixed
    {
        if ($this->active) return $operation();
        if (DB::transactionLevel() !== 0) {
            throw new RuntimeException('Vault storage must own the database transaction.');
        }

        $this->active = true;
        $committed = false;
        try {
            DB::beginTransaction();
            // Set before search-index callbacks, which can fail after commit.
            DB::afterCommit(static function () use (&$committed): void { $committed = true; });
            $result = $operation();
            try {
                DB::commit();
            } catch (Throwable $error) {
                if (!$committed) throw $error;
                report($error);
            }
        } catch (Throwable $error) {
            try {
                // Keep transaction locks until ordinary filesystem compensation finishes.
                foreach (array_reverse($this->undo) as $undo) {
                    try { $undo(); } catch (Throwable $rollbackError) { report($rollbackError); }
                }
            } finally {
                try {
                    if (DB::transactionLevel() > 0) DB::rollBack();
                } finally {
                    $this->reset();
                }
            }
            throw $error;
        }

        $complete = $this->complete;
        $this->reset();
        foreach ($complete as $callback) {
            try { $callback(); } catch (Throwable $error) { report($error); }
        }
        return $result;
    }

    public function afterCommit(Closure $callback): void
    {
        $this->complete[] = $callback;
    }

    public function createDirectory(string $path): void
    {
        $path = rtrim($path, '/');
        if (Storage::disk('local')->exists($path)) {
            throw new RuntimeException('The destination already exists on disk.');
        }
        $this->ensureDirectory(dirname($path));
        if (!Storage::disk('local')->makeDirectory($path)) {
            throw new RuntimeException('Could not create the document directory.');
        }
        $this->undo[] = function () use ($path): void { $this->deleteDirectory($path); };
    }

    /** @param string|resource $content */
    public function write(string $path, mixed $content, bool $replace = false): void
    {
        $disk = Storage::disk('local');
        if (!$replace && $disk->exists($path)) {
            throw new RuntimeException('The destination already exists on disk.');
        }
        if ($replace && $disk->directoryExists($path)) {
            throw new RuntimeException('The document destination is a directory.');
        }
        $this->ensureDirectory(dirname($path));
        $temporary = dirname($path) . '/.docs-' . Str::random(16) . '.tmp';
        $this->undo[] = function () use ($temporary): void { $this->deleteFile($temporary); };
        if (!$disk->put($temporary, $content)) {
            throw new RuntimeException('Could not save the document.');
        }

        if ($disk->exists($path)) {
            $backup = dirname($path) . '/.docs-' . Str::random(16) . '.bak';
            if (!$disk->move($path, $backup)) {
                throw new RuntimeException('Could not preserve the original document.');
            }
            $this->undo[] = static function () use ($backup, $path): void {
                if (!Storage::disk('local')->move($backup, $path)) {
                    throw new RuntimeException('Could not restore the original document.');
                }
            };
            $this->complete[] = function () use ($backup): void { $this->deleteFile($backup); };
        }
        if (!$disk->move($temporary, $path)) {
            throw new RuntimeException('Could not finalize the document.');
        }
        $this->undo[] = function () use ($path): void { $this->deleteFile($path); };
    }

    public function move(string $from, string $to): void
    {
        if ($from === $to) return;
        $disk = Storage::disk('local');
        if ($disk->exists($to)) throw new RuntimeException('The destination already exists on disk.');
        $this->ensureDirectory(dirname($to));
        if (!$disk->move($from, $to)) throw new RuntimeException('Could not move the document.');
        $this->undo[] = static function () use ($from, $to): void {
            if (!Storage::disk('local')->move($to, $from)) {
                throw new RuntimeException('Could not restore the document location.');
            }
        };
    }

    /** Remove access now; defer irreversible cleanup until the database commits. */
    public function remove(string $path, bool $directory): void
    {
        $path = rtrim($path, '/');
        if (!Storage::disk('local')->exists($path)) return;
        $quarantine = dirname($path) . '/.docs-' . Str::random(16) . '.trash';
        $this->move($path, $quarantine);
        $this->complete[] = function () use ($quarantine, $directory): void {
            if ($directory) $this->deleteDirectory($quarantine);
            else $this->deleteFile($quarantine);
        };
    }

    private function ensureDirectory(string $path): void
    {
        if ($path === '.' || $path === '') return;
        $disk = Storage::disk('local');
        if ($disk->directoryExists($path)) return;
        if ($disk->exists($path)) throw new RuntimeException('A file occupies the document directory.');
        $this->ensureDirectory(dirname($path));
        if (!$disk->makeDirectory($path)) throw new RuntimeException('Could not create the document directory.');
        $this->undo[] = function () use ($path): void { $this->deleteDirectory($path); };
    }

    private function deleteFile(string $path): void
    {
        $disk = Storage::disk('local');
        if ($disk->exists($path) && !$disk->delete($path)) {
            throw new RuntimeException('Could not clean up the temporary document.');
        }
    }

    private function deleteDirectory(string $path): void
    {
        $disk = Storage::disk('local');
        if ($disk->exists($path) && !$disk->deleteDirectory($path)) {
            throw new RuntimeException('Could not clean up the document directory.');
        }
    }

    private function reset(): void
    {
        $this->active = false;
        $this->undo = [];
        $this->complete = [];
    }
}
