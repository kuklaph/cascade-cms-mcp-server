# Changelog

All notable changes to `cascade-cms-mcp-server` will be documented here.

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
