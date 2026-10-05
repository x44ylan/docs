<?php

declare(strict_types=1);

return [
    'team' => env('CF_ACCESS_TEAM_DOMAIN'),
    'aud' => env('CF_ACCESS_AUD'),
    // Reserved legacy account; never used to authenticate browser or MCP requests.
    'agent' => env('MCP_EMAIL', 'agent@docs.x44ylan.com'),
    // Bounds apply to expanded ZIP data, including skipped/unsupported entries.
    'import' => [
        'max_entry_bytes' => env('DOCS_IMPORT_MAX_ENTRY_BYTES', 64 * 1024 * 1024),
        'max_total_bytes' => env('DOCS_IMPORT_MAX_TOTAL_BYTES', 256 * 1024 * 1024),
        'max_entries' => env('DOCS_IMPORT_MAX_ENTRIES', 5000),
        'max_depth' => env('DOCS_IMPORT_MAX_DEPTH', 64),
        'max_metadata_bytes' => env('DOCS_IMPORT_MAX_METADATA_BYTES', 1024 * 1024),
    ],
];
