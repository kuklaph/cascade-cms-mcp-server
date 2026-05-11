/**
 * Retrieval tool: reads slices from the in-memory response cache.
 *
 * Mints no new responses; only reads what other tools have stored after
 * their reply text exceeded CHARACTER_LIMIT. Handles are ephemeral and
 * live only as long as the cache retains them.
 *
 * The handler returns the slice text under `_slice_text` so a custom
 * `renderMarkdown` can pass it through unchanged (avoiding the default
 * JSON-code-fence rendering). `_slice_text` is then stripped from
 * `structuredContent` via `stripFromStructured` so the slice doesn't
 * duplicate alongside the metadata. The remaining fields (`handle`,
 * `bytes_total`, `offset`, `bytes_returned`, `has_more`, `next_offset?`)
 * surface in `structuredContent` as machine-readable slice metadata.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import { ReadResponseRequestSchema } from "../schemas/requests.js";
import {
  CHARACTER_LIMIT,
  OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES,
} from "../constants.js";

export function registerReadResponseTool(
  server: McpServer,
  deps: CascadeDeps,
): void {
  registerCascadeTool(
    server,
    {
      name: "cascade_read_response",
      title: "Read cached MCP response slice",
      description: buildCascadeToolDescription(
        `Retrieve a slice of a cached MCP response by handle (cascade_read_response).

When a Cascade tool response exceeds the MCP character budget, the server caches the complete payload and returns a handle in structuredContent._cache.handle plus a preview in the text block. Use cascade_read_response to fetch the rest — either the remainder in chunks, or a targeted byte range if you know the structure.

Args:
  - handle (string, required): The handle returned by a prior tool call's structuredContent._cache.handle (e.g. "h_550e8400-...").
  - offset (number, optional, default 0): Byte offset within the full rendered response. Use the originating call's bytes_returned as the next offset, or structuredContent._cache.next_offset when iterating.
  - length (number, optional, default ${CHARACTER_LIMIT}): Max characters to return in this slice. Capped at ${CHARACTER_LIMIT}.

Returns:
  {
    success: true,
    handle: "<original handle>",
    bytes_total: <full response length>,
    offset: <requested offset>,
    bytes_returned: <length of returned slice>,
    has_more: <bool>,
    next_offset: <offset to use next, if has_more>
  }
  The slice text itself is in content[0].text (raw, not JSON-fenced).

Examples:
  - Continue reading: { handle: "h_abc...", offset: 20000 }
  - Specific byte range: { handle: "h_abc...", offset: 50000, length: 10000 }
  - Don't use when: The originating response fit under the limit (no handle was minted).
  - Don't use when: The handle is older than ${OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES} oversize responses back (LRU-evicted); re-run the originating tool.

Error Handling:
  - "Handle not found" — the handle was evicted (cache holds the last ${OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES} oversize responses) or never existed. Re-run the originating tool.`,
      ),
      inputSchema: ReadResponseRequestSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const { handle, offset, length } = input as unknown as {
          handle: string;
          offset: number;
          length: number;
        };
        const entry = deps.cache.get(handle);
        if (!entry) {
          // Throw a translatable error — registerCascadeTool will run
          // translateError on it, surfacing the message to the caller.
          throw new Error(
            `Handle ${handle} not found. The cache holds the last ${OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES} oversize responses; this handle was either never minted, was already evicted, or expired. Re-run the originating tool to mint a new handle.`,
          );
        }
        const bytes_total = entry.fullText.length;
        const safeOffset = Math.min(
          Math.max(0, Math.floor(offset)),
          bytes_total,
        );
        const safeLength = Math.max(
          1,
          Math.min(CHARACTER_LIMIT, Math.floor(length)),
        );
        const slice = entry.fullText.slice(safeOffset, safeOffset + safeLength);
        const bytes_returned = slice.length;
        const has_more = safeOffset + bytes_returned < bytes_total;
        return {
          success: true,
          handle,
          bytes_total,
          offset: safeOffset,
          bytes_returned,
          has_more,
          ...(has_more ? { next_offset: safeOffset + bytes_returned } : {}),
          // Private channel from handler to renderMarkdown. Surfaces in
          // structuredContent too, which is fine — agents reading structured
          // data see the slice inline alongside the metadata.
          _slice_text: slice,
        };
      },
      // Override renderMarkdown so the slice text isn't JSON-fenced.
      renderMarkdown: (result) => {
        const r = result as { _slice_text?: string };
        return r._slice_text ?? "";
      },
      // Strip the private `_slice_text` channel from structuredContent so
      // the slice doesn't duplicate alongside the metadata. The slice is
      // already in `content[0].text`.
      stripFromStructured: ["_slice_text"],
    },
    deps,
  );
}
