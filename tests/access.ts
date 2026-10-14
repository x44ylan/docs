// Test stand-in for Cloudflare Access: a local key pair and signed assertions.
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('RS256');
export const team = 'fixture.cloudflareaccess.com';
export const audience = 'docs-test';
export const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' }] });

// `claims` override the defaults (e.g. a wrong `aud` or a past `exp`).
export const token = (email: string, claims: Record<string, unknown> = {}) =>
    new SignJWT({ iss: `https://${team}`, aud: audience, sub: email, email, exp: Math.floor(Date.now() / 1000) + 3600, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .sign(privateKey);

export const env = { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: audience, DOCS_JWKS: jwks };
