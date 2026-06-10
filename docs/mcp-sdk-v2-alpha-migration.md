# MCP Server SDK v2 Alpha Migration

## Scope

This migration targets `@modelcontextprotocol/server@2.0.0-alpha.2`.

The server remains a stdio MCP server. It does not add HTTP, SSE, OAuth,
Express, Hono, `@modelcontextprotocol/node`, or direct
`@modelcontextprotocol/core` imports.

## Implementation Notes

- SDK imports use the `@modelcontextprotocol/server` root export. The alpha
  package does not expose the old v1 subpaths such as
  `@modelcontextprotocol/sdk/server/stdio.js`.
- `@cfworker/json-schema` is a direct runtime dependency. The alpha package
  marks it as an optional peer, but its emitted root module imports it at module
  load time.
- `registerCascadeTool` passes a Standard Schema wrapper to the SDK. The wrapper
  exposes the original exact Zod JSON Schema for `tools/list`, while SDK-side
  validation stays permissive so project validation returns Cascade-specific
  `validation_error` payloads.
- The previous production `tools/list` override and private `_registeredTools`
  schema conversion path were removed.
- `scripts/smoke-node.mjs` now verifies the compiled Node runtime with MCP
  initialize, `notifications/initialized`, `tools/list`, `resources/list`,
  `resources/templates/list`, and `resources/read`.
- The package now requires Node 20+, matching the alpha SDK's engine floor.

## Verification

Run these from the repository root:

```bash
bun test
bun run typecheck
bun run build
bun run smoke:node
```
