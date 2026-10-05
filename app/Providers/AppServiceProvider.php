<?php

declare(strict_types=1);

namespace App\Providers;

use App\Services\VaultStorage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Inertia\ExceptionResponse;
use Inertia\Inertia;
use Override;

final class AppServiceProvider extends ServiceProvider
{
    /** Register any application services. */
    #[Override]
    public function register(): void
    {
        $this->app->scoped(VaultStorage::class);
    }

    /** Bootstrap any application services. */
    public function boot(): void
    {
        $this->configureDates();
        $this->configureModels();
        $this->configureResources();
        $this->configureVite();
        $this->configureAssetURL();
        $this->configureInertiaExceptions();
    }

    /** Configure the application's dates. */
    private function configureDates(): void
    {
        Date::use(CarbonImmutable::class);
    }

    /** Configure the application's models. */
    private function configureModels(): void
    {
        Model::unguard();
        Model::shouldBeStrict();
    }

    /** Configure the application's resources. */
    private function configureResources(): void
    {
        JsonResource::withoutWrapping();
    }

    /** Configure the application's Vite instance. */
    private function configureVite(): void
    {
        Vite::useAggressivePrefetching();
    }

    /** Configure the application's asset URL. */
    private function configureAssetURL(): void
    {
        config(['app.asset_url' => config('app.url')]);
    }

    /** Render Inertia error pages so failures stay inside the app shell. */
    private function configureInertiaExceptions(): void
    {
        Inertia::handleExceptionsUsing(function (ExceptionResponse $response): ?ExceptionResponse {
            if (request()->is('api/*') || request()->expectsJson()) {
                return null;
            }

            if (config('app.debug') && $response->statusCode() >= 500) {
                return null;
            }

            if (!in_array($response->statusCode(), [403, 404, 419, 500, 503], true)) {
                return null;
            }

            return $response->render('Error', [
                'status' => $response->statusCode(),
            ]);
        });
    }
}
