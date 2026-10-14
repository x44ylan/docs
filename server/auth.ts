// Cloudflare Access is the only login. Every request (HTTP, WebSocket, MCP)
// carries a signed assertion; the verified email identifies the user.
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import { get, HttpError, run } from './db.ts';

export type User = { id: number; email: string; name: string };

const team = process.env.CF_ACCESS_TEAM_DOMAIN ?? '';
const audience = process.env.CF_ACCESS_AUD ?? '';
const retired = (process.env.MCP_EMAIL ?? 'agent@docs.x44ylan.com').toLowerCase();
// Tests supply their own keys; production fetches Cloudflare's (cached by jose).
const keys = process.env.DOCS_JWKS
    ? createLocalJWKSet(JSON.parse(process.env.DOCS_JWKS))
    : createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));

// Cloudflare sends the assertion as a header; the CF_Authorization cookie holds
// the same signed token (used when a WebSocket upgrade lacks the header).
export const assertion = (header: string | null | undefined, cookie: string | null | undefined) =>
    header || /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie ?? '')?.[1];

export async function identify(token: string | null | undefined): Promise<User> {
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !audience) throw new HttpError(503, 'Access is not configured.');
    if (!token) throw new HttpError(401, 'Sign in again.');
    let claims;
    try {
        ({ payload: claims } = await jwtVerify(token, keys, { issuer: `https://${team}`, audience, algorithms: ['RS256'] }));
    } catch {
        throw new HttpError(403, 'Cloudflare identity could not be verified. Sign in again.');
    }
    // Service tokens have no person behind them and never inherit access.
    if (claims.common_name || !claims.sub || typeof claims.email !== 'string' || !claims.email.includes('@')) {
        throw new HttpError(403, 'Sign in with your personal account.');
    }
    const email = claims.email.toLowerCase();
    if (email === retired) throw new HttpError(403, 'Sign in with your personal account.');
    const name = (typeof claims.name === 'string' && claims.name.trim()) || email.split('@')[0].replace(/^./, (c: string) => c.toUpperCase());
    run('insert into users (email, name) values (?, ?) on conflict (email) do nothing', email, name.slice(0, 255));
    return get<User>('select id, email, name from users where email = ?', email)!;
}

export const canAccess = (user: User, vaultId: number) =>
    !!get(
        `select 1 from vaults v where v.id = ? and (v.owner_id = ? or v.public = 1
            or exists (select 1 from members m where m.vault_id = v.id and m.user_id = ?))`,
        vaultId, user.id, user.id,
    );

export function assertAccess(user: User, vaultId: number) {
    if (!canAccess(user, vaultId)) throw new HttpError(404, 'Vault unavailable or access denied.');
}
