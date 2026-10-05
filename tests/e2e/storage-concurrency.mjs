import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Failure cases: a failed rename can release its database lock before filesystem
// compensation. A second HTTP save must either fail without changing data or
// succeed with matching database/file bytes. The pause hook and trigger exist
// only in the disposable container; multiple PHP workers handle real HTTP calls.
export async function storageConcurrency({ browser, base, jwt, container }) {
    const bootstrap = "require '/var/www/html/vendor/autoload.php'; $app=require '/var/www/html/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $input=json_decode(stream_get_contents(STDIN),true); ";
    const php = (code, input = {}) => execFileSync('docker', ['exec', '-i', container, 'php', '-r', bootstrap + code], { input: JSON.stringify(input), encoding: 'utf8' });
    const context = await browser.newContext({ extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') } });
    try {
        await context.request.get(base);
        const token = decodeURIComponent((await context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN')?.value ?? '');
        const request = (path, method, data) => context.request.fetch(base + path, { method, headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token }, data });
        const vaultResponse = await request('/vaults', 'POST', { name: 'Concurrent rollback' });
        assert.equal(vaultResponse.status(), 200, await vaultResponse.text());
        const vault = (await vaultResponse.json()).data;
        const create = async (name, content) => {
            const response = await request(`/vaults/${vault.id}/nodes`, 'POST', { name, is_file: true });
            assert.equal(response.status(), 200);
            const node = (await response.json()).data;
            assert.equal((await request(`/vaults/${vault.id}/nodes/${node.id}`, 'PATCH', { content })).status(), 200);
            return node;
        };
        const target = await create('Target', 'Original bytes');
        await create('Source', '[Target](/Target.md)');
        php(String.raw`$path='/var/www/html/app/Services/VaultStorage.php'; $code=file_get_contents($path); $needle='foreach (array_reverse($this->undo) as $undo) {'; if(substr_count($code,$needle)!==1)throw new RuntimeException('fixture hook missing'); $hook='if (is_file("/tmp/storage-pause-undo")) { unlink("/tmp/storage-pause-undo"); file_put_contents("/tmp/storage-undo-started", "yes"); usleep(2000000); } '; if(file_put_contents($path,str_replace($needle,$hook.$needle,$code))===false)throw new RuntimeException('fixture hook failed'); Illuminate\Support\Facades\DB::unprepared("CREATE TRIGGER storage_race_failure BEFORE UPDATE ON vault_nodes WHEN NEW.name = 'Source' AND NEW.content != OLD.content BEGIN SELECT RAISE(ABORT, 'fixture concurrent failure'); END"); touch('/tmp/storage-pause-undo');`);
        const failedRename = request(`/vaults/${vault.id}/nodes/${target.id}`, 'PATCH', { name: 'Moved target' });
        for (let attempts = 0; ; attempts++) {
            if (php("echo is_file('/tmp/storage-undo-started')?'yes':'no';") === 'yes') break;
            if (attempts >= 50) {
                const rename = await failedRename;
                const diagnostic = php(String.raw`$log=file_get_contents('/var/www/html/storage/logs/laravel.log') ?: ''; $lines=preg_grep('/ERROR|ParseError|storage-pause/',explode("\n",$log)); echo implode("\n",array_slice($lines,-4)); echo "\npause=".(is_file('/tmp/storage-pause-undo')?'yes':'no');`);
                assert.fail(`Failed rename never reached filesystem compensation: HTTP ${rename.status()}, ${await rename.text()}, ${diagnostic}`);
            }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        const concurrentSave = request(`/vaults/${vault.id}/nodes/${target.id}`, 'PATCH', { content: 'Concurrent bytes' });
        const [rename, save] = await Promise.all([failedRename, concurrentSave]);
        assert(rename.status() >= 400);
        assert(save.status() === 200 || save.status() >= 400);
        const state = JSON.parse(php("$node=App\\Models\\VaultNode::findOrFail($input['id']); echo json_encode(['name'=>$node->name,'content'=>$node->content,'bytes'=>Illuminate\\Support\\Facades\\Storage::disk('local')->get(app(App\\Actions\\GetPathFromVaultNode::class)->handle($node))]);", { id: target.id }));
        assert.equal(state.name, 'Target');
        assert.equal(state.content, save.status() === 200 ? 'Concurrent bytes' : 'Original bytes');
        assert.equal(state.bytes, state.content, 'Filesystem rollback overwrote a concurrent committed save');
        return ['Failed rename keeps database and file bytes consistent with a concurrent HTTP save'];
    } finally { await context.close(); }
}
