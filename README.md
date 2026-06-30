# cascade-cms-mcp-server

An MCP (Model Context Protocol) server that exposes Cascade CMS operations to LLMs and agents. It wraps [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) with Zod validation, JSON responses, `structuredContent`, and actionable errors.

Built in TypeScript on [Bun](https://bun.sh). It provides Cascade asset tools, draft workflows, file-data helpers, browser-backed tools, guardrails, and local cache inspection.

Start with [Setup](#setup) for required values and client config. Use [What It Can Do](#what-it-can-do) to judge fit. [Agent Reference](#agent-reference) covers tool-call mechanics.

## Setup

### Requirements

- Node 20+.
- Bun 1.0+ for the preferred `bunx` setup.
- A Cascade CMS instance with REST API access and an API key.
- An MCP client that can launch stdio servers, such as Claude, Codex, Cline, MCP Inspector, or another compliant client.

### Quick Start

Most MCP clients need `command`, `args`, `CASCADE_API_KEY`, and `CASCADE_URL`. Browser-backed tools also need `CASCADE_BROWSER_USERNAME`, `CASCADE_BROWSER_PASSWORD`, and `CASCADE_BROWSER_SITE_ID`. Use `bunx` when available; use `npx` otherwise.

The credentials below are placeholders. Use your MCP client's secret/env handling, local environment, or dotseal-encrypted values for real credentials.

For Cascade API access, consider using a dedicated service/API user when your organization can provide one. Give that user only the permissions needed for the MCP workflows instead of using a personal account.

#### MCP Client Config

Use one of these shapes for JSON-based MCP configs.

```json
{
  "mcpServers": {
    "cascade-cms": {
      "command": "bunx",
      "args": ["cascade-cms-mcp-server"],
      "env": {
        "CASCADE_API_KEY": "your_api_key_here",
        "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/",
        "CASCADE_BROWSER_USERNAME": "browser_username",
        "CASCADE_BROWSER_PASSWORD": "browser_password",
        "CASCADE_BROWSER_SITE_ID": "production_site_id",
        "CASCADE_BROWSER_URL": "https://yourorg.cascadecms.com/"
      }
    }
  }
}
```

Node/npm fallback:

```json
{
  "mcpServers": {
    "cascade-cms": {
      "command": "npx",
      "args": ["-y", "cascade-cms-mcp-server"],
      "env": {
        "CASCADE_API_KEY": "your_api_key_here",
        "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/",
        "CASCADE_BROWSER_USERNAME": "browser_username",
        "CASCADE_BROWSER_PASSWORD": "browser_password",
        "CASCADE_BROWSER_SITE_ID": "production_site_id",
        "CASCADE_BROWSER_URL": "https://yourorg.cascadecms.com/"
      }
    }
  }
}
```

Omit `CASCADE_BROWSER_URL` when the browser login host matches the origin derived from `CASCADE_URL`.

For UI-based clients, enter the same values:

| Field       | Bun value                                                       | Node/npm value                 |
| ----------- | --------------------------------------------------------------- | ------------------------------ |
| Command     | `bunx`                                                          | `npx`                          |
| Arguments   | `cascade-cms-mcp-server`                                        | `-y`, `cascade-cms-mcp-server` |
| Environment | `CASCADE_API_KEY`, `CASCADE_URL`, browser env values when using browser-backed tools, optional `CASCADE_TIMEOUT_MS` | Same                           |

Restart the client after config changes. Call `server_version` to confirm the server is running.

#### Client-Specific Examples

Client-specific setup screens and config file locations vary. Use the same command, args, and env values above.

Codex uses `~/.codex/config.toml`:

```toml
[mcp_servers.cascade-cms]
command = "bunx"
args = ["cascade-cms-mcp-server"]

[mcp_servers.cascade-cms.env]
CASCADE_API_KEY = "your_api_key_here"
CASCADE_URL = "https://yourorg.cascadecms.com/api/v1/"
CASCADE_BROWSER_USERNAME = "browser_username"
CASCADE_BROWSER_PASSWORD = "browser_password"
CASCADE_BROWSER_SITE_ID = "production_site_id"
CASCADE_BROWSER_URL = "https://yourorg.cascadecms.com/"
```

Claude Desktop uses `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Claude Code can use its normal MCP config flow. This repo also includes a Claude Code plugin manifest in `.claude-plugin/plugin.json`; if you install the plugin, set credentials in the shell environment that launches Claude Code.

Native Windows configs that use `npx` may need `command: "cmd"` with args `["/c", "npx", "-y", "cascade-cms-mcp-server"]`.

### Encrypted Environment Values

All environment values below may use [dotseal](https://github.com/kuklaph/dotseal) ciphertexts in `enc:<iv>:<authTag>:<ciphertext>` format. Plaintext values still work.

Generate ciphertext with dotseal:

```bash
bunx dotseal encrypt "your_api_key_here"
```

Example:

```json
"env": {
  "CASCADE_API_KEY": "enc:...",
  "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/",
  "CASCADE_BROWSER_USERNAME": "browser_username",
  "CASCADE_BROWSER_PASSWORD": "enc:...",
  "CASCADE_BROWSER_SITE_ID": "production_site_id",
  "CASCADE_BROWSER_URL": "https://yourorg.cascadecms.com/"
}
```

### Environment Variables

| Variable                   |  Required   | Description                                                           |
| -------------------------- | :---------: | --------------------------------------------------------------------- |
| `CASCADE_API_KEY`          |     Yes     | API key generated from your Cascade dashboard                         |
| `CASCADE_URL`              |     Yes     | Cascade API URL, for example `https://yourorg.cascadecms.com/api/v1/` |
| `CASCADE_TIMEOUT_MS`       |     No      | Request timeout in milliseconds. Default: `30000`                     |
| `CASCADE_BROWSER_USERNAME` | Browser API | Browser UI username for browser-backed tools                          |
| `CASCADE_BROWSER_PASSWORD` | Browser API | Browser UI password for browser-backed tools                          |
| `CASCADE_BROWSER_SITE_ID`  | Browser API | Cascade site ID for browser-backed tools. Use the [production site ID](#find-the-site-id) by default |
| `CASCADE_BROWSER_URL`      |     No      | HTTPS browser UI root URL. Defaults to the origin derived from `CASCADE_URL`. Set this when the browser login host or root path differs |

### Browser API Setup

Standard Cascade API tools only require `CASCADE_API_KEY` and `CASCADE_URL`. Browser-backed tools also log in through Cascade's browser UI, cache a session cookie in the MCP process, and call browser-only endpoints.

Recommended browser setup:

1. Set `CASCADE_BROWSER_USERNAME`, `CASCADE_BROWSER_PASSWORD`, and `CASCADE_BROWSER_SITE_ID` together before starting the MCP server.
2. Use the [production site ID](#find-the-site-id) for `CASCADE_BROWSER_SITE_ID` unless you intentionally want browser tools scoped to another site.
3. Set `CASCADE_BROWSER_URL` only when the browser login host differs from the origin derived from `CASCADE_URL`. The browser host must match `CASCADE_URL` or share its parent domain.

The site ID is required because Cascade's browser UI keeps an active site context. Browser login calls `switchSite.act` after authentication to mirror selecting a site in Cascade's site picker.

Browser-backed requests start at most once every 3 seconds per MCP session to avoid pressuring Cascade's browser UI endpoints. This applies to startup login, auto-login, retries, draft checks, and snippet tools. Standard Cascade API tools are unaffected.

#### Find the Site ID

`CASCADE_BROWSER_SITE_ID` is the browser setup value users usually need to look up. To get the recommended production site ID:

1. Log in to Cascade in a browser.
2. Select the production site from the site picker.
3. Open Manage Site.
4. Copy the site ID from the browser URL into `CASCADE_BROWSER_SITE_ID`.

If `CASCADE_API_KEY` and `CASCADE_URL` are already configured, you can ask your MCP agent to list Cascade sites. The agent can call the `list_sites` tool and use the production site's ID from that response. This depends on the API user's permissions and may not show the intended production site.

When all three browser values are present, startup attempts browser login and caches the session. If startup login fails, the MCP server still starts and standard API tools remain available. Without `CASCADE_BROWSER_SITE_ID`, call `browser_login` with `site_id` before other browser-backed tools in the same MCP session.

## What It Can Do

Use this section to decide whether this MCP covers the job. Your MCP client or agent reads the exact tool schemas and chooses the tool calls.

| Need                                                                                                    | Supported |
| ------------------------------------------------------------------------------------------------------- | --------- |
| Read Cascade assets by id or path                                                                       | Yes       |
| Search assets by terms, fields, type, and site                                                          | Yes       |
| Create, edit, move, copy, rename, or delete assets                                                      | Yes       |
| Publish or unpublish assets                                                                             | Yes       |
| List sites                                                                                              | Yes       |
| Read or edit access rights                                                                              | Yes       |
| Read or update workflow settings and perform workflow transitions                                       | Yes       |
| List messages, mark messages, delete messages, and inspect subscribers/relationships                    | Yes       |
| Read audit logs and system preferences                                                                  | Yes       |
| Inspect raw asset content, references, strings, links, paths, and structured-data nodelets after a read | Yes       |
| Inspect binary `file.data`, read bounded byte ranges, return image content, and export files locally    | Yes       |
| Build, inspect, patch, validate, and submit complete create/edit asset drafts                           | Yes       |
| Authenticate to the Cascade browser UI and cache a browser session                                      | Yes       |
| Check the browser-only active editing draft notification for an asset                                   | Yes; requires browser API config or prior `browser_login`, plus `asset_id` and `asset_type` |
| List, create, update, and delete browser-admin snippets                                                 | Yes; requires browser API config or prior `browser_login` |
| Fetch additional bytes from large/truncated responses                                                   | Yes       |
| Persist blocked-call rules that prevent matching MCP tool calls from running                            | Yes       |
| Generate site and root-folder removal safeguards                                                        | Yes       |

Use your MCP client's tool list or inspector for exact request schemas.

## Agent Reference

These sections are mainly for agents and users configuring MCP approvals. They cover response handling, tool groups, workflow examples, guardrails, and MCP resources.

### Response Model

Most tool responses put JSON text in `content[0]`. When present, `structuredContent` is the authoritative machine-readable result.

Oversized responses return bounded `_cache` metadata. Use `read_response` with that handle to page through the full serialized response. Handles are process-scoped and may be evicted after later calls.

`read` returns a compact preview plus an `asset_handle` by default. Use `read_mode: "raw"` only when you need the full Cascade payload immediately. Follow-up tools inspect cached data and do not call Cascade again.

`file_data_image` returns image-only MCP content. Call `file_data_info` separately for JSON metadata.

### Tool Permissions

Use these groups when configuring MCP client approvals. Client config syntax varies. A common policy is to allow read-only inspection by default and require approval for tools that create, update, delete, publish, check in/out, change browser-admin state, write local files, or mutate local MCP state such as drafts and guardrails.

"Read-only" means the tool does not persist a change. It may still call Cascade unless the group says it is local-only.

Cascade API read-only tools:

| Tool                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `read`                      | Read an asset and return a preview or raw response |
| `search`                    | Search Cascade assets                              |
| `list_sites`                | List Cascade sites                                 |
| `read_access_rights`        | Read access rights for an asset                    |
| `read_workflow_settings`    | Read workflow settings for a folder                |
| `read_workflow_information` | Read workflow information for an asset             |
| `list_subscribers`          | List subscribers for an asset                      |
| `list_messages`             | List Cascade messages                              |
| `read_audits`               | Read audit log entries                             |
| `read_preferences`          | Read system preferences                            |

Browser-backed read-only tools:

These tools call Cascade browser UI endpoints. They use a cached browser session or log in automatically when browser env values are configured.

| Tool                    | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `browser_check_draft`   | Check browser-only active editing draft notification for an asset |
| `browser_list_snippets` | List browser-admin snippets with pagination                       |

Local cache and utility read tools:

These tools do not call Cascade directly. They inspect in-memory handles created by earlier tool calls or return MCP server metadata.

| Tool                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `server_version`               | Read this MCP server's name and version                            |
| `read_response`                | Fetch more text from a cached oversized response                   |
| `asset_list_facts`             | List indexed raw JSON facts from a cached read                     |
| `asset_search_values`          | Search scalar values in a cached read                              |
| `asset_search_keys`            | Search object keys in a cached read                                |
| `asset_get_value`              | Fetch one raw JSON value from a cached read                        |
| `asset_list_scalar_artifacts`  | List links, paths, and similar scalar artifacts from a cached read |
| `asset_list_references`        | List Cascade references found in a cached read                     |
| `asset_list_nodelets`          | List structured-data nodelets from a cached read                   |
| `asset_get_nodelet`            | Fetch one structured-data nodelet from a cached read               |
| `asset_resolve_nodes`          | Resolve structured-data nodes by semantic criteria                 |
| `asset_assert_values`          | Assert structured-data field values from a cached read             |

Structured-data selectors support `expected_matches` to assert exact match counts.

File data tools:

Use these for Cascade `file` assets whose binary content is stored in `file.data`. Each tool accepts an `asset_handle` from `read` or a direct file `identifier`. With an `asset_handle`, the tool uses the local cache. With an `identifier`, it reads the file from Cascade first and caches it.

| Tool               | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `file_data_info`   | Return byte count, SHA-256, detected MIME/kind, and a short hex preview |
| `file_data_read`   | Return a bounded byte range as `hex` or `base64`                        |
| `file_data_image`  | Return magic-byte verified image files as image-only MCP content        |
| `file_data_export` | Write exact bytes to an explicit local `output_path`                    |

`create`, `edit`, and `local_draft_submit` accept `file.data` as signed Java bytes (`-128..127`) or unsigned file bytes (`0..255`) and send Cascade signed bytes. `file_data_export` writes to an explicit local path, refuses overwrites unless `overwrite: true`, and can verify `expected_sha256`.

Local draft workflow tools:

Drafts are mutable, in-memory payloads for `create` or `edit`. Local draft tools do not change Cascade until `local_draft_submit`.

- Edit drafts start from a cached `asset_handle`; create drafts start from an asset envelope or scaffold.
- Patch tools mutate only the local draft addressed by `draft_handle`.
- `local_draft_set_file_data` reads exactly one of `input_path` or `base64_data`, normalizes bytes to signed `file.data`, and keeps bytes outside draft JSON until submit.
- `local_draft_submit` validates the final payload, checks tool-block rules, re-reads edit sources to reject stale drafts, and then calls Cascade.

Local draft inspection tools:

| Tool                                | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `local_draft_get_value`             | Fetch one JSON value from a draft                    |
| `local_draft_list_facts`            | List indexed JSON facts from a draft                 |
| `local_draft_search_values`         | Search scalar values in a draft                      |
| `local_draft_search_keys`           | Search object keys in a draft                        |
| `local_draft_list_references`       | List references in a draft                           |
| `local_draft_list_scalar_artifacts` | List links, paths, and similar artifacts in a draft  |
| `local_draft_list_nodelets`         | List structured-data nodelets in a draft             |
| `local_draft_get_nodelet`           | Fetch one structured-data nodelet from a draft       |
| `local_draft_resolve_nodes`         | Resolve structured-data nodes by semantic criteria   |
| `local_draft_assert_values`         | Assert structured-data field values in a draft       |
| `local_draft_validate`              | Validate a draft without calling Cascade             |

Approval recommended for local MCP state or filesystem changes:

| Tool                                | State change                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `local_draft_open`                  | Creates a mutable local draft from a read snapshot or initial asset payload               |
| `local_draft_scaffold_create`       | Creates a mutable local create draft with required placeholders for one asset type        |
| `local_draft_scaffold_from_asset`   | Creates a mutable local create draft from a cached asset shape                            |
| `local_draft_apply_patch`           | Mutates a local draft with JSON Pointer patch operations                                  |
| `local_draft_apply_semantic_patch`  | Mutates a local draft after resolving structured-data nodes semantically                  |
| `local_draft_mutation_plan_execute` | Runs local draft workflow steps sequentially and stops on first failure                   |
| `local_draft_set_file_data`         | Sets signed Cascade file bytes on a local file draft from exactly one path or base64 payload |
| `file_data_export`                  | Writes Cascade file bytes to an explicit local filesystem path                            |
| `browser_login`                     | Authenticates to the browser UI and stores a local browser session for later browser tools |
| `tool_blocks`                       | Changes the local blocked-call repository                                                 |
| `protect_site_removal`              | Changes the local blocked-call repository after reading accessible sites and root folders |

Approval recommended for Cascade or browser-admin changes:

| Tool                          | State change                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| `create`                      | Creates an asset                                                    |
| `edit`                        | Edits an asset                                                      |
| `local_draft_submit`          | Creates or edits an asset from the complete validated draft payload |
| `move`                        | Moves or renames an asset                                           |
| `copy`                        | Copies an asset                                                     |
| `site_copy`                   | Copies a site                                                       |
| `edit_access_rights`          | Changes asset access rights                                         |
| `edit_workflow_settings`      | Changes workflow settings                                           |
| `perform_workflow_transition` | Performs a workflow transition                                      |
| `mark_message`                | Marks a message                                                     |
| `check_out`                   | Checks out an asset                                                 |
| `check_in`                    | Checks in an asset                                                  |
| `edit_preference`             | Changes a system preference                                         |
| `browser_create_snippet`      | Creates a browser-admin snippet                                     |
| `browser_update_snippet`      | Updates a browser-admin snippet by ID                               |
| `browser_delete_snippets`     | Deletes one or more browser-admin snippets by ID                    |

High-impact approval recommended:

| Tool                        | State change                      |
| --------------------------- | --------------------------------- |
| `remove`            | Deletes an asset, except sites and root-folder path `/` requests |
| `delete_message`    | Deletes a message                 |
| `publish_unpublish` | Publishes or unpublishes an asset |

### Workflow Examples

Read a page by id:

```json
{
  "tool": "read",
  "arguments": {
    "identifier": {
      "id": "d3631e59ac1easd2434bd70be3fbfe8148abc",
      "type": "page"
    }
  }
}
```

Read a folder by path:

```json
{
  "tool": "read",
  "arguments": {
    "identifier": {
      "path": { "path": "/about/team", "siteName": "www" },
      "type": "folder"
    }
  }
}
```

Inspect cached read data after a preview:

```json
{
  "tool": "asset_search_values",
  "arguments": {
    "asset_handle": "a_550e8400-e29b-41d4-a716-446655440000",
    "value_contains": "admissions"
  }
}
```

Use the `asset_handle` returned by `read`; `asset_*` tools are follow-ups, not first-step reads.

Edit from a cached read without reconstructing the full payload in chat:

```json
{
  "tool": "local_draft_open",
  "arguments": {
    "operation": "edit",
    "asset_handle": "a_550e8400-e29b-41d4-a716-446655440000",
    "expected_raw_hash": "ce4136fed2dd50c2a7eaf8f6802a5f7820515dda57f0a7f91a47861db6c8fff4"
  }
}
```

```json
{
  "tool": "local_draft_apply_patch",
  "arguments": {
    "draft_handle": "d_550e8400-e29b-41d4-a716-446655440001",
    "expected_revision": 1,
    "operations": [
      {
        "op": "replace",
        "path": "/asset/page/structuredData/structuredDataNodes/4/structuredDataNodes/9/text",
        "value": "<p>Updated HTML</p>"
      }
    ]
  }
}
```

```json
{
  "tool": "local_draft_submit",
  "arguments": {
    "draft_handle": "d_550e8400-e29b-41d4-a716-446655440001",
    "expected_revision": 2,
    "discard_on_success": true
  }
}
```

Rules meant to block submitted drafts may target `local_draft_submit`. Use `create` or `edit` when the same rule should also block direct calls and matching local draft workflows before local draft work continues. For `create`, path rules match the intended parent path plus asset name once both are known.

Scaffold a create draft when starting from an asset type instead of a read:

```json
{
  "tool": "local_draft_scaffold_create",
  "arguments": {
    "asset_type": "page",
    "relationship_style": "path"
  }
}
```

The response includes the draft handle, scaffolded asset envelope, and required placeholders to patch before validation or submit. To scaffold from a cached asset, use `local_draft_scaffold_from_asset` with the `asset_handle` and `raw_hash` from `read`.

Set binary file data on a file draft before submit:

```json
{
  "tool": "local_draft_set_file_data",
  "arguments": {
    "draft_handle": "d_550e8400-e29b-41d4-a716-446655440001",
    "expected_revision": 1,
    "input_path": "C:\\tmp\\image.jpg"
  }
}
```

Provide exactly one of `input_path` or `base64_data`. The tool normalizes bytes to Cascade signed `file.data`, preserves existing string `text`, and keeps the byte payload outside draft JSON until submit.

Search for pages:

```json
{
  "tool": "search",
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

### Guardrails: Blocked Tool Calls

Use `tool_blocks` to list or add local rules that block matching tool calls before they reach Cascade. Rules live at `~/.cascade-cms-mcp-server/tool-blocks.json`.

The safest access control is still Cascade/API permissions. Tool blocks are an additional MCP-local guardrail for defense in depth, not a replacement for server-side permissions.

Each rule needs `tools` plus at least one selector: `url`, `id`, or `path`. Explicit `id` and `path` selectors also need `type`. `reason` is optional and appears in the blocked-call error.

Use `protect_site_removal` to generate remove and move safeguards for accessible sites and their root folders. It replaces its previous generated rules and preserves unrelated rules.

```json
{
  "tool": "tool_blocks",
  "arguments": {
    "action": "add",
    "rule": {
      "url": "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
      "tools": ["remove", "edit"],
      "reason": "Protected block"
    }
  }
}
```

### Resources

| URI                            |   Kind   | Description                                               |
| ------------------------------ | :------: | --------------------------------------------------------- |
| `cascade://entity-types`       |  Static  | Cascade entity type strings with short descriptions       |
| `cascade://sites`              | Dynamic  | Live `listSites()` result                                 |
| `cascade://text-encoding`      |  Static  | Text, rich text, XML, format, and template encoding rules |
| `cascade://asset/{handle}/raw` | Template | Exact raw JSON cached from a prior `read` preview |
| `cascade://draft/{handle}/raw` | Template | Exact draft JSON unless blocked by draft read tool-block rules, the tool-block repository cannot be read, or the handle is invalid/missing |

## Troubleshooting

- If tools appear unavailable, verify the MCP client can start the server and that `CASCADE_API_KEY` and `CASCADE_URL` are set in the environment used by that client.
- If a cached handle is missing, rerun the originating tool. Handles are in-memory and process-scoped.
- If `local_draft_open` reports an `expected_raw_hash` mismatch, rerun `read` and use the current `raw_hash`.
- If `local_draft_submit` reports that the source asset changed, rerun `read` and open a fresh draft.
- If a draft patch or submit reports an `expected_revision` mismatch, inspect the draft and retry with the current revision.
- If a rendered response is truncated, call `read_response` with the returned handle, offset, and length.
- Most MCP clients write server stderr to client logs. This server keeps stdout reserved for MCP JSON-RPC.

## Security Notes

- Credentials are loaded from environment variables only. Keep real values in the local MCP client environment, a client secret store, or dotseal-encrypted env values.
- Cached reads, drafts, and browser sessions are in-memory and process-scoped. Restart the MCP server to clear them.
- Draft and write tools check blocked-call rules before mutating local state or calling Cascade.
- Error messages are redacted before being logged or returned.
- Input validation rejects unknown fields at the MCP boundary.

## License

MIT - see [LICENSE](LICENSE).

## Related

- [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) - underlying JavaScript client library
- [dotseal](https://github.com/kuklaph/dotseal) - optional encrypted environment value helper
- [Model Context Protocol](https://modelcontextprotocol.io/) - protocol specification
- [Cascade CMS REST API](https://www.hannonhill.com/cascadecms/latest/developing-in-cascade/rest-api/index.html) - upstream API documentation
