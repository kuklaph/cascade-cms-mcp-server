# Changelog

All notable changes to `cascade-cms-mcp-server` will be documented here.

## Unreleased

### Added

- Added `cascade_draft_*` tools for draft-based create/edit workflows: open, inspect, patch, validate, and submit complete asset payloads without mutating the original read cache.
- Added `cascade_draft_scaffold_create` to start create drafts from bare required scaffolds for every Cascade asset envelope.
- Added semantic structured-data helpers for cached assets and drafts: resolve nodes, assert values, and apply semantic draft patches that compile to existing JSON Pointer patch operations.
- Added `cascade_draft_scaffold_from_asset` to create create-safe drafts from an existing cached asset shape by stripping read-only fields/recycled flags and clearing structured-data text and asset-reference values.
- Added `cascade_draft_mutation_plan_execute` for local sequential draft orchestration with stop-on-first-failure behavior and plan-level resolved-payload tool-block checks.
- Added `cascade://draft/{handle}/raw` for exact draft JSON retrieval guarded by draft read tool-block rules.

### Changed

- Tightened draft patch/submit revision checks and `editorConfiguration` site validation to match Cascade API type requirements.

### Fixed

- Prevented concurrent `cascade_draft_submit` calls for the same draft from submitting the same revision twice.
- Serialized `cascade_tool_blocks` and `cascade_protect_site_removal` repository updates so concurrent guardrail changes do not overwrite each other.
- Redacted unreadable root-folder errors returned by `cascade_protect_site_removal`.
- Cleared credential fields when scaffolding create drafts from existing assets.
- Returned live draft-cache state in mutation-plan `current_drafts` summaries after submit or in-flight draft changes.
- Aligned `cascade_draft_list_nodelets` with the cached asset nodelet response shape.

## 1.1.2 - 2026-05-12

### Changed

- Updated `@modelcontextprotocol/sdk` to `^1.29.0`.
- Updated `zod` to `^4.4.3`.
- Updated `cascade-cms-api` to `^2.0.2` and aligned MCP validation with its generated TypeScript declarations.
- Adapted validation error handling for Zod 4 issue shapes while preserving the existing `valid_values` response field.
- Tightened MCP input validation to mirror generated Cascade API request shapes instead of accepting loosely typed nested payloads.
- Modeled `workflowConfiguration` as an optional companion property beside one concrete asset envelope, matching Cascade's `Asset` shape.
- Added dependency overrides for vulnerable transitive SDK dependencies used by both Bun and npm installs.

### Fixed

- Preserved MCP client schema-description coverage with Zod 4-safe assertions.
- Corrected README wording for workflow settings, which apply to folders rather than arbitrary assets or sites.
- Added missing `facebookConnector` asset envelope validation coverage and removed stale `target` asset assumptions.
