/**
 * Shared constants for the Cascade CMS MCP server.
 */

export const CHARACTER_LIMIT = 25000;
export const SERVER_NAME = "cascade-cms-mcp-server";
export const SERVER_VERSION = "2.0.0";
export const DEFAULT_TIMEOUT_MS = 30000;

/** Max chars rendered into `content[0].text` when minting a cache handle. */
export const PREVIEW_LIMIT = 20_000;

/** Max cached oversized rendered tool responses retained for read_response. */
export const OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES = 50;

/** Max chars of rendered text stored per cache entry. Oversize entries are replaced with a marker. */
export const CACHE_MAX_BYTES_PER_ENTRY = 2_000_000;

/** Max cached asset indexes retained for read follow-up tools. */
export const ASSET_READ_CACHE_MAX_ENTRIES = 50;

/** Max binary bytes allowed for one cached/exported Cascade file.data field. */
export const FILE_DATA_MAX_BYTES = 100 * 1024 * 1024;

/** Max combined binary file.data bytes retained by the asset read cache. */
export const ASSET_READ_CACHE_MAX_BINARY_BYTES = 250 * 1024 * 1024;

/** Max cached mutable asset drafts retained for draft create/edit workflows. */
export const ASSET_DRAFT_CACHE_MAX_ENTRIES = 50;

/** Max serialized JSON chars retained per mutable asset draft. */
export const ASSET_DRAFT_MAX_BYTES = CACHE_MAX_BYTES_PER_ENTRY;

/** Max JSON Pointer patch operations allowed in one draft patch request. */
export const ASSET_DRAFT_PATCH_MAX_OPERATIONS = 100;
