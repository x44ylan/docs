import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// Only synthetic E2E data is served. No writes or production routes are exposed.
export async function preview({ base, jwt, path }) {
    const allowed = /^\/(?:$|vaults(?:\/\d+(?:\/(?:nodes(?:\/\d+)?|search|collaborations))?)?$|build\/assets\/[\w.-]+$|(?:icon(?:-dark)?\.(?:ico|png)|icon-(?:light|dark)\.svg|touch\.png)$)/;
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, base);
        if (!['GET', 'HEAD'].includes(request.method) || !allowed.test(url.pathname)) {
            response.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ message: 'This is a read-only preview. Changes are not saved.' }));
            return;
        }
        try {
            const headers = { 'Cf-Access-Jwt-Assertion': jwt('alex@example.test') };
            for (const name of ['accept', 'cookie', 'x-inertia', 'x-inertia-version', 'x-inertia-partial-component', 'x-inertia-partial-data']) {
                if (request.headers[name]) headers[name] = request.headers[name];
            }
            const result = await fetch(`${base}${url.pathname}${url.search}`, { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
            response.statusCode = result.status;
            for (const name of ['content-type', 'vary', 'x-inertia']) {
                if (result.headers.has(name)) response.setHeader(name, result.headers.get(name));
            }
            const cookies = result.headers.getSetCookie();
            if (cookies.length) response.setHeader('set-cookie', cookies);
            if (result.headers.has('location')) response.setHeader('location', result.headers.get('location').replace(base, ''));
            response.setHeader('cache-control', 'no-store');
            if (/html|json/.test(result.headers.get('content-type') ?? '')) {
                let body = await result.text();
                // Blade's prefetch JSON is escaped once for JSON and again for JS.
                for (const depth of [0, 1, 3]) {
                    body = body.replaceAll(base.replaceAll('/', '\\'.repeat(depth) + '/'), '');
                }
                response.end(body);
            } else {
                response.end(Buffer.from(await result.arrayBuffer()));
            }
        } catch {
            response.writeHead(502);
            response.end('Preview unavailable.');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${server.address().port}`;
    const tunnel = spawn('cloudflared', ['tunnel', '--config', '/dev/null', '--url', address, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`Local preview: ${address}${path}`);
    let published = false;
    const log = data => {
        const match = String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !published) {
            published = true;
            console.log(`Preview: ${match[0]}${path}`);
            console.log('Read-only sample workspace; closes automatically after 50 minutes.');
        }
    };
    tunnel.stdout.on('data', log);
    tunnel.stderr.on('data', log);
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 50 * 60 * 1000);
            const stop = () => { clearTimeout(timer); resolve(); };
            process.once('SIGINT', stop);
            process.once('SIGTERM', stop);
            tunnel.once('exit', stop);
            tunnel.once('error', error => { clearTimeout(timer); reject(error); });
        });
    } finally {
        tunnel.kill();
        await new Promise(resolve => server.close(resolve));
    }
}
