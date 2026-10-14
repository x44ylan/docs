# Docs

A private, self-hosted workspace for Markdown notes, written and edited together in real time.

- Live co-editing with named cursors; works offline and merges on reconnect
- Vaults with nested notes, drag and drop, pins, trash and version history
- `/` commands, `[[` note links with backlinks, table of contents, find in note, Cmd+K search
- Mermaid, JSON architecture diagrams and sandboxed HTML previews
- Read-only public links, and sharing by email
- Cloudflare Access sign-in, shared with [MCP agents](docs/mcp.md)

Notes are stored in SQLite and mirrored as plain Markdown files.

## Run

```sh
npm ci --legacy-peer-deps && npm run build
CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com CF_ACCESS_AUD=<aud> DOCS_DATA=./data npm start
```

Or `docker build -t docs .` and mount a volume at `/data`. Tests: `npm test`.

## Credits

Originally based on [Many Notes](https://github.com/brufdev/many-notes/tree/v0.18.0) ([MIT](LICENSE)).
Built on [Tiptap](https://tiptap.dev), [Yjs](https://yjs.dev) and [Hocuspocus](https://tiptap.dev/hocuspocus).
Diagram geometry is adapted from [Archify](https://github.com/tt-a1i/archify) ([MIT](public/assets/archify.txt));
[Mermaid](https://github.com/mermaid-js/mermaid) ([MIT](public/assets/mermaid.txt)); HTML sanitising by
[DOMPurify](https://github.com/cure53/DOMPurify) ([license](public/assets/dompurify.txt)).
