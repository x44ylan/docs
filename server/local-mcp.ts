// stdio bridge for MCP clients on the Docs host:
//   docker exec -i docs-app node server/local-mcp.ts
// Each JSON-RPC line goes to the private /mcp socket and the reply comes back
// on stdout. No network listener and no credentials leave the container.
import { request } from 'node:http';
import { createInterface } from 'node:readline';

const socketPath = process.env.DOCS_MCP_SOCKET;
if (!socketPath) { console.error('DOCS_MCP_SOCKET is not set.'); process.exit(1); }

const post = (body: string) => new Promise<string>((resolve, reject) => {
    const req = request({ socketPath, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => (res.statusCode && res.statusCode < 300 ? resolve(data) : reject(new Error(data || `HTTP ${res.statusCode}`))));
    });
    req.on('error', reject);
    req.end(body);
});

// Replies are written in arrival order so a client can pipeline requests.
let chain = Promise.resolve();
for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const pending = post(line).catch((error: Error) => {
        let id: unknown = null;
        try { id = JSON.parse(line).id ?? null; } catch { /* not JSON */ }
        return id === null ? '' : JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message } });
    });
    chain = chain.then(async () => { const reply = (await pending).trim(); if (reply) process.stdout.write(reply + '\n'); });
}
await chain;
