# cascade-cms-mcp-server

An MCP (Model Context Protocol) server that exposes the Cascade CMS REST API to LLMs and agents. It wraps the [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) library with Zod validation, JSON response text, structuredContent, and actionable error messages.

Built in TypeScript on [Bun](https://bun.sh). The published server provides 57 MCP tools and 5 resources/templates for Cascade CMS asset reads/writes, draft-based create/edit workflows, search, sites, access rights, workflow, messages, check in/out, audits/preferences, publish, blocked-call management, site-removal safeguarding, server version checks, and cached response retrieval.

## Requirements

- Node 18+.
- Bun 1.0+ for the preferred `bunx` setup.
- A Cascade CMS instance with REST API access and an API key.
- An MCP client that can launch stdio servers, such as Claude, Codex, Cline, MCP Inspector, or another compliant client.

## Quick Start

Most MCP clients need the same four values: command, args, `CASCADE_API_KEY`, and `CASCADE_URL`. Add them wherever your client manages MCP servers. `bunx` is the preferred runner; use `npx` if Bun is not installed.

The example credentials below are placeholders. For real credentials, use your MCP client's secret or environment management when available, or dotseal-encrypted values. Do not commit MCP config files that contain API keys.

### MCP Client Config

Use one of these shapes for JSON-based MCP configs. Prefer the Bun example when available. If you prefer to encrypt your API key at rest, continue to [Encrypted Environment Values](#encrypted-environment-values).

Preferred, with Bun:

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

Fallback, with Node/npm:

```json
{
  "mcpServers": {
    "cascade-cms": {
      "command": "npx",
      "args": ["-y", "cascade-cms-mcp-server"],
      "env": {
        "CASCADE_API_KEY": "your_api_key_here",
        "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/"
      }
    }
  }
}
```

For clients with a UI instead of JSON, enter the same values:

| Field       | Bun value                                                       | Node/npm value                 |
| ----------- | --------------------------------------------------------------- | ------------------------------ |
| Command     | `bunx`                                                          | `npx`                          |
| Arguments   | `cascade-cms-mcp-server`                                        | `-y`, `cascade-cms-mcp-server` |
| Environment | `CASCADE_API_KEY`, `CASCADE_URL`, optional `CASCADE_TIMEOUT_MS` | Same                           |

Restart the client after changing its MCP config. Then call `cascade_server_version` to confirm the running server name and version.

### Client-Specific Examples

Client-specific setup screens and config file locations vary. The examples below use the same server values from the generic config above.

Codex uses `~/.codex/config.toml`. Prefer Bun when available.

Preferred, with Bun:

```toml
[mcp_servers.cascade-cms]
command = "bunx"
args = ["cascade-cms-mcp-server"]
env = { CASCADE_API_KEY = "your_api_key_here", CASCADE_URL = "https://yourorg.cascadecms.com/api/v1/" }
```

Fallback, with Node/npm:

```toml
[mcp_servers.cascade-cms]
command = "npx"
args = ["-y", "cascade-cms-mcp-server"]
env = { CASCADE_API_KEY = "your_api_key_here", CASCADE_URL = "https://yourorg.cascadecms.com/api/v1/" }
```

Claude Desktop uses `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Claude Code can use its normal MCP config flow with the same command, args, and env values. This repo also includes a Claude Code plugin manifest in `.claude-plugin/plugin.json`; if you install the plugin, set credentials in the shell environment that launches Claude Code:

Native Windows Claude Code configs that use `npx` may need `command: "cmd"` with args `["/c", "npx", "-y", "cascade-cms-mcp-server"]`.

POSIX:

```bash
export CASCADE_API_KEY="your_api_key_here"
export CASCADE_URL="https://yourorg.cascadecms.com/api/v1/"
```

Windows PowerShell:

```powershell
$env:CASCADE_API_KEY = "your_api_key_here"
$env:CASCADE_URL = "https://yourorg.cascadecms.com/api/v1/"
```

## Environment Variables

| Variable             | Required | Description                                                           |
| -------------------- | :------: | --------------------------------------------------------------------- |
| `CASCADE_API_KEY`    |   Yes    | API key generated from your Cascade dashboard                         |
| `CASCADE_URL`        |   Yes    | Cascade API URL, for example `https://yourorg.cascadecms.com/api/v1/` |
| `CASCADE_TIMEOUT_MS` |    No    | Request timeout in milliseconds. Default: `30000`                     |

## Encrypted Environment Values

If you prefer keeping your env values encrypted at rest, `CASCADE_API_KEY`, `CASCADE_URL`, and `CASCADE_TIMEOUT_MS` may also be [dotseal](https://github.com/kuklaph/dotseal) ciphertexts with the `enc:<iv>:<authTag>:<ciphertext>` format. This package includes dotseal as a runtime dependency, so encrypted `enc:` values work when the server runs through `bunx` or `npx`. Plaintext values pass through without loading dotseal.

The bundled runtime dependency is not exposed as a `dotseal` shell command. Use `bunx`, `npx`, or a separate global install when you want to generate ciphertexts:

```bash
bunx dotseal encrypt "your_api_key_here"
```

Alternative with npm:

```bash
npx dotseal encrypt "your_api_key_here"
```

Paste the `enc:...` output into your MCP config or shell environment. If you prefer a global CLI install, `bun install -g dotseal` or `npm install -g dotseal` is also fine; it is not required for this server to decrypt values at runtime.

Example MCP config with an encrypted API key:

```json
{
  "mcpServers": {
    "cascade-cms": {
      "command": "bunx",
      "args": ["cascade-cms-mcp-server"],
      "env": {
        "CASCADE_API_KEY": "enc:...",
        "CASCADE_URL": "https://yourorg.cascadecms.com/api/v1/"
      }
    }
  }
}
```

## Response Model

Tool responses are JSON text. When the response fits, `structuredContent` is the authoritative machine-readable result.

Oversized responses return bounded `_cache` metadata. Use `cascade_read_response` with that handle to page through the full serialized response. Handles are process-scoped and may be evicted after later calls.

`cascade_read` returns a compact preview by default plus an `asset_handle` for follow-up inspection. Use `read_mode: "raw"` only when you need the full Cascade payload in the initial response. Follow-up tools inspect the cached asset and do not call Cascade again. To edit a cached read safely, open a separate draft with `cascade_draft_open`; draft mutations never change the original read cache.

The beta `response_format` option was removed. Callers should parse `content[0].text` as JSON or prefer `structuredContent` when their client exposes it.

## Capabilities

Use this section to decide whether this MCP covers the job. Your MCP client or agent will see the exact tool schemas and choose the specific tool calls.

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
| Build, inspect, patch, validate, and submit complete create/edit asset drafts                           | Yes       |
| Fetch additional bytes from large/truncated responses                                                   | Yes       |
| Persist blocked-call rules that prevent matching Cascade tool calls from running                        | Yes       |
| Generate site and root-folder removal safeguards                                                        | Yes       |

Use your MCP client's tool list or inspector for exact request schemas.

## Tool Permissions

Use these groups when configuring MCP client approvals. Client config syntax varies, but a common policy is to allow read-only tools by default and require approval for tools that create, update, delete, publish, check in/out, change Cascade state, or mutate local MCP state such as drafts and guardrails.

Read-only tools:

| Tool                                | Purpose                                            |
| ----------------------------------- | -------------------------------------------------- |
| `cascade_read`                      | Read an asset and return a preview or raw response |
| `cascade_search`                    | Search Cascade assets                              |
| `cascade_list_sites`                | List Cascade sites                                 |
| `cascade_read_access_rights`        | Read access rights for an asset                    |
| `cascade_read_workflow_settings`    | Read workflow settings for a folder                |
| `cascade_read_workflow_information` | Read workflow information for an asset             |
| `cascade_list_subscribers`          | List subscribers for an asset                      |
| `cascade_list_messages`             | List Cascade messages                              |
| `cascade_read_audits`               | Read audit log entries                             |
| `cascade_read_preferences`          | Read system preferences                            |
| `cascade_server_version`            | Read this MCP server's name and version            |
| `cascade_read_response`             | Fetch more text from a cached oversized response   |
| `cascade_draft_get_value`           | Fetch one JSON value from a draft                  |
| `cascade_draft_list_facts`          | List indexed JSON facts from a draft               |
| `cascade_draft_search_values`       | Search scalar values in a draft                    |
| `cascade_draft_search_keys`         | Search object keys in a draft                      |
| `cascade_draft_list_references`     | List references in a draft                         |
| `cascade_draft_list_scalar_artifacts` | List links, paths, and similar artifacts in a draft |
| `cascade_draft_list_nodelets`       | List structured-data nodelets in a draft           |
| `cascade_draft_get_nodelet`         | Fetch one structured-data nodelet from a draft     |
| `cascade_draft_resolve_nodes`       | Resolve structured-data nodes by semantic criteria |
| `cascade_draft_assert_values`       | Assert structured-data field values in a draft     |
| `cascade_draft_validate`            | Validate a draft without calling Cascade           |

`cascade_read` helper tools:

These tools do not call Cascade directly. They inspect the in-memory `asset_handle` created by a prior `cascade_read` preview response.

| Tool                                  | Purpose                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `cascade_asset_list_facts`            | List indexed raw JSON facts from a cached read                     |
| `cascade_asset_search_values`         | Search scalar values in a cached read                              |
| `cascade_asset_search_keys`           | Search object keys in a cached read                                |
| `cascade_asset_get_value`             | Fetch one raw JSON value from a cached read                        |
| `cascade_asset_list_scalar_artifacts` | List links, paths, and similar scalar artifacts from a cached read |
| `cascade_asset_list_references`       | List Cascade references found in a cached read                     |
| `cascade_asset_list_nodelets`         | List structured-data nodelets from a cached read                   |
| `cascade_asset_get_nodelet`           | Fetch one structured-data nodelet from a cached read               |
| `cascade_asset_resolve_nodes`         | Resolve structured-data nodes by semantic criteria                 |
| `cascade_asset_assert_values`         | Assert structured-data field values from a cached read             |

Structured-data selectors support `expected_matches` as an exact count assertion. At the top level it asserts the number of resolved nodes; inside `where_child` it asserts the number of matching direct children on each candidate node. Single-target semantic patch and target-child selectors require `expected_matches: 1` when provided.

Draft workflow tools:

Drafts are mutable, in-memory copies used to assemble complete `cascade_create` or `cascade_edit` payloads. Edit drafts start from a cloned and edit-normalized `asset_handle`; create drafts start from an optional asset envelope, from `cascade_draft_scaffold_create`, or from `cascade_draft_scaffold_from_asset`, which creates a create-safe scaffold from any cached asset envelope by stripping read-only fields/recycled flags, clearing credential fields present in the source, adding required hidden credential placeholders when absent, and optionally clearing structured-data text and asset-reference values. Patch tools mutate only the local draft addressed by `draft_handle`, never the original `asset_handle` read cache. Semantic patch tools resolve exactly one structured-data node and then apply the existing JSON Pointer draft patch path. `cascade_draft_mutation_plan_execute` runs local draft steps sequentially, checks rules targeting the plan tool against hydrated/resolved step payloads, and stops on the first error; it is not a Cascade batch request. `cascade_draft_submit` validates the final `{ asset: ... }` payload with the normal create/edit schema, checks blocked-call rules against the resolved payload as both `cascade_draft_submit` and the final `cascade_create` or `cascade_edit` operation, re-reads edit sources to reject stale drafts, and then calls Cascade.

Approval recommended:

| Tool                                  | State change                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cascade_create`                      | Creates an asset                                                                          |
| `cascade_edit`                        | Edits an asset                                                                            |
| `cascade_draft_open`                  | Creates a mutable local draft from a read snapshot or initial asset payload               |
| `cascade_draft_scaffold_create`       | Creates a mutable local create draft with required placeholders for one asset type        |
| `cascade_draft_scaffold_from_asset`   | Creates a mutable local create draft from a cached asset shape                            |
| `cascade_draft_apply_patch`           | Mutates a local draft with JSON Pointer patch operations                                  |
| `cascade_draft_apply_semantic_patch`  | Mutates a local draft after resolving structured-data nodes semantically                  |
| `cascade_draft_mutation_plan_execute` | Runs local draft workflow steps sequentially and stops on first failure                   |
| `cascade_draft_submit`                | Creates or edits an asset from the complete validated draft payload                       |
| `cascade_move`                        | Moves or renames an asset                                                                 |
| `cascade_copy`                        | Copies an asset                                                                           |
| `cascade_site_copy`                   | Copies a site                                                                             |
| `cascade_edit_access_rights`          | Changes asset access rights                                                               |
| `cascade_edit_workflow_settings`      | Changes workflow settings                                                                 |
| `cascade_perform_workflow_transition` | Performs a workflow transition                                                            |
| `cascade_mark_message`                | Marks a message                                                                           |
| `cascade_check_out`                   | Checks out an asset                                                                       |
| `cascade_check_in`                    | Checks in an asset                                                                        |
| `cascade_edit_preference`             | Changes a system preference                                                               |
| `cascade_tool_blocks`                 | Changes the local blocked-call repository                                                 |
| `cascade_protect_site_removal`        | Changes the local blocked-call repository after reading accessible sites and root folders |

High-impact approval recommended:

| Tool                        | State change                      |
| --------------------------- | --------------------------------- |
| `cascade_remove`            | Deletes an asset, except sites and root-folder path `/` requests |
| `cascade_delete_message`    | Deletes a message                 |
| `cascade_publish_unpublish` | Publishes or unpublishes an asset |

## Examples

Read a page by id:

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

Read a folder by path:

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

Inspect cached read data after a preview:

```json
{
  "tool": "cascade_asset_search_values",
  "arguments": {
    "asset_handle": "a_550e8400-e29b-41d4-a716-446655440000",
    "value_contains": "admissions"
  }
}
```

Use the `asset_handle` returned by `cascade_read`; `cascade_asset_*` tools are follow-ups, not first-step Cascade reads.

Edit from a cached read without reconstructing the full payload in chat:

```json
{
  "tool": "cascade_draft_open",
  "arguments": {
    "operation": "edit",
    "asset_handle": "a_550e8400-e29b-41d4-a716-446655440000",
    "expected_raw_hash": "ce4136fed2dd50c2a7eaf8f6802a5f7820515dda57f0a7f91a47861db6c8fff4"
  }
}
```

```json
{
  "tool": "cascade_draft_apply_patch",
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
  "tool": "cascade_draft_submit",
  "arguments": {
    "draft_handle": "d_550e8400-e29b-41d4-a716-446655440001",
    "expected_revision": 2,
    "discard_on_success": true
  }
}
```

Rules meant to block submitted drafts may target `cascade_draft_submit`. Use `cascade_create` and/or `cascade_edit` when the same rule should also block direct create/edit calls.

Scaffold a create draft when starting from an asset type instead of a read:

```json
{
  "tool": "cascade_draft_scaffold_create",
  "arguments": {
    "asset_type": "page",
    "relationship_style": "path"
  }
}
```

The response includes the draft handle, the scaffolded asset envelope, and `required_value_pointers` for every `null` placeholder that must be patched before validation or submit.

When starting from an existing cached asset, use `cascade_draft_scaffold_from_asset` with the `asset_handle` and `expected_raw_hash` set to the `raw_hash` returned by `cascade_read`. The response includes a create draft, a create-safe scaffold, `cleared_value_pointers`, and op-aware `replace_value_pointers`/`add_value_pointers` for values that need new content. Credential fields present in the source are cleared; required hidden credential fields are added as `null` placeholders when absent. `clear_values` controls only structured-data text and asset-reference clearing.

Search for pages:

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

Create a page:

```json
{
  "tool": "cascade_create",
  "arguments": {
    "asset": {
      "page": {
        "name": "new-page",
        "parentFolderPath": "/about",
        "siteName": "www",
        "contentTypePath": "/standard/content-type",
        "xhtml": "<p>Page content</p>"
      }
    }
  }
}
```

Publish an asset:

```json
{
  "tool": "cascade_publish_unpublish",
  "arguments": {
    "identifier": { "id": "abc123", "type": "page" },
    "publishInformation": { "unpublish": false }
  }
}
```

## Guardrails: Blocked Tool Calls

Use `cascade_tool_blocks` to list or add blocked Cascade tool-call rules. The rules live in a local JSON file at `~/.cascade-cms-mcp-server/tool-blocks.json`. If the file does not exist, the repository is treated as empty; deleting the file removes all stored blocks until new rules are added.

Each rule requires a non-empty `tools` array plus `url`, `id`, or `path`. `url` means an HTTPS Cascade CMS asset URL on a `.cascadecms.com` host at `/entity/open.act` with `id` and `type` query parameters; it does not match published site URLs or symlink/feed/destination target URLs. Explicit `id` or `path` selectors require `type`. URL selectors and explicit selectors can be combined in the same rule; URL selectors use the URL's own `type`, while explicit `id` and `path` selectors use the rule's top-level `type`. Each selector may be a string or an array of strings. `reason` is optional and appears in the blocked-call error.

Before a checked tool runs, the server reads this JSON repository and blocks the call if the tool name and payload match a rule. If the JSON file is malformed or cannot be read, checked tools fail closed before calling Cascade or mutating local draft state. Draft tools go through this checked-tool gate; tools that inspect or mutate an existing draft/source also check resolved payloads. `cascade_draft_mutation_plan_execute` checks hydrated/resolved step payloads under the plan tool name before delegating to each step. Local helper tools (`cascade_asset_*`), `cascade_read_response`, and `cascade_server_version` do not because they only inspect cached local data or server metadata.

Because `cascade_tool_blocks` can add guardrails, MCP clients should require user approval before calling it. It cannot remove or replace existing guardrails; delete or edit the local JSON file directly when intentional cleanup is required.

Use `cascade_protect_site_removal` to generate removal safeguards for accessible sites and their root folders. It lists sites, blocks `cascade_remove` for those site IDs and site names/paths, reads each root folder at `/`, blocks readable root folders by ID, and also blocks folder path `/` as a path-based root-folder fallback. Existing generated rules from this tool are replaced when it runs again; unrelated rules stay in place. The response reports unreadable root folders so you know which root IDs could not be added.

Example stored rules:

```json
[
  {
    "type": "site",
    "id": ["site-123", "site-456"],
    "path": ["Protected Site"],
    "tools": ["cascade_remove", "cascade_edit"],
    "reason": "No site edits or deletes"
  },
  {
    "url": [
      "https://college.cascadecms.com/entity/open.act?id=link-1&type=symlink",
      "https://college.cascadecms.com/entity/open.act?id=link-2&type=symlink"
    ],
    "tools": ["cascade_edit"]
  }
]
```

Example management calls:

```json
{
  "tool": "cascade_tool_blocks",
  "arguments": {
    "action": "add",
    "rule": {
      "url": "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
      "tools": ["cascade_remove", "cascade_edit"],
      "reason": "Protected block"
    }
  }
}
```

```json
{
  "tool": "cascade_tool_blocks",
  "arguments": { "action": "list" }
}
```

## Resources

| URI                            |   Kind   | Description                                               |
| ------------------------------ | :------: | --------------------------------------------------------- |
| `cascade://entity-types`       |  Static  | Cascade entity type strings with short descriptions       |
| `cascade://sites`              | Dynamic  | Live `listSites()` result                                 |
| `cascade://text-encoding`      |  Static  | Text, rich text, XML, format, and template encoding rules |
| `cascade://asset/{handle}/raw` | Template | Exact raw JSON cached from a prior `cascade_read` preview |
| `cascade://draft/{handle}/raw` | Template | Exact draft JSON unless blocked by draft read tool-block rules, the tool-block repository cannot be read, or the handle is invalid/missing |

## Troubleshooting

- If tools appear unavailable, verify the MCP client can start the server and that `CASCADE_API_KEY` and `CASCADE_URL` are set in the environment used by that client.
- If a cached handle is missing, rerun the originating tool. Handles are in-memory and process-scoped.
- If `cascade_draft_open` reports an `expected_raw_hash` mismatch, rerun `cascade_read` and use the current `raw_hash`.
- If `cascade_draft_submit` reports that the source asset changed, rerun `cascade_read` and open a fresh draft.
- If a draft patch or submit reports an `expected_revision` mismatch, inspect the draft and retry with the current revision.
- If a rendered response is truncated, call `cascade_read_response` with the returned handle, offset, and length.
- Most MCP clients write server stderr to client logs. This server keeps stdout reserved for MCP JSON-RPC.

## Security Notes

- API keys are loaded from environment variables only. Do not commit MCP config files that contain real credentials.
- `cascade_read` preview mode caches exact raw asset JSON in memory for follow-up inspection. Draft workflows clone and edit-normalize that read cache before mutation, with the same per-entry size cap as oversized response caching. Draft open and patch tools check blocked-call rules against resolved draft payloads before mutating local draft state. Raw draft resources also honor draft read tool-block rules and return an error body if the local tool-block repository cannot be read. `cascade_draft_submit` checks blocked-call rules against the final payload as both `cascade_draft_submit` and `cascade_create` or `cascade_edit`, and edit submits re-read the source asset before calling Cascade. Use `discard_on_success: true` to clear a submitted draft only when Cascade returns `success: true` and the submitted revision/hash is still current; if the draft changed while submit was in flight, the current draft is retained and `discard_skipped_reason` explains why. Restart the MCP server to clear cached asset and draft data.
- Error messages are redacted before being logged or returned.
- Input validation rejects unknown fields at the MCP boundary using Zod schemas that mirror the generated Cascade API request shapes.

## License

MIT - see [LICENSE](LICENSE).

## Related

- [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) - underlying JavaScript client library
- [dotseal](https://github.com/kuklaph/dotseal) - optional encrypted environment value helper
- [Model Context Protocol](https://modelcontextprotocol.io/) - protocol specification
- [Cascade CMS REST API](https://www.hannonhill.com/cascadecms/latest/developing-in-cascade/rest-api/index.html) - upstream API documentation
