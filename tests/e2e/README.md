# Browser checks

## Failure cases to cover before changing the implementation

- Nested-note parent paths must be visible above the title inside the same 60px
  header, keep every parent on phones, and truncate long names without
  squeezing controls. Preserve the full path tooltip, rename/SPA updates, and hide
  redundant paths on the vault's main note and while compact formatting is open.
- Reading mode must hide the phone formatting toggle and collapse open tools,
  restoring the title/search/account without changing editor content. Switching
  back to editing and reloading must preserve the preference and usable controls.
- Encoded TOC paths (including Labs' absolute paths with %20) must open their
  exact child notes in edit/read modes on phone/desktop, without full reloads.
  Preserve raw-space and relative paths, external URL escapes and one-decode
  semantics; saving/reloading must not progressively encode links.

- Compact formatting must open in the existing header, scroll without moving the
  page, preserve text selection, and return to the title/search/account controls.
  Check long titles, opening the tree, changing notes, read/source modes and
  resizing while tools are open. Desktop editing tools stay separate from view
  and account actions; direct Bold/Italic controls reflect the selection.

- One 60px header must contain navigation, editable title and editor controls,
  with no secondary title/toolbar row. Check 320/390/639/640/768/1023/1024/1440px
  in both themes; the title stays at least 100px wide with a 16px font on phones
  to avoid Safari input zoom. Formatting is centred on desktop and opens as a
  swipeable strip on phones. Extra styles use the More panel. Preserve selection,
  keyboard focus, source/read locks, every command, rename/autosave/reload,
  SPA/history, search/account/home/tree, empty-vault and attachment behavior.

- Reference-inspired editor polish must preserve the existing editor, nested-note
  navigation and autosave. Keep search only in the top-right header, with no sidebar
  search button or empty search row. The new-note shortcut belongs beside the vault
  header controls. Header search/new-note shortcuts must reuse the existing
  dialogs, restore keyboard focus and stay usable at 320/390px without shrinking
  touch targets. Breadcrumbs must follow note switches, rename and history without
  duplicates or layout shifts. Muted chrome must retain readable contrast in both
  themes; sidebar boundaries, selected rows, document measure and formatting menus
  must remain clear. Verify screenshots on phones and desktop using disposable
  content only. Do not commit, push, deploy, or change live notes for this preview.

- Collaboration must be a separate icon beside the vault menu, accessible by
  touch/keyboard at 320px and desktop widths, with no duplicate dropdown entry.
- The Access picker's Public means all verified Docs users, not anonymous access. Existing/new
  vaults remain restricted by default. Browser home, recent notes, deep links,
  files, search, edits and MCP must agree on access, including newly signed-in
  users. Returning to restricted must revoke implicit access but preserve explicit
  collaborators; invalid/non-member changes must fail. Failed saves must retain
  the previous visibility. Previously connected sockets must not receive future
  private content after public access is removed. Vault deletion remains owner-only.
- Every favicon format must follow the resolved app theme on initial load, menu
  changes and reload, even when OS appearance differs. New dark raster paths
  must pass the exact Access/tunnel exceptions and retain alpha transparency.
  Legacy icon paths and all private routes must keep their existing behavior.

- Renaming icon resources must update source files, Docker copies, HTML links,
  Nginx matching and exact Cloudflare exceptions together. Legacy URLs must retain
  their original bytes; generated JS/CSS hashes are not part of the rename.
- Browser icon links must use short filenames with the approved artwork,
  correct formats and light/dark selection on phone and desktop. Old icon URLs
  must keep working for cached pages. Nginx and Cloudflare must serve images,
  not login/HTML responses, with a short cache lifetime; built JS/CSS must retain
  immutable caching. Public exceptions must match only exact icon paths, never
  directories, suffix paths or application routes. Existing login policies and
  other tunnel hostnames must remain unchanged. Safari's saved site icon may
  outlive the HTTP cache and cannot be verified from a fresh browser profile.
- Selected document rows use Graphite (#27272A) with readable light text in both
  themes and at phone/desktop widths; unrelated primary buttons remain unchanged.
- Vault navigation must retain the navbar/sidebar DOM, expanded branches and
  sidebar scroll without document reloads or a full-screen loading overlay.
  Reopening the active note must be a no-op. Rapid clicks must finish on the
  latest note, Back/Forward must restore titles/content without a second reload,
  and note switches/close must flush pending title/content saves. Failed saves
  must keep the current draft visible. Late save callbacks must never overwrite
  the newly opened note; undo history must remain isolated between notes.
- Tree arrows appear only on branches with children, including before lazy loading.
  Adding the first child shows an arrow; moving/deleting the last hides it without
  a reload. Expansion remains keyboard/touch accessible; leaf titles stay aligned,
  can still be opened and accept new sub-notes or drops.
- Nested notes: creation, expansion, reload/deep links, A–Z ordering and
  desktop drag/drop must preserve note content and descendants. Invalid/self/
  descendant/attachment/cross-vault destinations must be rejected; cancelled
  drags and failed moves must leave the tree usable. External file drops must
  not accidentally move a note. Mobile/keyboard users need a destination picker,
  visible focus, usable touch targets and bounded indentation for long/deep trees.
- Parent rename/move/delete must handle child files, paths and backlinks as well
  as database rows. Existing folder/note basename collisions must not overwrite
  data. ZIP export/import must preserve note parenting and attachments. No live
  notes are changed by the test fixture.
- Home redirects into an old/deleted document instead of the library.
- Browser tab titles must be Docs on home, the active document name when open,
  and the vault name when no document is open. Rename, reload and navigation
  must update the title without appending a brand suffix or stripping real dashes.
- Small screens overflow; long names hide actions; dark-mode contrast is poor.
- Search, ordering, recent links, and empty states make documents hard to find.
- Document search must have no outer panel padding or nested input frame. Its
  single 48px search row must align with the close control, results must follow
  the divider without a gap, and narrow screens, both themes, empty results,
  touch selection, keyboard selection and Escape/focus return must remain usable.
- Private or unaccepted shared vaults appear in home or MCP results.
- Dialogs lack names, lose keyboard focus, or fail to restore it after closing.
- Validation/server errors close a form and discard its contents; repeat submits race.
- Creating, renaming, deleting, exporting, or opening documents stops working.
- MCP schemas differ from accepted arguments; reads/writes stop working after refactoring.
- MCP moves must require an explicit note and destination (null means vault root),
  preserve IDs, content, children, attachment bytes and backlinks, and handle
  duplicate names without overwrites. Repeated moves must be safe. Reject cycles,
  missing/attachment/cross-vault destinations, inaccessible or revoked notes,
  invalid types and unexpected arguments. Browser moves must remain unchanged.
- Authenticated requests fail, or unauthenticated requests enter the workspace.
- Browser and MCP resolve the same verified email to different user IDs or vaults.
- MCP accepts the retired agent credential, a service identity, another Access
  application's audience, expired assertions, or an unverified email header.
- MCP-first sign-in creates a duplicate account when the user opens the browser.
- Private or pending vaults permit MCP reads/writes, or revoked access stays usable.
- Missing Access configuration silently disables MCP authentication.
- Build/type errors, browser exceptions, or server failures produce a blank page.
- Missing notification styles consume editor space; screenshots catch unsettled
  sidebar animations instead of their final responsive layout.
- Editor menus must open by touch/click and keyboard, keep all items in the
  viewport at 320px, and apply formatting without losing the editor selection.
- Document-tree menus must keep create/rename/delete actions usable, including
  modal focus when opened from a menu. Read and Markdown switches need explicit states.
- Sharing tabs and nested confirmation dialogs must work with a keyboard; profile
  changes, missing-document recovery, and both source/editor modes must remain usable.
- HTML previews must preserve literal source (including entities) through editing,
  save/reload and source-mode changes. Ordinary code blocks and raw HTML outside
  code blocks must not become previews.
- Preview styles must not affect Docs. Scripts, forms, navigation, nested frames
  and external resources must be blocked; previews must fit narrow screens and
  remain usable with the keyboard and in read mode.
- Archify blocks must preserve JSON through save/reload and source-mode changes.
  Invalid JSON, unsupported types, duplicate IDs, missing endpoints and oversized
  inputs must show recoverable errors, not break the editor. Labels are text only.
  Multiple diagrams must have independent SVG IDs and zoom state. Pan, pinch,
  keyboard zoom/reset, modal focus/escape, phone sizing and both themes must work;
  removing a block or navigating away must close its modal and release listeners.

The editor engine and original sidebar are preserved. HTML previews extend the
existing code blocks; the sidebar's original menus are retained.

## Run

Links must remain underline-free at rest, hover and focus in editor/public notes
on phones and desktop in both themes. Preserve distinct link colours, destinations,
internal-note navigation, Markdown source and keyboard focus indication.

Home search styling must match the Import button's resting background and border
in both themes at phone/tablet/desktop widths, while preserving focus indication,
search filtering and the compact mobile toolbar.

Home order failures to cover: Vaults must precede Recent in DOM/keyboard and
visual order on tablet/desktop, in both themes. Preserve A–Z sorting, search,
recent-note links, empty states, and the vault-only mobile toolbar without gaps.

Vault landing failures to cover: opening a vault must select its top-level note
matching the vault name (case-insensitively), not a nested duplicate, folder,
attachment or recently edited file. Without a matching note, use a top-level
`index.md` note (case-insensitively); a matching vault-name note takes priority.
Nested indexes must not become landing notes. Explicit note links must still win
and stay vault-scoped. Missing/renamed/deleted landing notes and empty vaults must show a simple
note-selection state without creating content or showing Recent files. Verify
mobile/desktop, public read-only links, refresh and Back/Forward, save-before-return,
and persistent SPA shell. Removing the recent-files UI must not break note links.

Mobile sharing failures to cover: the URL must use the full row at 320/390px,
avoid horizontal overflow and Safari input zoom, and keep actions at least 44px
tall. Copy/open must remain distinct from labelled link removal. Confirmation
must support Cancel/Escape without revoking, retain the link after failed removal,
and invalidate it only after confirmed success. Verify both themes and desktop,
preserve collaborator controls, and save screenshots for repeatable review.

Sharing-copy failures to cover: the signed-in/public-link descriptions must not
appear; access selection, link creation/copy/revocation and error alerts must
remain usable without blank caption rows on mobile and desktop.

Short-link failures to cover: new links must use a 22-character URL-safe random
key; existing 64-character URLs and their shorter aliases must resolve the same
vault and revoke together. Invalid/altered keys, cross-vault files and writes
must remain blocked. Both link formats and assets must pass the tunnel's narrow
public rule without changing workspace/MCP authentication. The share icon must
render at 14px without shrinking its 36px click area, losing its accessible label,
changing placement or preventing collaboration from opening on mobile/desktop.

Public-link failures to verify before implementation: guests must not reach the
editor, MCP, collaboration endpoints, private vaults, or files outside the shared
vault. Link creation and revocation must require an existing authorized user,
retain input after failed saves, and invalidate old URLs without cached content.
Deploying must leave every existing vault unpublished. Public pages must load
all scripts, styles, icons, linked notes and attachments beneath `/share/*`,
include no user/collaborator data, offer no editable fields or saves, preserve
Markdown/HTML/diagram rendering, and fit 320px through desktop widths. Invalid
tokens, missing/deleted notes, empty vaults and restricted methods must fail
cleanly; public navigation must handle back/forward and stale requests.

Native in-note links must resolve into the current share only when their origin,
vault and file belong to that shared vault. Absolute and root-relative links,
fragments, normal clicks, copied/new-tab URLs and Back/Forward must work without
private asset requests. External origins, another vault, malformed or missing
file IDs must keep their original links. Reader rendering must preserve stored
Markdown and produce no content writes.

Build a candidate with `docker build -t docs:review .`, then run
`node tests/e2e/run.mjs docs:review`. Requires Docker, `npm ci`, and Playwright
Chromium (`npx playwright install chromium`). Screenshots and the report go to
`artifacts/e2e/` (ignored). To capture the old UI, add `--baseline`.

For icon changes only, run `node tests/e2e/run.mjs docs:review --icons-only`
and `node tests/e2e/icons.mjs https://docs.x44ylan.com`. Theme checks are saved
to `artifacts/e2e/icon-themes.json`; edge checks are in `artifacts/e2e/icons.json`.

The runner starts a disposable container on a random loopback port with an empty
SQLite database, fixture files, and synthetic identities. It never mounts production
data or changes production's trusted keys. It removes only its own container on exit.
Run `node tests/e2e/run.mjs docs:review --sharing` for the public-sharing checks,
phone/desktop screenshots and a real disposable Reverb WebSocket test. This checks
that a socket kept open after access is revoked receives no further private content.
Its report is `artifacts/e2e/sharing.json`.
Run `node tests/e2e/run.mjs docs:review --public` for the anonymous public-reader
checks. Private asset paths are deliberately blocked in the browser to emulate
Cloudflare Access; the report is `artifacts/e2e/public.json` and screenshots use
the `public-` prefix.
Run `node tests/e2e/run.mjs docs:review --navigation` for main-note landing and
SPA navigation. Its report is `artifacts/e2e/navigation.json`; landing screenshots
use the `vault-main-` prefix.
Run `node tests/e2e/run.mjs docs:ui --ui` for visual polish checks and screenshots
at 320/390/1440px in both themes. Its report is `artifacts/e2e/ui.json`.
Run `node tests/e2e/run.mjs docs:header --header` for merged-header layout and
editor checks. The repeatable report is `artifacts/e2e/header.json`; screenshots
use the `header-` prefix. Add `--baseline` with the previous image to compare
existing editor behavior before the structural change.
Add `--preview` to expose the disposable sample workspace through a temporary
Cloudflare Quick Tunnel for 50 minutes. The preview proxy blocks writes and unrelated
routes; no production data, keys, volumes or tunnel configuration are used.
Run `node tests/e2e/run.mjs docs:review --mcp` for MCP identity, move and browser
tree regression checks. The report is `artifacts/e2e/mcp.json`; moved-note
screenshots use the `mcp-` prefix. Tests use only disposable notes and identities.
Anonymous links require a separate Cloudflare Access application for
`docs.x44ylan.com/share/*` with Bypass → Everyone; keep the main application
authenticated. In Collaboration, create a Public link to publish a vault
read-only, or disable it to revoke the URL. Existing vaults are not published.
If the tunnel validates Access JWTs at the origin, add a separate Docs ingress
before its protected catch-all, with `originRequest.access.required: false` and
path `^/share/(([A-Za-z0-9_-]{22}|[a-f0-9]{64})(/files)?|build/assets/[A-Za-z0-9._-]+|icon-(light|dark)\.svg|touch\.png)$`.
For a remotely managed tunnel, update the Cloudflare configuration too: it
overrides the local YAML. Keep every other ingress and Access policy unchanged.
Run `node tests/e2e/public.mjs https://docs.x44ylan.com` to verify the deployed
Access boundary and assets without publishing user content; its report is
`artifacts/e2e/public-edge.json`.
Access-picker checks cover keyboard selection, checked state, Escape returning
focus without closing Collaboration, phone overflow, and failed saves restoring
the previous selection. The picker must use the shared themed menu components.
Checks include a ZIP export/import round trip and a persisted editor change.
Auth checks compare browser/MCP user IDs and vault lists, exercise MCP-first
sign-in and the `me` tool, and verify private/pending access and revocation.
Search indexing and broadcasts are disabled in this fixture; real-time multi-user
editing and the Cloudflare edge redirect still require staging/manual verification.
