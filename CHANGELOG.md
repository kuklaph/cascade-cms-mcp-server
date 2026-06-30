# Changelog

All notable changes to `cascade-cms-mcp-server` will be documented here.

## Unreleased

## 2.0.1 - 2026-06-30

### Changed

- Tool-block `create` rules now match create payloads by intended parent path plus asset name, letting matching local draft workflows fail before local draft work continues.
- Local draft initiation and scaffold workflows now check final or generated tool-block payloads before creating or committing local draft state when the target is known.
- Generated site/root-folder protection rules now block both `remove` and `move`.

## 2.0.0 - 2026-06-22

### Breaking Changes

- Migrated the MCP server runtime from `@modelcontextprotocol/sdk` v1 to `@modelcontextprotocol/server@2.0.0-alpha.2`.
- Raised the supported Node.js runtime to Node 20 or newer.
- Removed the redundant `cascade_` prefix from public MCP tool names.
- Renamed MCP-local draft tools from `cascade_draft_*` to `local_draft_*` to distinguish local payload drafts from Cascade browser draft state.
- Renamed cached reference response `source_scope` from `cascade_references` to `asset_references`.

### Changed

- Browser-backed requests now start at most once every 3 seconds per MCP session to reduce pressure on Cascade browser UI endpoints.
- Added `@cfworker/json-schema` as a direct runtime dependency required by `@modelcontextprotocol/server`.
- Clarified `search` guidance for pass-through Cascade search syntax, quoted phrase searches, wildcard searches, and optional `searchFields` / `searchTypes` narrowing filters.

## 2.0.0-alpha.0 - 2026-06-11

### Breaking Changes

- Migrated the MCP server runtime from `@modelcontextprotocol/sdk` v1 to `@modelcontextprotocol/server@2.0.0-alpha.2`.
- Raised the supported Node.js runtime to Node 20 or newer.

### Changed

- Browser-backed requests now start at most once every 3 seconds per MCP session to reduce pressure on Cascade browser UI endpoints.
- Added `@cfworker/json-schema` as a direct runtime dependency required by the MCP server v2 alpha package.
- Clarified `cascade_search` guidance for pass-through Cascade search syntax, quoted phrase searches, wildcard searches, and optional `searchFields` / `searchTypes` narrowing filters.

## 1.1.3 - 2026-06-10

### Added

- Added `CHANGELOG.md` to the npm package files.
- Added browser-backed tools for Cascade browser UI login, active draft notification checks, and snippet administration.
- Added `cascade_draft_set_file_data` to set draft `file.data` from exactly one local path or base64 payload, preserving real `text` values and removing only null scaffold placeholders.
- Added `cascade_draft_*` tools for draft-based create/edit workflows: open, inspect, patch, validate, and submit complete asset payloads without mutating the original read cache.
- Added `cascade_draft_scaffold_create` to start create drafts from bare required scaffolds for every Cascade asset envelope.
- Added semantic structured-data helpers for cached assets and drafts: resolve nodes, assert values, and apply semantic draft patches that compile to existing JSON Pointer patch operations.
- Added `cascade_draft_scaffold_from_asset` to create create-safe drafts from an existing cached asset shape by stripping read-only fields/recycled flags and clearing structured-data text and asset-reference values.
- Added `cascade_draft_mutation_plan_execute` for local sequential draft orchestration with stop-on-first-failure behavior and plan-level resolved-payload tool-block checks.
- Added `cascade://draft/{handle}/raw` for exact draft JSON retrieval guarded by draft read tool-block rules.
- Added `cascade_file_data_*` helpers for Cascade file binary data: inspect metadata, read bounded byte ranges, return magic-byte verified images as MCP image content, and export exact bytes to an explicit local path.

### Changed

- Updated `cascade-cms-api` to `^2.0.2` and aligned MCP validation with its generated TypeScript declarations.
- Tightened MCP input validation to mirror generated Cascade API request shapes instead of accepting loosely typed nested payloads.
- Modeled `workflowConfiguration` as an optional companion property beside one concrete asset envelope, matching Cascade's `Asset` shape.
- Browser-backed tools now cache the browser session in memory, auto-login when full browser config is present, and support `CASCADE_BROWSER_SITE_ID` for startup/default site activation.
- `cascade_create`, `cascade_edit`, and `cascade_draft_submit` now normalize `file.data` byte arrays to Cascade signed Java bytes.
- Draft file-data bytes are kept outside the draft JSON cache until submit so large uploads do not trip the draft JSON size guard.
- Clarified README setup guidance for browser API environment values, production site ID lookup, and agent-facing tool references.
- Clarified cached asset and draft helper descriptions so agents choose search, list, and scalar-artifact tools correctly.
- `cascade_file_data_image` now returns image-only MCP content with no JSON text or structured metadata; use `cascade_file_data_info` separately for file metadata.
- Tightened draft patch/submit revision checks and `editorConfiguration` site validation to match Cascade API type requirements.
- `cascade_read` preview now summarizes Cascade `file.data` byte arrays instead of indexing every byte, preserving exact raw JSON while keeping binary file previews bounded.
- File-data export is marked as a destructive local filesystem write, rejects single binary payloads over 100 MiB, and the read cache evicts older binary entries after 250 MiB of cached binary data.

### Fixed

- Preserved browser endpoint `success: false` mutation responses and surfaced non-auth browser HTTP failures without clearing valid sessions.
- Prevented concurrent `cascade_draft_submit` calls for the same draft from submitting the same revision twice.
- Serialized `cascade_tool_blocks` and `cascade_protect_site_removal` repository updates so concurrent guardrail changes do not overwrite each other.
- Redacted unreadable root-folder errors returned by `cascade_protect_site_removal`.
- Cleared credential fields when scaffolding create drafts from existing assets.
- Returned live draft-cache state in mutation-plan `current_drafts` summaries after submit or in-flight draft changes.
- Aligned `cascade_draft_list_nodelets` with the cached asset nodelet response shape.
- Added missing `facebookConnector` asset envelope validation coverage and removed stale `target` asset assumptions.

## 1.1.2 - 2026-05-12

### Added

- Added local tool-block guardrails for preventing matching Cascade tool calls before execution.
- Added a server version tool for MCP reachability and version checks.

### Changed

- Updated `@modelcontextprotocol/sdk` to `^1.29.0`.
- Updated `zod` to `^4.4.3`.
- Adapted validation error handling for Zod 4 issue shapes while preserving the existing `valid_values` response field.
- Tightened MCP response contracts, structured content, oversized-response handling, and cached follow-up tool guidance.
- Reorganized README setup, tool permission, encrypted environment value, and workflow documentation.
- Added dependency overrides for vulnerable transitive SDK dependencies used by both Bun and npm installs.

### Fixed

- Preserved MCP client schema-description coverage with Zod 4-safe assertions.
- Blocked direct site and root-folder removal through `cascade_remove`.
- Clarified access-rights group ID wording.
