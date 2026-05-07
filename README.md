# cascade-cms-mcp-server

An MCP (Model Context Protocol) server that exposes the Cascade CMS REST API to LLMs and agents. It wraps the [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) library with Zod validation, markdown/JSON response formatting, and actionable error messages.

Built in TypeScript on [Bun](https://bun.sh). The published server provides 34 MCP tools and 4 resources/templates for Cascade CMS asset reads/writes, search, sites, access rights, workflow, messages, check in/out, audits/preferences, publish, and cached response retrieval.

## Requirements

- Node 18+.
- Bun 1.0+ for the preferred `bunx` setup.
- A Cascade CMS instance with REST API access and an API key.
- An MCP client that can launch stdio servers, such as Claude, Codex, Cline, MCP Inspector, or another compliant client.

## Quick Start

Most MCP clients need the same four values: command, args, `CASCADE_API_KEY`, and `CASCADE_URL`. Add them wherever your client manages MCP servers. `bunx` is the preferred runner; use `npx` if Bun is not installed.

The example credentials below are placeholders. For real credentials, use your MCP client's secret or environment management when available, or dotseal-encrypted values. Do not commit MCP config files that contain API keys.

### MCP Client Config

Use one of these shapes for JSON-based MCP configs. Prefer the Bun example when available.

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

Restart the client after changing its MCP config.

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

Values may also be [dotseal](https://github.com/kuklaph/dotseal) ciphertexts with the `enc:<iv>:<authTag>:<ciphertext>` format. Encrypted `enc:` values are decrypted by this server's dotseal runtime dependency; plaintext values pass through without loading it.

To generate encrypted values, install or run the dotseal CLI separately:

```bash
bun install -g dotseal
# or, without Bun:
npm install -g dotseal
```

Then generate the encrypted value and paste the `enc:...` output into your MCP config or shell environment.

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
| Fetch additional bytes from large/truncated responses                                                   | Yes       |

Every tool accepts optional `response_format: "markdown" | "json"`; markdown is the default. `cascade_read` returns a compact preview by default plus an `asset_handle` for follow-up inspection. Follow-up tools inspect the cached asset and do not call Cascade again. Handles are process-scoped and may be evicted after later `cascade_read` calls.

Use your MCP client's tool list or inspector for exact request schemas.

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
        "contentTypePath": "/standard/content-type"
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

## Resources

| URI                            |   Kind   | Description                                               |
| ------------------------------ | :------: | --------------------------------------------------------- |
| `cascade://entity-types`       |  Static  | Cascade entity type strings with short descriptions       |
| `cascade://sites`              | Dynamic  | Live `listSites()` result                                 |
| `cascade://text-encoding`      |  Static  | Text, rich text, XML, format, and template encoding rules |
| `cascade://asset/{handle}/raw` | Template | Exact raw JSON cached from a prior `cascade_read` preview |

## Troubleshooting

- If tools appear unavailable, verify the MCP client can start the server and that `CASCADE_API_KEY` and `CASCADE_URL` are set in the environment used by that client.
- If a cached handle is missing, rerun the originating tool. Handles are in-memory and process-scoped.
- If a rendered response is truncated, call `cascade_read_response` with the returned handle, offset, and length.
- Most MCP clients write server stderr to client logs. This server keeps stdout reserved for MCP JSON-RPC.

## Security Notes

- API keys are loaded from environment variables only.
- `cascade_read` preview mode caches exact raw asset JSON in memory for follow-up inspection. Restart the MCP server to clear cached asset data.
- Error messages are redacted before being logged or returned.
- Input validation rejects unknown fields at the MCP boundary except for bounded passthrough cases.

## License

MIT - see [LICENSE](LICENSE).

## Related

- [cascade-cms-api](https://github.com/kuklaph/cascade-cms-api) - underlying JavaScript client library
- [Model Context Protocol](https://modelcontextprotocol.io/) - protocol specification
- [Cascade CMS REST API](https://www.hannonhill.com/cascadecms/latest/developing-in-cascade/rest-api/index.html) - upstream API documentation
