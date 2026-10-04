<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Actions\MoveVaultNode;
use App\Http\Requests\MoveVaultNodeRequest;
use App\Models\User;
use App\Models\Vault;
use App\Models\VaultNode;
use App\ViewModels\VaultNodeViewModel;
use Illuminate\Container\Attributes\CurrentUser;
use Illuminate\Http\JsonResponse;

final readonly class VaultNodeMoveController
{
    public function __invoke(
        MoveVaultNodeRequest $request,
        Vault $vault,
        VaultNode $node,
        #[CurrentUser] User $user,
    ): JsonResponse {
        abort_unless($user->can('update', $vault), 403);

        /** @var array{ parent_id: int|null } $data */
        $data = $request->validated();

        $updatedNode = app(MoveVaultNode::class)->handle($node, $data['parent_id']);

        return response()->json([
            'data' => VaultNodeViewModel::fromModel($updatedNode),
        ]);
    }
}
