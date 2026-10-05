import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Failure cases: actor/owner name collisions; existing destination directories;
// failed file/directory creation, save and rename; partial import rollback;
// missing/out-of-order ZIP parents; note-parent metadata; entry/count/total
// expansion limits. Successful writes, IDs, bytes and exports must survive.
// All chmod, database inspection and synthetic archives target disposable container.
export async function storage({ browser, base, jwt, container }) {
    const bootstrap = "require '/var/www/html/vendor/autoload.php'; $app=require '/var/www/html/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $input=json_decode(stream_get_contents(STDIN),true); ";
    const php = (code, input = {}) => execFileSync('docker', ['exec', '-i', container, 'php', '-r', bootstrap + code], { input: JSON.stringify(input), encoding: 'utf8' });
    const contexts = [];
    const failures = [];
    const checks = [];
    const check = async (name, action) => {
        try { await action(); checks.push(name); }
        catch (error) { failures.push(`${name}: ${error.message}`); }
    };
    const client = async email => {
        const context = await browser.newContext({ extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt(email) } });
        contexts.push(context);
        await context.request.get(base);
        const request = async (path, method = 'GET', data) => {
            const token = (await context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN')?.value;
            const response = await context.request.fetch(base + path, { method, headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, ...(data === undefined ? {} : { data }) });
            return { status: response.status(), body: await response.json() };
        };
        return { context, request };
    };
    const owner = await client('alex@example.test');
    const member = await client('sam@example.test');
    const createVault = async name => {
        const result = await owner.request('/vaults', 'POST', { name });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        return result.body.data;
    };
    const createNote = async (vault, name, content = 'Original bytes') => {
        const result = await owner.request(`/vaults/${vault.id}/nodes`, 'POST', { name, is_file: true });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const note = result.body.data;
        assert.equal((await owner.request(`/vaults/${vault.id}/nodes/${note.id}`, 'PATCH', { content })).status, 200);
        return note;
    };
    const state = vault => JSON.parse(php("$vault=App\\Models\\Vault::findOrFail($input['id']); echo json_encode(['name'=>$vault->name,'path'=>Illuminate\\Support\\Facades\\Storage::disk('local')->path(app(App\\Actions\\GetPathFromVault::class)->handle($vault)),'nodes'=>$vault->nodes()->get(['id','name','parent_id','content','extension','is_file'])->toArray()]);", { id: vault.id }));
    const permissions = (path, mode) => execFileSync('docker', ['exec', '--user', 'root', container, 'chmod', mode, path]);
    const bytes = path => execFileSync('docker', ['exec', container, 'cat', path], { encoding: 'utf8' });
    const archive = entries => {
        php("$zip=new ZipArchive; $zip->open('/tmp/storage-check.zip',ZipArchive::CREATE|ZipArchive::OVERWRITE); foreach($input as $entry){if(str_ends_with($entry['name'],'/'))$zip->addEmptyDir($entry['name']);else $zip->addFromString($entry['name'],$entry['content']);} if(!$zip->close())throw new RuntimeException('fixture archive failed');", entries);
        return execFileSync('docker', ['exec', container, 'cat', '/tmp/storage-check.zip']);
    };
    const importVault = async (name, entries) => {
        const token = (await owner.context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN')?.value;
        return owner.context.request.post(base + '/vaults/import', { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, multipart: { file: { name: `${name}.zip`, mimeType: 'application/zip', buffer: archive(entries) } } });
    };
    const findVault = name => JSON.parse(php("echo json_encode(App\\Models\\Vault::where('name',$input['name'])->first()?->only(['id','name']));", { name }));
    try {
        await check('collaborator rename uses owner namespace and preserves both vaults', async () => {
            const vault = await createVault('Collision shared');
            const privateVault = await createVault('Collision private');
            await createNote(vault, 'Shared');
            await createNote(privateVault, 'Private');
            php("$vault=App\\Models\\Vault::findOrFail($input['id']); $vault->collaborators()->attach(App\\Models\\User::where('email','sam@example.test')->firstOrFail(),['accepted'=>true]);", { id: vault.id });
            const before = state(vault);
            assert.equal((await member.request(`/vaults/${vault.id}`, 'PATCH', { name: privateVault.name })).status, 422);
            assert.equal((await member.request(`/vaults/${vault.id}`, 'PATCH', { name: privateVault.name.toUpperCase() })).status, 422);
            assert.deepEqual(state(vault), before);
            assert.equal(bytes(state(privateVault).path + '/Private.md'), 'Original bytes');
            assert.equal((await member.request(`/vaults/${vault.id}`, 'PATCH', { name: 'Collision renamed' })).status, 200);
            assert.equal(bytes(state(vault).path + '/Shared.md'), 'Original bytes');
        });
        await check('failed node create/save preserves database and original bytes', async () => {
            const vault = await createVault('Disk node');
            const note = await createNote(vault, 'Existing');
            const before = state(vault);
            permissions(before.path, '0500');
            try {
                assert((await owner.request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Failed', is_file: true })).status >= 400);
                assert((await owner.request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Failed folder', is_file: false })).status >= 400);
                assert((await owner.request(`/vaults/${vault.id}/nodes/${note.id}`, 'PATCH', { content: 'Unsaved change' })).status >= 400);
                assert((await owner.request(`/vaults/${vault.id}/nodes/${note.id}`, 'PATCH', { name: 'Failed rename' })).status >= 400);
                assert.deepEqual(state(vault), before);
                assert.equal(bytes(before.path + '/Existing.md'), 'Original bytes');
            } finally { permissions(before.path, '0700'); }
            assert.equal((await owner.request(`/vaults/${vault.id}/nodes/${note.id}`, 'PATCH', { content: 'Saved change' })).status, 200);
            assert.equal(bytes(before.path + '/Existing.md'), 'Saved change');
        });
        await check('attachment import reports failed writes and preserves original nodes', async () => {
            const vault = await createVault('Disk attachment');
            const before = state(vault);
            const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LxkAAAAASUVORK5CYII=', 'base64');
            const token = (await owner.context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN')?.value;
            const send = () => owner.context.request.post(base + `/vaults/${vault.id}/import`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token ?? '') }, multipart: { parent_id: '', 'files[]': { name: 'Picture.png', mimeType: 'image/png', buffer: png } } });
            permissions(before.path, '0500');
            try {
                assert((await send()).status() >= 400);
                assert.deepEqual(state(vault), before);
            } finally { permissions(before.path, '0700'); }
            const response = await send();
            assert.equal(response.status(), 200, await response.text());
            assert.deepEqual(execFileSync('docker', ['exec', container, 'cat', before.path + '/Picture.png']), png);
        });
        await check('failed backlink update restores moved note, children and all bytes', async () => {
            const vault = await createVault('Disk backlinks');
            const target = await createNote(vault, 'Target');
            const child = await owner.request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Child', is_file: true, parent_id: target.id });
            assert.equal(child.status, 200, JSON.stringify(child.body));
            await createNote(vault, 'Source', '[Target](/Target.md)');
            const before = state(vault);
            php("Illuminate\\Support\\Facades\\DB::unprepared(\"CREATE TRIGGER storage_backlink_failure BEFORE UPDATE ON vault_nodes WHEN NEW.name = 'Source' AND NEW.content != OLD.content BEGIN SELECT RAISE(ABORT, 'fixture backlink failure'); END\");");
            try {
                assert((await owner.request(`/vaults/${vault.id}/nodes/${target.id}`, 'PATCH', { name: 'Moved target' })).status >= 400);
                assert.deepEqual(state(vault), before);
                assert.equal(bytes(before.path + '/Target.md'), 'Original bytes');
                assert.equal(bytes(before.path + '/Source.md'), '[Target](/Target.md)');
                assert.equal(bytes(before.path + '/Target/Child.md'), '');
            } finally { php("Illuminate\\Support\\Facades\\DB::unprepared('DROP TRIGGER storage_backlink_failure');"); }
        });
        await check('moved note response matches rewritten self-links and stored bytes', async () => {
            const vault = await createVault('Move response');
            await createNote(vault, 'External');
            const note = await createNote(vault, 'Target', '[External](External.md)');
            const folder = await owner.request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Destination', is_file: false });
            assert.equal(folder.status, 200, JSON.stringify(folder.body));
            const response = await owner.request(`/vaults/${vault.id}/nodes/${note.id}/move`, 'PATCH', { parent_id: folder.body.data.id });
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.data.content, '[External](/External.md)');
            assert.equal(state(vault).nodes.find(item => item.id === note.id).content, response.body.data.content);
            assert.equal(bytes(state(vault).path + '/Destination/Target.md'), response.body.data.content);
        });
        await check('failed vault create/rename preserves records and original directory', async () => {
            const vault = await createVault('Disk vault');
            await createNote(vault, 'Existing');
            const before = state(vault);
            const parent = before.path.replace(/\/$/, '').replace(/\/[^/]+$/, '');
            permissions(parent, '0500');
            try {
                assert((await owner.request('/vaults', 'POST', { name: 'Failed vault' })).status >= 400);
                assert.equal(findVault('Failed vault'), null);
                assert((await owner.request(`/vaults/${vault.id}`, 'PATCH', { name: 'Failed rename' })).status >= 400);
                assert.deepEqual(state(vault), before);
                assert.equal(bytes(before.path + '/Existing.md'), 'Original bytes');
            } finally { permissions(parent, '0700'); }
        });
        await check('failed node deletion preserves records, descendants and bytes', async () => {
            const vault = await createVault('Disk node deletion');
            const note = await createNote(vault, 'Parent');
            const child = await owner.request(`/vaults/${vault.id}/nodes`, 'POST', { name: 'Child', is_file: true, parent_id: note.id });
            assert.equal(child.status, 200, JSON.stringify(child.body));
            const before = state(vault);
            permissions(before.path, '0500');
            try {
                assert((await owner.request(`/vaults/${vault.id}/nodes/${note.id}`, 'DELETE')).status >= 400);
                assert.deepEqual(state(vault), before);
                assert.equal(bytes(before.path + '/Parent.md'), 'Original bytes');
                assert.equal(bytes(before.path + '/Parent/Child.md'), '');
            } finally { permissions(before.path, '0700'); }
            assert.equal((await owner.request(`/vaults/${vault.id}/nodes/${note.id}`, 'DELETE')).status, 200);
            assert.equal(state(vault).nodes.length, 0);
            assert.equal(php("echo file_exists($input['path'])?'exists':'absent';", { path: before.path + '/Parent.md' }), 'absent');
            assert.equal(php("echo file_exists($input['path'])?'exists':'absent';", { path: before.path + '/Parent' }), 'absent');
        });
        await check('failed vault deletion preserves records and all file bytes', async () => {
            const vault = await createVault('Disk vault deletion');
            await createNote(vault, 'Existing');
            const before = state(vault);
            const parent = before.path.replace(/\/$/, '').replace(/\/[^/]+$/, '');
            permissions(parent, '0500');
            try {
                const response = await owner.context.request.delete(base + `/vaults/${vault.id}`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent((await owner.context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN')?.value ?? '') } });
                assert(response.status() >= 400);
                assert.deepEqual(state(vault), before);
                assert.equal(bytes(before.path + '/Existing.md'), 'Original bytes');
            } finally { permissions(parent, '0700'); }
            const response = await owner.context.request.delete(base + `/vaults/${vault.id}`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent((await owner.context.cookies()).find(cookie => cookie.name === 'XSRF-TOKEN')?.value ?? '') } });
            assert.equal(response.status(), 200, await response.text());
            assert.equal(findVault(vault.name), null);
            assert.equal(php("echo file_exists($input['path'])?'exists':'absent';", { path: before.path }), 'absent');
        });
        await check('ZIP parenting independent of entry order and implicit directories', async () => {
            const response = await importVault('Archive ordered', [
                { name: 'Parent/Child.md', content: 'Nested note' },
                { name: 'Implicit/Deep/Leaf.md', content: 'Implicit folders' },
                { name: 'Parent/', content: '' },
                { name: 'Parent.md', content: 'Parent note' },
                { name: '.docs.json', content: JSON.stringify({ note_parents: ['Parent'] }) },
            ]);
            assert.equal(response.status(), 200, await response.text());
            const nodes = state(findVault('Archive ordered')).nodes;
            const parent = nodes.find(node => node.name === 'Parent' && node.is_file);
            assert.equal(nodes.find(node => node.name === 'Child').parent_id, parent.id);
            const implicit = nodes.find(node => node.name === 'Implicit');
            const deep = nodes.find(node => node.name === 'Deep');
            assert.equal(deep.parent_id, implicit.id);
            assert.equal(nodes.find(node => node.name === 'Leaf').parent_id, deep.id);
            assert.equal(nodes.find(node => node.name === 'Child').content, 'Nested note');
        });
        await check('ZIP expanded entry/total/count limits reject before creating vault', async () => {
            for (const [name, entries] of [
                ['Archive entry limit', [{ name: 'Large.md', content: 'x'.repeat(4097) }]],
                ['Archive total limit', Array.from({ length: 4 }, (_, i) => ({ name: `${i}.md`, content: 'x'.repeat(3000) }))],
                ['Archive count limit', Array.from({ length: 65 }, (_, i) => ({ name: `${i}.md`, content: '' }))],
            ]) {
                const response = await importVault(name, entries);
                assert.equal(response.status(), 422, await response.text());
                assert.equal(findVault(name), null);
            }
        });
        await check('failed ZIP database insert removes every imported record and file', async () => {
            const reference = await createVault('Archive rollback reference');
            const ownerPath = state(reference).path.replace(/\/$/, '').replace(/\/[^/]+$/, '');
            php("Illuminate\\Support\\Facades\\DB::unprepared(\"CREATE TRIGGER storage_import_failure BEFORE INSERT ON vault_nodes WHEN NEW.name = 'Fail late' BEGIN SELECT RAISE(ABORT, 'fixture import failure'); END\");");
            try {
                const response = await importVault('Archive rollback', [{ name: 'Good.md', content: 'Good bytes' }, { name: 'Fail late.md', content: 'Late failure' }]);
                assert(response.status() >= 400);
                assert.equal(findVault('Archive rollback'), null);
                assert.equal(php("echo file_exists($input['path'])?'exists':'absent';", { path: ownerPath + '/Archive rollback' }), 'absent');
            } finally { php("Illuminate\\Support\\Facades\\DB::unprepared('DROP TRIGGER storage_import_failure');"); }
        });
        assert.deepEqual(failures, [], failures.join('\n'));
        return checks;
    } finally { for (const context of contexts) await context.close(); }
}
