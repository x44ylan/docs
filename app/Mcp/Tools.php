<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Actions\CreateVaultNode;
use App\Actions\MoveVaultNode;
use App\Actions\UpdateVaultNode;
use App\Models\User;
use App\Models\Vault;
use App\Models\VaultNode;
use App\Queries\Vaults\VisibleVaultsQuery;
use App\Rules\VaultNodeName;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

final class Tools
{
    /** @return non-empty-list<array<string, mixed>> */
    public function definitions(): array
    {
        $id = ['type' => 'integer', 'minimum' => 1];
        $page = ['type' => 'integer', 'minimum' => 1, 'maximum' => 100000, 'default' => 1];
        $text = ['type' => 'string', 'maxLength' => 1000000];
        $definitions = [
            ['me', 'Show the signed-in Docs user. Browser and MCP share this account and its vault permissions.', [], []],
            ['vaults', 'List accessible vaults.', ['page' => $page], []],
            ['list', 'List Markdown documents in a vault.', ['vaultId' => $id, 'page' => $page], ['vaultId']],
            ['search', 'Search accessible Markdown names and content.', ['query' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 200], 'vaultId' => $id, 'page' => $page], ['query']],
            ['read', 'Read a Markdown document.', ['noteId' => $id], ['noteId']],
            ['create', 'Create a Markdown document in an accessible vault.', ['vaultId' => $id, 'parentId' => $id, 'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 255], 'content' => $text], ['vaultId', 'name', 'content']],
            ['update', 'Append (default), prepend or explicitly replace Markdown content.', ['noteId' => $id, 'content' => $text, 'operation' => ['type' => 'string', 'enum' => ['append', 'prepend', 'replace'], 'default' => 'append']], ['noteId', 'content']],
            ['move', 'Move a Markdown document and its sub-notes under a note or folder in the same vault. Set parentId to null for the vault root. Preserves IDs, attachments and links; duplicate names receive a suffix. Returns the new name and parent_id.', ['noteId' => $id, 'parentId' => ['type' => ['integer', 'null'], 'minimum' => 1]], ['noteId', 'parentId']],
        ];

        /** @var non-empty-list<array<string, mixed>> $tools */
        $tools = array_map(fn (array $tool): array => [
            'name' => $tool[0], 'description' => $tool[1],
            'inputSchema' => ['type' => 'object', 'properties' => (object) $tool[2], 'required' => $tool[3], 'additionalProperties' => false],
            'annotations' => ['readOnlyHint' => ! in_array($tool[0], ['create', 'update', 'move']), 'destructiveHint' => $tool[0] === 'update', 'openWorldHint' => false],
        ], $definitions);

        return $tools;
    }

    /** @return array<string, mixed> */
    public function call(object $params, User $user): array
    {
        try {
            $name = $params->name ?? '';
            abort_unless(! isset($params->arguments) || is_object($params->arguments), 400);
            abort_unless(in_array($name, array_column($this->definitions(), 'name'), true), 400);
            $definition = collect($this->definitions())->firstWhere('name', $name);
            $schema = (array) $definition['inputSchema']['properties'];
            $args = (array) ($params->arguments ?? []);
            if (array_diff(array_keys($args), array_keys($schema)) !== []) {
                throw ValidationException::withMessages(['arguments' => 'Unexpected tool arguments.']);
            }
            foreach ($args as $field => $value) {
                $types = (array) ($schema[$field]['type'] ?? []);
                if (in_array('integer', $types, true) && ! is_int($value) && ! ($value === null && in_array('null', $types, true))) {
                    throw ValidationException::withMessages([$field => "The {$field} field must be an integer."]);
                }
            }
            $data = Validator::make($args, [
                'vaultId' => [in_array($name, ['list', 'create']) ? 'required' : 'sometimes', 'integer', 'min:1'],
                'noteId' => [in_array($name, ['read', 'update', 'move']) ? 'required' : 'sometimes', 'integer', 'min:1'],
                'parentId' => $name === 'move' ? ['present', 'nullable', 'integer', 'min:1'] : ['sometimes', 'integer', 'min:1'],
                'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
                'query' => [$name === 'search' ? 'required' : 'sometimes', 'string', 'min:1', 'max:200'],
                'name' => [$name === 'create' ? 'required' : 'sometimes', 'string', 'min:1', 'max:255', new VaultNodeName],
                'content' => [in_array($name, ['create', 'update']) ? 'present' : 'sometimes', 'string', 'max:1000000'],
                'operation' => ['sometimes', 'in:append,prepend,replace'],
            ])->validate();
            $visible = app(VisibleVaultsQuery::class)($user)->select('id');
            $notes = VaultNode::whereIn('vault_id', $visible)->where('is_file', true)->where('extension', 'md');
            if (isset($data['vaultId'])) {
                abort_unless((clone $visible)->whereKey($data['vaultId'])->exists(), 403);
                $notes->where('vault_id', $data['vaultId']);
            }
            $page = is_int($data['page'] ?? null) ? $data['page'] : 1;
            if ($name === 'me') {
                $result = $user->only(['id', 'name', 'email']);
            } elseif ($name === 'vaults') {
                $result = Vault::whereIn('id', $visible)->orderBy('id')->simplePaginate(50, ['id', 'name'], 'page', $page)->toArray();
            } elseif (in_array($name, ['list', 'search'])) {
                if ($name === 'search') {
                    $query = is_string($data['query'] ?? null) ? $data['query'] : '';
                    $notes->where(fn ($queryBuilder) => $queryBuilder->where('name', 'like', '%'.$query.'%')->orWhere('content', 'like', '%'.$query.'%'));
                }
                $result = $notes->orderBy('id')->simplePaginate(50, ['id', 'vault_id', 'parent_id', 'name', 'updated_at'], 'page', $page)->toArray();
            } elseif ($name === 'create') {
                $vault = Vault::findOrFail($data['vaultId']);
                abort_unless($vault instanceof Vault && $user->can('update', $vault), 403);
                if (isset($data['parentId'])) {
                    app(\App\Actions\CheckParent::class)->handle($vault, $data['parentId']);
                }
                $result = Cache::lock('docs.vault.'.$vault->id, 30)->block(5, fn () => app(CreateVaultNode::class)->handle($vault, [
                    'name' => is_string($data['name'] ?? null) ? $data['name'] : '',
                    'content' => is_string($data['content'] ?? null) ? $data['content'] : '',
                    'is_file' => true,
                    'extension' => 'md',
                    'parent_id' => is_int($data['parentId'] ?? null) ? $data['parentId'] : null,
                ])->toArray());
            } else {
                $note = $notes->findOrFail($data['noteId']);
                abort_unless($note instanceof VaultNode, 404);
                if ($name === 'read') {
                    $result = $note->only(['id', 'vault_id', 'name', 'content', 'updated_at']);
                } elseif ($name === 'move') {
                    abort_unless($user->can('update', $note->vault), 403);
                    $result = Cache::lock('docs.note.'.$note->id, 30)->block(5, fn () => app(MoveVaultNode::class)->handle(
                        $note,
                        is_int($data['parentId'] ?? null) ? $data['parentId'] : null,
                    )->toArray());
                } else {
                    abort_unless($user->can('update', $note->vault), 403);
                    $result = Cache::lock('docs.note.'.$note->id, 30)->block(5, function () use ($note, $data): array {
                        $note->refresh();
                        $existing = $note->content ?? '';
                        $incoming = is_string($data['content'] ?? null) ? $data['content'] : '';
                        $operation = is_string($data['operation'] ?? null) ? $data['operation'] : 'append';
                        $content = match ($operation) {
                            'replace' => $incoming,
                            'prepend' => $incoming.$existing,
                            default => $existing.$incoming,
                        };
                        abort_if(mb_strlen($content) > 1000000, 413);

                        return app(UpdateVaultNode::class)->handle($note, ['content' => $content])->toArray();
                    });
                }
            }

            return ['content' => [['type' => 'text', 'text' => json_encode($result, JSON_THROW_ON_ERROR)]]];
        } catch (ValidationException $error) {
            return ['isError' => true, 'content' => [['type' => 'text', 'text' => $error->getMessage()]]];
        } catch (ModelNotFoundException|HttpExceptionInterface) {
            return ['isError' => true, 'content' => [['type' => 'text', 'text' => 'Document unavailable, request invalid, or access denied.']]];
        } catch (Throwable $error) {
            report($error);

            return ['isError' => true, 'content' => [['type' => 'text', 'text' => 'The tool could not complete the request. Please try again.']]];
        }
    }
}
