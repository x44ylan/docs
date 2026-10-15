# Docs rewrite plan

Status: live since 2026-10-15. 33 end-to-end checks pass (`npm test`), plus a
signed-in check through Cloudflare (`node tests/live.ts`). Cutover import
matched exactly (824 nodes, 747 notes byte-identical, 127 unique links, share
token kept). Nightly backups run via `docs-backup.timer`.

Measured on a 2,000-note vault with a 1 MB note (`artifacts/e2e/timing.json`):
first paint ~0.5 s, editable ~1.5 s, switching notes ~70 ms (from the 1 MB
note ~80 ms).

Old Laravel image and volumes are kept for rollback and removed automatically
on 2026-10-29 by `docs-retire-laravel.timer` (an archive is kept in backups).

Goal: rebuild Docs on one TypeScript stack, then add live co-editing, version
history, trash, note links, command menu, table of contents, in-note search,
pinned notes, copy as Markdown and progressive rendering. The current Laravel
app keeps serving `docs.x44ylan.com` until a direct cutover; no staging
hostname. Its image and volumes stay for rollback.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 24, one process, TypeScript everywhere |
| Server | Hono (`@hono/node-server`) for HTTP, MCP and WebSocket upgrade |
| Client | React 19, React Router 8 in SPA mode, Vite |
| UI | shadcn/ui, Tailwind, Tabler icons; current black/white look |
| Editor | Tiptap 3; current extensions ported once into `shared/` |
| Co-editing | Yjs, Hocuspocus server embedded in the same process |
| Markdown | `@tiptap/markdown`, same schema in browser and server |
| Database | SQLite (`better-sqlite3`) with Drizzle; FTS5 for search |
| Auth | Cloudflare Access JWT verified with `jose` (browser and MCP) |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP at `/mcp` |
| Tests | Playwright E2E only |
| Deploy | One image, one container, one `/data` volume |

Removed: PHP, Laravel, Vue, Inertia, Reverb, queue worker, Typesense, nginx,
s6. Hashtags stay as plain text; the tag index and the unused templates feature
are dropped (5 tags, 0 templates in live data).

## Layout

Same repo, branch `next`, merged to `main` at cutover.

```
client/   React app (routes, components, stores)
server/   Hono app, auth, db, sync, mcp, jobs
shared/   Tiptap extensions, Markdown, types (used by client and server)
tests/    Playwright E2E + fixtures
```

## Architecture

```
Browser --HTTPS--+                          +- SQLite: /data/db.sqlite
                 +- Cloudflare Access - cloudflared - docs-app :3000
Agent ---OAuth---+   (JWT on every request)   |  +- REST /api/*
                                              |  +- WebSocket /sync (Hocuspocus)
                                              |  +- MCP /mcp
                                              |  +- static client
                                              +- files: /data/files/<vault>/...
```

- Every request and WebSocket upgrade carries `Cf-Access-Jwt-Assertion`. The
  server verifies the signature against the team JWKS and checks `aud`, then
  maps the verified email to a user. Unknown emails get a new user with no
  vaults. Service tokens are rejected.
- Each note is one Yjs document (`note:<id>`). Each vault tree is one Yjs
  document (`tree:<vaultId>`), so renames, moves and deletes show up live.
- SQLite stores the Yjs state for every note. The Markdown file on disk is a
  readable mirror, written 2 s after editing stops and when the document
  unloads. The app is the only writer; edits made directly on disk are not
  read back.
- Agent writes go through the same Yjs document as browsers (Hocuspocus direct
  connection), so live editors see them immediately and nothing is overwritten.

## Data model

| Table | Columns |
|---|---|
| `users` | id, email (unique), name, created_at |
| `vaults` | id, name, owner_id, share_token, created_at |
| `members` | vault_id, user_id |
| `nodes` | id, vault_id, parent_id, name, kind (`note`/`folder`/`file`), created_at, updated_at, deleted_at, deleted_by, trash_root |
| `docs` | node_id, state (Yjs update), updated_at |
| `versions` | id, node_id, markdown, author_id, source (`web`/`mcp`/`restore`/`import`), created_at |
| `links` | source_id, target_id |
| `pins` | user_id, node_id, created_at |
| `search` | FTS5 over name and Markdown |

IDs from the current database are kept, so existing links, MCP note IDs and the
share token keep working.

## Parity (must match today)

- Home: vaults first, then recent; search, new vault, import; rename only.
- Vault: A-Z tree, sub-notes, folders, drag and drop, chevron only when a note
  has children, SPA navigation per vault, full path in the header.
- Editor: read/edit toggle (toolbar hidden when reading), mobile toolbar,
  Mermaid, Archify, HTML preview, code blocks, tables, tasks, images and
  attachment upload, light/dark theme.
- Sharing: collaborators with email lookup (any member can share), public link
  with short token, public read-only share page.
- Search across vaults; Markdown zip import/export.
- MCP: `me`, `vaults`, `list`, `search`, `read`, `create`, `update`, `move` with
  the same arguments as now, plus `delete` (moves to trash).
- Branding: current favicon/icons, tab title is the note name, home is "Docs".

## New features

### Live co-editing

- Tiptap Collaboration + Collaboration Caret; caret and selection show the
  user's name in a stable colour.
- The top bar shows avatars of everyone in the note.
- Offline edits are kept in IndexedDB and merge on reconnect. A small status dot
  shows the connection.
- Revoking access closes that user's open connections.

### Version history

- A snapshot is saved after 5 min of edits ending, before any agent `replace`,
  before restore, and before moving a note to trash.
- History panel: list of versions with author and source, a rendered diff
  against the current version, and Restore.
- Restore applies as a normal edit, so everyone in the note sees it and it can
  be undone.
- Retention: everything for 7 days, then one per day for 90 days, then one per
  week.

### Trash

- Delete moves the note and its sub-notes to trash; links and history are kept.
- Trash view per vault: restore (to the original parent, or the vault root if
  the parent is gone; duplicate names get a suffix) or delete permanently.
- Purged after 30 days by a daily job.

### Note links

- Typing `[[` opens a note picker; picking a note inserts a normal Markdown link
  (`[Name](/Folder/Name.md)`), so exports stay portable.
- Renaming or moving a note rewrites the links in every note that points to it,
  through Yjs so open editors update live.
- The note menu has a Backlinks list. A link to a note in trash shows as broken.

### Command menu

- `/` in the editor: headings, lists, tasks, table, code, Mermaid, Archify, HTML,
  image, link to note. Filter by typing; works on mobile.
- `Cmd/Ctrl+K`: jump to any note or vault, and actions (new note, toggle theme,
  history, trash).
- Both use shadcn Command.

### Table of contents

- Top-bar icon opens a popover of H1-H3 headings and highlights the current
  section. It shows only when the note has 2 or more headings.
- Headings get stable anchors, so `#heading` links scroll to the right place.

### In-note search

- `Cmd/Ctrl+F` inside a note opens a compact bar flush to the top bar (no
  margins): match count, previous/next, Escape to close.
- Matches are highlighted with editor decorations and work in read and edit
  mode, including text inside collapsed previews.
- Search across notes stays in the existing search.

### Pinned notes

- Pin or unpin from the note menu or the tree context menu; pins belong to each
  user.
- Home shows Pinned between Vaults and Recent; the vault sidebar shows that
  vault's pins at the top.

### Copy as Markdown

- Note menu: Copy as Markdown (whole note, same serializer as the file on disk)
  and Copy link.
- Copying a selection in the editor also puts Markdown on the clipboard as
  `text/plain`.

### Progressive rendering

- The app shell (top bar and tree) renders from cached data straight away, then
  refreshes.
- The tree loads one level at a time and is virtualized, so large vaults scroll
  smoothly.
- Opening a note shows server-rendered read-only HTML at once, then swaps in the
  live editor when Yjs has synced, keeping the scroll position.
- Mermaid, Archify, HTML previews and images render when scrolled into view.
- Targets: first paint under 1 s; switching to a cached note under 150 ms.
  Checked in E2E with a 2,000-note fixture and a 1 MB note.

## Failure cases

Each case below gets an E2E check before its feature is called done.

- Markdown round trip changes content (custom blocks, tables, escaping, HTML,
  front matter, hashtags, angle-bracket links).
- Two editors type in the same paragraph; one disconnects mid-edit; reconnect
  after the server restarts.
- An agent `replace` arrives while a browser is editing.
- Yjs state and the Markdown mirror disagree after a crash; the file write fails
  or the disk is full.
- An expired, wrong-audience or missing JWT; a service token; an email change; a
  WebSocket left open after access is revoked.
- Public share page leaks private notes, trash, history or other vaults.
- Moving a note into its own subtree; moving across vaults; duplicate names.
- Restoring from trash when the parent was deleted or renamed.
- Link rewrite on rename misses notes that are open, in trash or in other vaults.
- History retention deletes the only version from before an agent replace.
- Large notes and vaults are slow; memory grows with many open Yjs documents
  (unload after 60 s idle).
- Migration drops notes, attachments, links, collaborators or the share token.

## Phases

| # | Phase | Days | Done when |
|---|---|---|---|
| 0 | Spike: headless Markdown + Yjs in Node; Hocuspocus WebSocket through Cloudflare | 2 | All 824 live notes round-trip with no diff (or each diff reviewed); a WebSocket survives through Access |
| 1 | Foundation: repo layout, auth, schema, import script, vault/tree API, home page, image, E2E harness with test JWKS | 3 | Live data imported into a disposable container; home and tree match today |
| 2 | Editor + co-editing: port extensions, read/edit, mobile toolbar, Hocuspocus, cursors, live tree, uploads | 4 | Two-browser E2E: concurrent edits merge and the Markdown on disk matches |
| 3 | Parity: sharing, public page, search, import/export, MCP, drag and drop, theme, branding | 3 | Current E2E scenarios pass against the new app |
| 4 | New features: history, trash, note links, command menu, TOC, find, pins, copy as Markdown, progressive rendering | 5 | Each feature's E2E passes on desktop and 390 px mobile |
| 5 | Backups, cutover | 2 | Restore drill passes; production runs the new image |

About 19 working days.

## Backups

- Nightly `sqlite3 .backup` plus a tar of `/data/files` into
  `/home/dylan/services/docs/backups`, keeping 14 copies; run by a user systemd
  timer `docs-backup.timer`.
- An E2E restore drill restores a backup into a disposable container and checks
  note count, content hashes and links.

## Migration and cutover

1. Dry run: import a copy of the live volumes into a disposable container.
   Compare note count, the tree, the SHA-256 of each note's Markdown,
   attachments, links, members and share token. Any difference blocks cutover.
2. Cutover: back up the live volumes, stop `docs-app`, run the final import,
   start the new image on :3000, run the smoke test and the public E2E.
   Brief downtime is accepted.
3. Rollback: switch compose back to `docs:5fe5662-ui`; the old volumes stay
   untouched. Edits made after cutover are exported as a Markdown zip before
   rolling back.
4. Remove the old image and volumes after 14 days without issues.

The undeployed storage commit `1034f96` is not needed; the import reads the live
database and files directly.

## Decisions

- No staging hostname or Cloudflare changes; verify with local E2E, then cut
  over directly.
- Trash: 30 days. History: everything for 7 days, daily to 90 days, then weekly.
- Tag index and templates are dropped; hashtags remain plain text.
