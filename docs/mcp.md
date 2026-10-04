# MCP

Connect to `https://docs.x44ylan.com/mcp` using OAuth. Sign in with the same
Cloudflare account you use for Docs. The `me` tool confirms your Docs user ID
and email; vault permissions are identical to the browser. No agent invitation
or shared API key is needed.

`create` accepts `parentId` for a note or folder. `list` returns `parent_id`,
so agents see the same nested document structure as the sidebar.

`move` accepts `noteId` and `parentId` to move an existing note and its sub-notes
under a note or folder in the same vault. Use `parentId: null` to return it to the
vault root. IDs, attachments and links are preserved; duplicate names receive a
suffix, returned with the updated `parent_id`. It uses your existing vault access.

```json
{"name":"move","arguments":{"noteId":42,"parentId":14}}
```

For Codex:

```sh
codex mcp add docs --url https://docs.x44ylan.com/mcp
codex mcp login docs
```

Existing clients must remove the old Authorization and CF-Access service-token
headers before signing in. Reconnect the client after login.

## Hosting

Use one Cloudflare Access application covering the entire Docs hostname, with
Managed OAuth enabled and the same Allow policy for browser and MCP users.
Do not add a separate `/mcp` application or bypass policy. Set
`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` to this application's values.

Docs validates Cloudflare's signed assertion on every request, matches the
verified email to the existing user, and provisions new users with no vaults.
Service identities and the retired agent account are rejected. Different email
addresses are still different accounts; they are not automatically merged.

Cloudflare manages OAuth tokens and policy enforcement; clients handle refresh
and reauthorization. Browser cookies are not copied into MCP clients.

References: [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
and [Codex MCP](https://developers.openai.com/codex/mcp/).
