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

`update` edits through the same live document as the browser, so anyone with
the note open sees the change immediately. A version is saved before every agent
edit, so it can be restored from History. `delete` moves a note and its
sub-notes to the vault trash for 30 days. `backlinks` lists notes that link to a
note.

### Available actions

The former `open_item`, `move_item` and `trash_item` actions are now `read`, `move` and `delete`. Pass the sidebar item ID as `noteId` for a note, folder or attachment.

To create a vault, call `create_vault` with a name. It creates a private vault and its main note. Use the returned ID with `open_vault` to get the same tree, pinned items and main note as the sidebar.

```json
{"name":"create_vault","arguments":{"name":"Research"}}
```

| UI feature | MCP tools |
| --- | --- |
| Home, profile, vault switching | `home`, `me`, `rename_profile`, `vaults`, `open_vault` |
| Manage vaults | `create_vault`, `rename_vault`, `leave_vault`, `delete_vault` (permanent, owner only) |
| Sidebar, folders and notes | `list`, `create_folder`, `create`, `rename_item`, `move`, `set_pin` |
| Edit, format and copy | `read` returns Markdown. `edit_selection` replaces one exact passage. `update` appends, prepends or replaces Markdown. Use Markdown for formatting, tables, images, tasks, links and diagram fences. |
| Navigate and preview | `search`, `find_in_note`, `note_contents`, `backlinks`, `preview_note` (HTML), `code_blocks` (source), `note_presence` |
| Open in a browser | `view_link` returns a signed-in URL with optional note, light/dark theme, read/edit mode and open/closed sidebar. |
| History, compare and undo an edit | `list_versions`, `read_version`, `compare_version`, `restore_version`. Restoring records the previous content so you can reapply it. |
| Trash | `delete`, `list_trash`, `restore_item`, `purge_item` |
| People and read-only links | `find_people`, `list_members`, `add_member`, `remove_member`, `get_sharing`, `set_sharing` |
| Attachments and ZIP archives | `upload_file`, `download_file`, `import_vault`, `export_vault`. File bytes travel as standard base64. The MCP transport accepts JSON requests up to 4 MiB including base64 and metadata. Use the browser for larger uploads. |

Tools operate on saved content or live documents. A browser tab owns its clipboard, cursor, scroll position, interactive diagram previews and per-editor undo stack. To jump to a note in the browser, open its view link.

For Codex:

```sh
codex mcp add docs --url https://docs.x44ylan.com/mcp
codex mcp login docs
```

Existing clients must remove the old Authorization and CF-Access service-token
headers before signing in. Reconnect the client after login.

### Agents on the Docs host

Codex running on the same machine can skip OAuth. The container exposes MCP on a
private socket (`DOCS_MCP_SOCKET`, mode 0600) that acts as `DOCS_LOCAL_EMAIL`,
reachable only through `docker exec`:

```toml
[mcp_servers.docs]
command = "docker"
args = ["exec", "-i", "docs-app", "node", "server/local-mcp.ts"]
```

Anyone who can run `docker exec` on the host already controls the data, so this
adds no new access. The public `/mcp` route still requires Cloudflare Access.
E2E: `node tests/local-mcp.ts`.

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
