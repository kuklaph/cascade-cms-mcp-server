/**
 * Shared constants for the Cascade CMS MCP server.
 */

export const CHARACTER_LIMIT = 25000;
export const SERVER_NAME = "cascade-cms-mcp-server";
export const SERVER_VERSION = "1.1.0";
export const DEFAULT_TIMEOUT_MS = 30000;

/** Max chars rendered into `content[0].text` when minting a cache handle. */
export const PREVIEW_LIMIT = 20_000;

/** Max cached oversized rendered tool responses retained for cascade_read_response. */
export const OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES = 50;

/** Max chars of rendered text stored per cache entry. Oversize entries are replaced with a marker. */
export const CACHE_MAX_BYTES_PER_ENTRY = 2_000_000;

/** Max cached asset indexes retained for cascade_read follow-up tools. */
export const ASSET_READ_CACHE_MAX_ENTRIES = 50;
