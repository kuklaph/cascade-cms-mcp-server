# cascade-cms-mcp-server

An MCP (Model Context Protocol) server that exposes the Cascade CMS REST API to LLMs and agents. Wraps the [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) library and provides Zod input validation, markdown/JSON response formatting, and actionable error messages for AI consumers.

Built in TypeScript on [Bun](https://bun.sh). **34 tools**: 33 Cascade tools across 9 cohorts (CRUD, audit-safe asset inspection, search, sites, access rights, workflow, messages, check in/out, audits/preferences, publish) plus 1 retrieval tool (`cascade_read_response`) for accessing oversize responses by handle. **4 MCP resources/templates** (`cascade://entity-types`, `cascade://sites`, `cascade://text-encoding`, `cascade://asset/{handle}/raw`). Paginated results on `cascade_search`, `cascade_list_messages`, `cascade_read_audits`, and cached asset audit tools. Oversize responses are stored in an in-memory LRU cache and accessible by handle. Every tool invocation emits a single-line audit record to stderr.

## Requirements

- **Claude Code plugin users**: Node 18+ (Claude Code spawns the MCP server via `npx`).
- **MCP client config users** (Claude Desktop, Cline, etc.): Node 18+ (for `npx`) **or** Bun 1.0+ (for `bunx`). Either works — `bunx` is faster if you already have Bun.
- **Contributors**: Bun 1.0+ for the dev toolchain (tests, watch mode) — see [Development](#development).
- A Cascade CMS instance (v8.1.1+) with an API key.
- An MCP client (Claude Code, Claude Desktop, Cline, MCP Inspector, or any compliant agent).

## Quick Start

Pick whichever path matches your client:

### Option A: Claude Code Plugin (auto-registers the MCP server)

If you use [Claude Code](https://docs.claude.com/en/docs/claude-code), install this repo as a plugin. The bundled `.claude-plugin/plugin.json` declares the MCP server inline (via its `mcpServers` field) so Claude Code auto-registers it on install — no manual config file edit.

1. Add this repo as a plugin source in Claude Code and install the `cascade-cms` plugin. The exact command varies by Claude Code version — see the [plugin documentation](https://docs.claude.com/en/docs/claude-code/plugins).
2. Set credentials in your **shell environment** (not a JSON config — Claude Code plugins read env vars from your shell at subprocess spawn):

   **POSIX** (add to `~/.bashrc`, `~/.zshrc`, or your shell's rc file):
   ```bash
   export CASCADE_API_KEY="your_api_key_here"
   export CASCADE_URL="https://yourorg.cascadecms.com/api/v1/"
   ```

   **Windows PowerShell** (add to `$PROFILE`):
   ```powershell
   $env:CASCADE_API_KEY = "your_api_key_here"
   $env:CASCADE_URL = "https://yourorg.cascadecms.com/api/v1/"
   ```

3. Make sure the env vars are set in the shell session that launches Claude Code. If Claude Code was already running when you set them, close it, open a new terminal so the updated env loads, then relaunch Claude Code from that terminal. Tools become available as `mcp__plugin_cascade-cms_cascade-cms__cascade_<op>`.

> **Credentials note**: If `CASCADE_API_KEY` or `CASCADE_URL` is unset when Claude Code spawns the server, the server exits fast with a clear error and tools will appear non-functional. Verify without leaking the secret to shell history:
>
> **POSIX**: `[ -n "$CASCADE_API_KEY" ] && echo "set" || echo "UNSET"`
>
> **PowerShell**: `if ($env:CASCADE_API_KEY) { "set" } else { "UNSET" }`

### Option B: MCP Client Config (Claude Desktop, Cline, and other MCP clients)

Add a server entry to your MCP client's config. Example for **Claude Desktop** (Windows, macOS — Anthropic does not ship Claude Desktop for Linux; on Linux use Claude Code via Option A, Cline, or another MCP-compatible client).

Edit `claude_desktop_config.json`:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cascade-cms": {
      "command": "bunx",
      "args": ["cascade-cms-mcp-server"],
      "env": {
        "CASCADE_API_KEY": "your_api_key_here",
        "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/"
      }
    }
  }
}
```

Restart the client. `bunx` fetches the package on first run and caches it (recommended for speed if you have [Bun](https://bun.sh) installed).

**Node-only alternative** — swap `bunx` for `npx` if you don't have Bun:

```json
"command": "npx",
"args": ["-y", "cascade-cms-mcp-server"]
```

Both resolve to the same entry point (`dist/index.js`) via the package's `bin`; choose whichever is already on your machine. Credentials go **inline in the `env` block** (easier than Option A's shell-env setup) since the MCP client reads them directly from the config file.

### Environment variables

Whichever path you pick, the same three variables control the server:

| Variable             | Required | Description                                                           |
| -------------------- | :------: | --------------------------------------------------------------------- |
| `CASCADE_API_KEY`    |   Yes    | API key generated from your Cascade dashboard                         |
| `CASCADE_URL`        |   Yes    | Your Cascade API URL (e.g., `https://yourorg.cascadecms.com/api/v1/`) |
| `CASCADE_TIMEOUT_MS` |    No    | Request timeout in milliseconds (default: 30000)                      |

The server exits with a clear error on startup if `CASCADE_API_KEY` or `CASCADE_URL` is missing or invalid.

#### Encrypted values (optional)

Any of the three env vars can be an [envlock](https://github.com/kuklaph/envlock) ciphertext (`enc:<iv>:<authTag>:<ciphertext>`) instead of plaintext — useful when the value would otherwise sit in plain sight inside an MCP client config file. envlock is an optional peer dependency; install it globally only if you want to use encrypted values:

```sh
bun install -g envlock   # or: npm install -g envlock
envlock set CASCADE_API_KEY "sk-your-key"   # run in a throwaway dir, then copy the enc:... output
```

If an `enc:` value is detected but envlock isn't installed, the server exits with an actionable error. Decryption errors (tampered ciphertext, wrong master key) also exit cleanly without leaking the ciphertext. Plaintext values pass through untouched and envlock is never loaded.

## MCP Client Configuration

### Claude Desktop

The Quick Start snippet above is the canonical form. Restart Claude Desktop after editing the config file; the MCP server spawns automatically when Claude starts.

### Claude Code

Three ways to add this to Claude Code, in order of recommended UX:

**Option 1 — Install as a plugin (recommended)**: See [Option A in Quick Start](#option-a-claude-code-plugin-auto-registers-the-mcp-server). The plugin's `plugin.json` declares the MCP server inline, so Claude Code auto-registers it on install.

**Option 2 — Project-scoped `.mcp.json`** at your repo root (manual MCP config Claude Code reads for this project only; same `mcpServers` shape as any MCP client config):

```json
{
  "mcpServers": {
    "cascade-cms": {
      "command": "bunx",
      "args": ["cascade-cms-mcp-server"],
      "env": {
        "CASCADE_API_KEY": "your_api_key_here",
        "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/"
      }
    }
  }
}
```

Swap `bunx` → `npx` (with `"args": ["-y", "cascade-cms-mcp-server"]`) if you don't have Bun installed.

**Option 3 — CLI**: `claude mcp add` with the same command/args/env values.

### MCP Inspector

Interactive debug UI (recommended — uses `bunx`):

```bash
bunx @modelcontextprotocol/inspector bunx cascade-cms-mcp-server
```

Or with `npx` if you don't have Bun:

```bash
npx @modelcontextprotocol/inspector npx -y cascade-cms-mcp-server
```

CLI mode (list tools without the UI):

```bash
# POSIX shell (bash, zsh) — bunx preferred:
CASCADE_API_KEY=... CASCADE_URL=... \
  bunx @modelcontextprotocol/inspector --cli \
  bunx cascade-cms-mcp-server --method tools/list
```

On Windows, set env vars separately first. PowerShell:

```powershell
$env:CASCADE_API_KEY="..."
$env:CASCADE_URL="..."
bunx @modelcontextprotocol/inspector --cli bunx cascade-cms-mcp-server --method tools/list
```

Or Windows `cmd`:

```cmd
set CASCADE_API_KEY=...
set CASCADE_URL=...
bunx @modelcontextprotocol/inspector --cli bunx cascade-cms-mcp-server --method tools/list
```

Every invocation above works with `npx` (with `-y` on the package) if Bun isn't installed. Both tools resolve the published package identically.

The Inspector will list all 34 tools and 4 resources/templates, and let you invoke them interactively.

## Audit Logging

Every tool invocation emits a single line to stderr. Format:

```
[cascade-cms-mcp-server] cascade_read: ok in 234ms
[cascade-cms-mcp-server] cascade_create: error in 123ms — "Permission denied"
```

Error suffixes are passed through the same secret-redaction pipeline as user-facing errors, newlines are collapsed, and length is capped at 500 characters. stdout stays reserved for the MCP JSON-RPC protocol stream.

Claude Desktop and similar clients typically route server stderr to a log file; check your client docs for the location.

## Tool Catalog

Every tool accepts an optional `response_format` parameter (`"markdown"` or `"json"`, default `"markdown"`). Most Cascade-backed tools return a Cascade `OperationResult` wrapped in MCP `content` + `structuredContent`. `cascade_read` is different by default: it returns a compact preview plus an `asset_handle`; use `read_mode: "raw"` only when you need the full REST payload.

**Oversize handling**: When a tool's rendered text exceeds 25,000 characters, the server stores the full payload in an in-memory cache, returns a 20,000-char preview + handle in `content[0].text`, and adds a `_cache` envelope (`{handle, bytes_total, bytes_returned, tool}`) to `structuredContent`. Use [`cascade_read_response`](#response-cache) to fetch additional bytes by handle and offset. See [Response Cache](#response-cache) for the full pattern.

**MCP annotations**: Each tool also sets `destructiveHint`, `idempotentHint`, and `openWorldHint` per MCP conventions. Tools marked `destructiveHint: true` are `cascade_remove`, `cascade_delete_message`, and `cascade_publish_unpublish`. Inspect tool metadata via the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for full annotation details.

### Assets (CRUD)

| Tool | Read-only | Description |
| ---- | :-------: | ----------- |
| `cascade_read` | Yes | Canonical first-step asset read. Default `read_mode: "preview"` returns `asset_handle`, identity, `raw_hash`, `index_version`, fact/reference counts, node counts, root outline, and raw resource URI. Preview is orientation-only (`audit_complete: false`). Use `read_mode: "raw"` for the full REST payload. |
| `cascade_asset_list_facts` | Yes | Use after `cascade_read`. List indexed raw object, array, key, and scalar facts by JSON Pointer with audit metadata and cursor pagination. |
| `cascade_asset_search_values` | Yes | Use after `cascade_read`. Search full raw scalar values, not previews; returns pointer, key, scalar type, value length, preview, and match offsets. |
| `cascade_asset_search_keys` | Yes | Use after `cascade_read`. Find object key occurrences anywhere in the raw cached JSON. |
| `cascade_asset_get_value` | Yes | Use after `cascade_read`. Retrieve the exact raw value at a JSON Pointer; supports `offset`/`length` for long strings. |
| `cascade_asset_list_scalar_artifacts` | Yes | Use after `cascade_read`. Derived view over raw string facts for `http_url`, `site_link`, `href`, `src`, `anchor`, `mailto`, `tel`, and `root_path` artifacts with pointer and offset provenance. |
| `cascade_asset_list_references` | Yes | Use after `cascade_read`. List Cascade-native references from id/path pairs, structured asset nodes, metadata, page configurations, and page regions. |
| `cascade_asset_list_nodelets` | Yes | Use after `cascade_read`. Convenience view over `structuredDataNodes`; list nodelets by parent pointer. Not audit-complete. |
| `cascade_asset_get_nodelet` | Yes | Use after `cascade_read`. Convenience view over `structuredDataNodes`; fetch an exact nodelet or bounded subtree. Not audit-complete. |
| `cascade_create` | No | Create a new asset. Body is a typed envelope, for example `{ page: {...} }`, `{ textBlock: {...} }`, or `{ site: {...} }`. |
| `cascade_edit` | No | Edit an existing asset |
| `cascade_remove` | No | Delete an asset (with optional workflow + delete parameters) |
| `cascade_move` | No | Move and/or rename an asset |
| `cascade_copy` | No | Copy an asset to a new container with a new name |

### Search

| Tool             | Read-only | Description                                                |
| ---------------- | :-------: | ---------------------------------------------------------- |
| `cascade_search` |    Yes    | Search assets by terms, field, and type filter (paginated) |

### Sites

| Tool                 | Read-only | Description                                                                |
| -------------------- | :-------: | -------------------------------------------------------------------------- |
| `cascade_list_sites` |    Yes    | List all sites accessible with current credentials                         |
| `cascade_site_copy`  |    No     | Copy an entire site to a new site with a new name (long-running operation) |

### Access Rights

| Tool                         | Read-only | Description                                         |
| ---------------------------- | :-------: | --------------------------------------------------- |
| `cascade_read_access_rights` |    Yes    | Read access rights for an asset                     |
| `cascade_edit_access_rights` |    No     | Modify access rights (optionally apply to children) |

### Workflow

| Tool                                  | Read-only | Description                               |
| ------------------------------------- | :-------: | ----------------------------------------- |
| `cascade_read_workflow_settings`      |    Yes    | Read workflow settings for a container    |
| `cascade_edit_workflow_settings`      |    No     | Update workflow settings for a container  |
| `cascade_read_workflow_information`   |    Yes    | Read in-flight workflow info for an asset |
| `cascade_perform_workflow_transition` |    No     | Advance a workflow to its next action     |

### Messages, Relationships & Subscribers

| Tool                       | Read-only | Description                                                                             |
| -------------------------- | :-------: | --------------------------------------------------------------------------------------- |
| `cascade_list_subscribers` |    Yes    | List an asset's relationships (what references it) and notification subscribers         |
| `cascade_list_messages`    |    Yes    | List in-Cascade messages for the authenticated user (paginated)                         |
| `cascade_mark_message`     |    No     | Mark a message as read/unread/archive/unarchive                                         |
| `cascade_delete_message`   |    No     | Permanently delete a message                                                            |

> `cascade_list_subscribers` answers "what relationships does this asset have?" — i.e. which other assets reference it. The lookup is **inbound**: query the asset being referenced to find the assets that point at it (pass a block's identifier to find the pages that embed it). The outbound direction — "which blocks does this page embed?" — is not queryable; read the page and inspect its body.

### Check In / Check Out

| Tool                | Read-only | Description                                |
| ------------------- | :-------: | ------------------------------------------ |
| `cascade_check_out` |    No     | Lock an asset for exclusive editing        |
| `cascade_check_in`  |    No     | Release a checked-out asset with a comment |

### Audits & Preferences

| Tool                       | Read-only | Description                                            |
| -------------------------- | :-------: | ------------------------------------------------------ |
| `cascade_read_audits`      |    Yes    | Read audit log entries matching parameters (paginated) |
| `cascade_read_preferences` |    Yes    | Read system preferences                                |
| `cascade_edit_preference`  |    No     | Update a single system preference                      |

### Publish

| Tool                        | Read-only | Description                                                                  |
| --------------------------- | :-------: | ---------------------------------------------------------------------------- |
| `cascade_publish_unpublish` |    No     | Publish an asset (or unpublish with `unpublish: true` in publishInformation) |

### Response Cache

| Tool                     | Read-only | Description                                                                                  |
| ------------------------ | :-------: | -------------------------------------------------------------------------------------------- |
| `cascade_read_response`  |    Yes    | Retrieve a slice of an oversize cached response by handle (`{handle, offset?, length?}`). See [Response Cache](#response-cache) for the full pattern. |

## Resources

Resources expose URI-addressable reference data that agents can fetch via MCP `resources/read` without invoking a tool.

| URI                      |  Kind   | Description                                                                                                      |
| ------------------------ | :-----: | ---------------------------------------------------------------------------------------------------------------- |
| `cascade://entity-types` | Static  | JSON listing all Cascade entity type strings (page, file, folder, block, template, etc.) with short descriptions |
| `cascade://sites`        | Dynamic | Live `listSites()` result (JSON). On upstream failure, body is a JSON error envelope: `{ "error": "..." }`       |
| `cascade://text-encoding` | Static | Markdown rules for rich text/XML, format/template source, and plain text encoding |
| `cascade://asset/{handle}/raw` | Template | Exact raw JSON cached from a prior `cascade_read` preview. Replace `{handle}` with `structuredContent.asset_handle`. |

JSON resources advertise `application/json`. The error envelope on `cascade://sites` and missing raw asset handles is a valid JSON object, so agents can reliably `JSON.parse` the response without checking a separate error flag.

## Pagination

`cascade_search`, `cascade_list_messages`, and `cascade_read_audits` accept optional pagination fields and return pagination metadata in both `content` and `structuredContent`.

### Parameters

| Field    | Type   | Default | Bounds |
| -------- | ------ | :-----: | :----: |
| `limit`  | number |   50    | 1–500  |
| `offset` | number |    0    |  ≥ 0   |

### Response envelope

```json
{
  "success": true,
  "total": 237,
  "count": 50,
  "offset": 0,
  "has_more": true,
  "next_offset": 50,
  "matches": [ ... ]
}
```

Arrays: `matches` (search), `messages` (list_messages), `audits` (read_audits).

### Iteration pattern

```
let offset = 0;
while (true) {
  const page = await call({ ..., limit: 100, offset });
  processPage(page.items);
  if (!page.has_more) break;
  offset = page.next_offset;
}
```

### Guidance for agents

- **Default `limit: 50` fits most queries.** Raise to 500 for bulk enumeration.
- **If `has_more: false`, stop.** Don't re-query; you've seen everything.
- **If you only need top matches** (e.g., "first file that mentions X"), stop as soon as the found item appears — don't exhaust the set.
- **For complete date-ranged audit exports**, loop until `has_more: false` to guarantee no gaps.

Pagination is performed client-side by the MCP layer: Cascade's REST endpoints always return full result sets, and this server slices them before returning. Full data is always available in `structuredContent` if the agent prefers to process it in one pass; if the rendered text exceeds 25,000 characters, the [Response Cache](#response-cache) kicks in and the agent can retrieve additional bytes via `cascade_read_response`.

## Response Cache

When a tool's rendered response text exceeds 25,000 characters, the server stores the full payload in an in-memory LRU cache and returns:

- **`content[0].text`** — a 20,000-char preview followed by a marker naming the handle and the retrieval tool
- **`structuredContent._cache`** — `{handle, bytes_total, bytes_returned, tool}`, where `tool` is always `"cascade_read_response"`
- **`structuredContent`** — the original raw response object, untouched alongside `_cache` (machine-readable clients see everything)

The marker text looks like:

```
---
[Preview truncated at 20000 of 145000 chars. Full response retained as handle h_550e8400-e29b-41d4-a716-446655440000. To retrieve more: call cascade_read_response({handle, offset, length}). Slice with offset:20000 to continue. See structuredContent._cache for machine-readable metadata.]
```

### Retrieving more bytes

Call `cascade_read_response` with the handle plus an offset and length:

```json
{
  "tool": "cascade_read_response",
  "arguments": { "handle": "h_550e8400-...", "offset": 20000, "length": 25000 }
}
```

Returns:

```json
{
  "success": true,
  "handle": "h_550e8400-...",
  "bytes_total": 145000,
  "offset": 20000,
  "bytes_returned": 25000,
  "has_more": true,
  "next_offset": 45000
}
```

The slice text itself appears in `content[0].text` (raw, not JSON-fenced). `length` is capped at 25,000 chars per call; iterate via `next_offset` until `has_more: false`.

### Cache policy

| Setting              | Value           | Notes                                                            |
| -------------------- | --------------- | ---------------------------------------------------------------- |
| Eviction             | LRU             | Last 10 oversize responses retained; recency refreshed on `get`  |
| Per-entry cap        | 2 MB            | Larger payloads store a "[entry too large]" marker by the handle |
| Total memory         | ~20 MB max      | Bounded by the two caps above                                    |
| TTL                  | None            | Process-scoped; cache dies when the stdio server exits           |
| Handle format        | `h_<uuid>` (38 chars) | Cryptographically random via `crypto.randomUUID()`         |

If a handle is missing or evicted, `cascade_read_response` returns `isError: true` with a message naming the handle and suggesting to re-run the originating tool.

## Cascade Read Flow

`cascade_read` is the canonical entrypoint for inspecting assets. In default preview mode it calls Cascade once, stores the exact raw response under an `asset_handle`, builds a complete raw fact index, then derives nodelet, reference, string search, and scalar-artifact views from that index. Preview output is browse-oriented and never claims audit completeness:

```json
{
  "asset_handle": "a_550e8400-e29b-41d4-a716-446655440000",
  "asset_type": "page",
  "asset_identity": { "id": "abc123", "name": "index", "path": "/" },
  "raw_resource_uri": "cascade://asset/a_550e8400-e29b-41d4-a716-446655440000/raw",
  "raw_hash": "b7d7...",
  "index_version": 1,
  "audit_complete": false,
  "total_fact_count": 840,
  "reference_count": 12,
  "node_count": 62,
  "max_depth": 4,
  "root_outline": [ { "pointer": "/asset/page/structuredData/structuredDataNodes/0", "identifier": "page-options", "type": "group" } ],
  "omitted_fields": ["structuredData"],
  "warnings": [],
  "next_actions": ["cascade_asset_list_facts", "cascade_asset_search_values", "cascade_asset_search_keys", "cascade_asset_get_value", "cascade_asset_list_scalar_artifacts", "cascade_asset_list_references", "cascade_asset_list_nodelets", "cascade_asset_get_nodelet", "cascade://asset/{handle}/raw"]
}
```

Follow-up tools require that `asset_handle`; they do not call Cascade again.

Preview recognizes Cascade asset envelopes such as `page`, `xhtmlDataDefinitionBlock`, `symlink`, `scriptFormat`, `dataDefinition`, `template`, `indexBlock`, `metadataSet`, `site`, and `file`. Non-structured assets still return `node_count: 0`; use raw facts, scalar artifacts, or the raw resource for inspection.

```json
{ "tool": "cascade_asset_search_values", "arguments": { "asset_handle": "a_550e8400-...", "value_contains": "headline" } }
```

```json
{ "tool": "cascade_asset_list_facts", "arguments": { "asset_handle": "a_550e8400-...", "fact_kind": "scalar", "non_empty": true, "limit": 100 } }
```

```json
{ "tool": "cascade_asset_get_value", "arguments": { "asset_handle": "a_550e8400-...", "pointer": "/asset/page/xhtml", "offset": 0, "length": 25000 } }
```

Use `read_mode: "raw"` only when you need the full Cascade REST payload for editing or external processing:

```json
{
  "tool": "cascade_read",
  "arguments": {
    "identifier": { "id": "abc123", "type": "page" },
    "read_mode": "raw"
  }
}
```

### Audit-safe asset workflows

Paginated raw audit tools (`cascade_asset_list_facts`, `cascade_asset_search_values`, `cascade_asset_search_keys`, `cascade_asset_list_scalar_artifacts`, `cascade_asset_list_references`) include `asset_handle`, `raw_resource_uri`, `raw_hash`, `index_version`, `source_scope`, `filter_hash`, `limit`, `returned_count`, `matched_count_total`, `total_fact_count`, `complete`, and `truncated`. `cursor` is echoed only when supplied, and `next_cursor` appears only when more results remain. Cursors are opaque and tied to the filter hash; restart without a cursor if you change filters. Treat `complete: true` as scoped to that exact query only.

Find any string/path/URL anywhere:

```json
{ "tool": "cascade_asset_search_values", "arguments": { "asset_handle": "a_550e8400-...", "value_contains": "https://example.edu", "limit": 100 } }
```

Audit asset references:

```json
{ "tool": "cascade_asset_list_references", "arguments": { "asset_handle": "a_550e8400-...", "reference_kind": "block", "limit": 100 } }
```

Enumerate link/path-like scalar artifacts without knowing a search term:

```json
{ "tool": "cascade_asset_list_scalar_artifacts", "arguments": { "asset_handle": "a_550e8400-...", "artifact_kind": "href", "limit": 100 } }
```

Audit page regions/configurations:

```json
{ "tool": "cascade_asset_list_facts", "arguments": { "asset_handle": "a_550e8400-...", "pointer_prefix": "/asset/page/pageConfigurations", "limit": 100 } }
```

Retrieve all non-empty text fields:

```json
{ "tool": "cascade_asset_list_facts", "arguments": { "asset_handle": "a_550e8400-...", "fact_kind": "scalar", "scalar_type": "string", "non_empty": true, "limit": 100 } }
```

Find fields by key name:

```json
{ "tool": "cascade_asset_search_keys", "arguments": { "asset_handle": "a_550e8400-...", "key_contains": "title", "limit": 100 } }
```

Raw fact tools expose the invariant index over the exact JSON. Nodelet tools are convenience-only views over `structuredDataNodes`. Scalar artifacts are a derived view over raw string facts for common link and path audits; use their `source_pointer`, `start_offset`, and `end_offset` to trace every match back to the cached raw scalar.

## Example Tool Invocations

### Read a page by id

```json
{
  "tool": "cascade_read",
  "arguments": {
    "identifier": {
      "id": "d3631e59ac1easd2434bd70be3fbfe8148abc",
      "type": "page"
    }
  }
}
```

### Read a folder by path

```json
{
  "tool": "cascade_read",
  "arguments": {
    "identifier": {
      "path": { "path": "/about/team", "siteName": "www" },
      "type": "folder"
    }
  }
}
```

### Search for pages containing "admissions" (paginated)

```json
{
  "tool": "cascade_search",
  "arguments": {
    "searchInformation": {
      "searchTerms": "admissions",
      "searchTypes": ["page"],
      "searchFields": ["title", "summary"],
      "siteName": "www"
    },
    "limit": 100,
    "offset": 0
  }
}
```

Response `structuredContent`:

```json
{
  "success": true,
  "total": 237,
  "count": 100,
  "offset": 0,
  "has_more": true,
  "next_offset": 100,
  "matches": [ { "id": "...", "type": "page", "path": { "path": "/admissions", "siteName": "www" } }, ... ]
}
```

### Read audit log entries for April 2026

```json
{
  "tool": "cascade_read_audits",
  "arguments": {
    "auditParameters": {
      "auditType": "publish",
      "startDate": "2026-04-01T00:00:00Z",
      "endDate": "2026-04-30T23:59:59Z"
    },
    "limit": 200
  }
}
```

### List recent inbox messages

```json
{
  "tool": "cascade_list_messages",
  "arguments": { "limit": 20 }
}
```

### Create a page

```json
{
  "tool": "cascade_create",
  "arguments": {
    "asset": {
      "page": {
        "name": "new-page",
        "parentFolderPath": "/about",
        "siteName": "www",
        "contentTypePath": "/standard/content-type"
      }
    }
  }
}
```

### Publish an asset

```json
{
  "tool": "cascade_publish_unpublish",
  "arguments": {
    "identifier": { "id": "abc123", "type": "page" },
    "publishInformation": { "unpublish": false }
  }
}
```

### Request JSON output instead of markdown

Add `response_format: "json"` to any call:

```json
{
  "tool": "cascade_read",
  "arguments": {
    "identifier": { "id": "abc123", "type": "page" },
    "response_format": "json"
  }
}
```

## Response Formats

- `response_format: "markdown"` (default) - human/LLM-readable markdown with key fields highlighted. Best for agent reasoning.
- `response_format: "json"` - pretty-printed JSON of the tool's structured result. For `cascade_read` preview mode this is the compact handle-based preview; use `read_mode: "raw"` for the raw Cascade response.

For Cascade-backed tools other than `cascade_read` preview mode, the Cascade response object is passed through to `structuredContent` (null/empty is wrapped as `{}`; primitives as `{ value: X }`). Cached asset follow-up tools return their documented cached-inspection result objects. When a rendered response exceeds 25,000 characters, the [Response Cache](#response-cache) intercepts it: `content[0].text` becomes a 20,000-char preview + handle, `structuredContent` keeps the full object plus a `_cache` envelope, and the agent can fetch additional bytes via `cascade_read_response`.

## Asset Input Schemas

For `cascade_create` and `cascade_edit`, the `asset` field is a typed envelope that mirrors Cascade's native `Asset` schema 1:1:

```json
{ "asset": { "<typeKey>": { /* ...fields... */ } } }
```

`<typeKey>` is one of 48 camelCase property names on Cascade's `Asset` object — for example `page`, `file`, `folder`, `symlink`, `textBlock`, `feedBlock`, `indexBlock`, `xhtmlDataDefinitionBlock`, `xmlBlock`, `twitterFeedBlock`, `reference`, `template`, `xsltFormat`, `scriptFormat`, `user`, `group`, `role`, `site`, `contentType`, `metadataSet`, `pageConfigurationSet`, `publishSet`, `dataDefinition`, `sharedField`, `destination`, `editorConfiguration`, `assetFactory`, `wordPressConnector`, `googleAnalyticsConnector`, `fileSystemTransport`, `ftpTransport`, `databaseTransport`, `cloudTransport`, `workflowDefinition`, `workflowEmail`, and the matching `*Container` types.

Each envelope key maps to a strict Zod schema derived from the upstream OpenAPI spec: every declared field is modelled with its correct required/optional marker. Unknown keys are rejected so typos fail fast. Round-trip is symmetric when `cascade_read` is called with `read_mode: "raw"`: modify the raw asset envelope and send it straight back to `cascade_edit` without reshaping.

> **Envelope key vs EntityType string.** Cascade uses two parallel naming schemes. The camelCase **envelope keys** above (`xhtmlDataDefinitionBlock`, `xsltFormat`, `ftpTransport`, `contentType`, `editorConfiguration`, `wordPressConnector`, ...) are body-shape discriminators under `asset.<key>`. The lowercase / snake_case **EntityType strings** (`block_XHTML_DATADEFINITION`, `format_XSLT`, `transport_ftp`, `contenttype`, `editorconfiguration`, `wordpressconnector`, ...) are the values used in `identifier.type` for `cascade_read`, `cascade_move`, `cascade_list_subscribers`, and similar. A handful of types spell the same in both schemes (`page`, `file`, `folder`, `symlink`, `template`, `reference`, `site`, `user`, `group`, `role`); most do not. Never interchange them — see the `cascade://entity-types` resource for the full EntityType list.

If Cascade returns a validation error (for example, a create-time required field missing), the error message surfaces directly in the MCP response.

## Development

For contributors and those wanting to run a local build or modify the server. End users do not need to clone — use the `npx` snippet in [Quick Start](#quick-start).

### Setup

```bash
git clone https://github.com/kuklaph/cascade-cms-mcp-server
cd cascade-cms-mcp-server
bun install
```

Optional: copy `.env.example` to `.env` and fill in credentials for local smoke tests (the MCP client's `env` block is the production path; `.env` is a developer convenience).

### Commands

The dev loop requires Bun (scripts shell out to `bun run`). End users running the published package only need Node 18+.

```bash
bun test                 # Run all tests (~290 tests across 23 files)
bun run typecheck        # Type-check with tsc --noEmit
bun run build            # Compile src/ → dist/ via tsconfig.build.json
bun run smoke:node       # Boot dist/index.js with Node, verify startup banner
bun run dev              # Watch mode (runs src/index.ts on save)
bun start                # Run src/index.ts once with Bun
node dist/index.js       # Run the built output with Node (after bun run build)
```

### Publishing

`prepublishOnly` runs `bun test && bun run build && bun run smoke:node` automatically before `npm publish` / `bun publish`, so a broken tree cannot ship. The smoke test boots `node dist/index.js` with dummy credentials and requires the startup banner on stderr, catching any Node-runtime regression that the Bun test suite can't see. The published package ships only `dist/`, `README.md`, and `LICENSE` (see `"files"` in `package.json`).

### Project Structure

```
.claude-plugin/
  plugin.json           Claude Code plugin manifest (name, metadata,
                        and inline mcpServers config for the plugin)
  marketplace.json      Single-plugin marketplace catalog for
                        /plugin marketplace add
src/
  index.ts              stdio bootstrap (redirects console.* → stderr)
  server.ts             createServer() factory (wires all tool cohorts + retrieval tool + resources)
  client.ts             Cascade API client factory
  config.ts             env validation
  errors.ts             error translation to MCP format (+ exported redactSecrets)
  formatting.ts         markdown/JSON response formatting + oversize handle minting
  constants.ts          character limit, preview limit, cache caps, server name/version
  audit.ts              stderr audit-log line per invocation (redacts + sanitizes)
  pagination.ts         client-side pagination helper + paginatedHandler factory
  cache.ts              in-memory LRU response cache for oversize payloads
  resources.ts          MCP resource registrations/templates (entity-types, sites, text-encoding, raw asset)
  tools/
    helper.ts           registerCascadeTool shared helper + CascadeDeps interface
    crud.ts             read, asset follow-ups, create, edit, remove, move, copy
    search.ts           search (paginated)
    sites.ts            list_sites, site_copy
    access.ts           read/edit_access_rights
    workflow.ts         4 workflow tools
    messages.ts         4 message tools (list_messages paginated)
    checkout.ts         check_out, check_in
    audits.ts           read_audits (paginated), read/edit_preference
    publish.ts          publish_unpublish
    readResponse.ts     cascade_read_response (slice retrieval by handle)
  schemas/
    common.ts           Identifier, EntityType, Path, ResponseFormat, ReadMode
    assets.ts           Discriminated asset union + passthrough fallback
    requests.ts         Zod request schemas (Cascade tools, asset follow-ups, retrieval, pagination)
tests/
  unit/                 mirrors src/ (includes audit, pagination, resources)
  integration/          end-to-end server wiring tests
  fixtures/             mock client + mock server helpers + canned responses
```

## How It Works

Both install paths converge on the same built `dist/index.js` running under Node. The difference is who registers the MCP server with the client:

```
 ┌───────────────────────────────┐   ┌───────────────────────────────┐
 │ Claude Code (plugin)          │   │ Claude Desktop / Cline /      │
 │                               │   │ other MCP clients             │
 │ /plugin install cascade-cms   │   │ edit config.json              │
 │            │                  │   │            │                  │
 └────────────┼──────────────────┘   └────────────┼──────────────────┘
              │ auto-registers from               │ manual entry
              ▼                                   ▼
     .claude-plugin/plugin.json          "command": "bunx" or "npx"
     mcpServers field (inline)           "args": ["cascade-cms-mcp-server"]
     pins "command": "npx",              (user choice; -y required for npx)
     "args": ["-y", ...]
              │                                   │
              └────────────────┬──────────────────┘
                               ▼
            npx -y cascade-cms-mcp-server  /  bunx cascade-cms-mcp-server
                 (resolves the npm package's bin)
                               │
                               ▼
                 dist/index.js (#!/usr/bin/env node)
                               │
                               ▼
                        Cascade CMS API
```

1. The MCP client spawns the server subprocess. For plugin users, Claude Code reads the `mcpServers` field inline in `plugin.json` and runs `npx -y cascade-cms-mcp-server` with env vars from the user's shell. For MCP-config users, the client runs `bunx cascade-cms-mcp-server` (or `npx -y`) with env vars from the config's `env` block. Either way, the runner resolves the package's `bin` entry to `dist/index.js`, and the `#!/usr/bin/env node` shebang routes execution through Node. The entry point redirects `console.*` to stderr (guards the stdio protocol stream from accidental stdout writes by dependencies), validates config, builds a Cascade client from `cascade-cms-api`, creates an MCP server, registers 33 Cascade tools + the `cascade_read_response` retrieval tool + 4 resources/templates, and connects over stdio.
2. Each cohort file (`src/tools/<cohort>.ts`) calls `registerCascadeTool(server, config, deps)` for each of its tools, where `deps` carries the shared response cache.
3. The helper wraps the tool handler with: start timer → Zod input validation → delegate to the Cascade client method → format response (markdown or JSON) → catch + translate errors to MCP `isError: true` results → emit a stderr audit record (`ok`/`error` + duration + redacted error text).
4. Paginated tools (`cascade_search`, `cascade_list_messages`, `cascade_read_audits`) extract `limit`/`offset` from input, call Cascade for the full result set, and slice client-side via `paginatedHandler`.
5. When rendered text exceeds 25,000 characters, `formatResponse` mints a handle, stores the full text in the in-memory LRU cache, and returns a 20,000-char preview + handle. The companion `cascade_read_response` tool retrieves slices by handle. See [Response Cache](#response-cache).
6. Resources/templates (`cascade://entity-types`, `cascade://sites`, `cascade://text-encoding`, `cascade://asset/{handle}/raw`) are registered alongside tools on the same server. Dynamic resource errors return a JSON error envelope so `application/json` parsing stays reliable.

## Security Notes

- API keys are loaded from environment variables only. The server never echoes, logs, or surfaces credential values in error messages (defensive redaction catches common patterns even if upstream errors ever embed them).
- All error messages are routed to the MCP client via `isError: true` results. Stack traces and internal details never reach the client.
- Input validation via Zod `.strict()` rejects unknown fields at the MCP boundary; rare passthrough cases are bounded by the discriminator enum.

## License

MIT — see [LICENSE](LICENSE).

## Related

- [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) — the underlying JavaScript client library
- [Model Context Protocol](https://modelcontextprotocol.io/) — the protocol specification
- [Cascade CMS REST API](https://www.hannonhill.com/cascadecms/latest/developing-in-cascade/rest-api/index.html) — upstream API documentation
