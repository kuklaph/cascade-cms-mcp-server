/**
 * Retrieval tool: reads slices from the in-memory response cache.
 *
 * Mints no new responses; only reads what other tools have stored after
 * their reply text exceeded CHARACTER_LIMIT. Handles are ephemeral and
 * live only as long as the cache retains them.
 *
 * The handler returns the slice text under `slice_text` alongside metadata.
 * The remaining fields (`handle`,
 * `bytes_total`, `offset`, `bytes_returned`, `has_more`, `next_offset?`)
 * surface in `structuredContent` as machine-readable slice metadata.
 */

import type { McpServer } from "@modelcontextprotocol/server";
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
    slice_text: "<requested response slice>",
    has_more: <bool>,
    next_offset: <offset to use next, if has_more>
  }
  The same JSON object is returned in content[0].text and structuredContent; slice_text contains the response slice.

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
        return buildSliceResponse(entry.fullText, handle, safeOffset, safeLength);
      },
    },
    deps,
  );
}

function buildSliceResponse(
  fullText: string,
  handle: string,
  offset: number,
  maxLength: number,
): Record<string, unknown> {
  const bytes_total = fullText.length;
  const remaining = Math.max(0, bytes_total - offset);
  let low = 0;
  let high = Math.min(maxLength, remaining);
  let best = sliceResponse(fullText, handle, offset, 0, maxLength);

  while (low <= high) {
    const sliceLength = Math.floor((low + high) / 2);
    const candidate = sliceResponse(fullText, handle, offset, sliceLength, maxLength);
    if (JSON.stringify(candidate, null, 2).length <= CHARACTER_LIMIT) {
      best = candidate;
      low = sliceLength + 1;
    } else {
      high = sliceLength - 1;
    }
  }

  return best;
}

function sliceResponse(
  fullText: string,
  handle: string,
  offset: number,
  sliceLength: number,
  requestedLength: number,
): Record<string, unknown> {
  const bytes_total = fullText.length;
  const slice = fullText.slice(offset, offset + sliceLength);
  const bytes_returned = slice.length;
  const nextOffset = offset + bytes_returned;
  const has_more = nextOffset < bytes_total;

  return {
    success: true,
    handle,
    bytes_total,
    offset,
    bytes_returned,
    has_more,
    ...(has_more ? { next_offset: nextOffset } : {}),
    slice_text: slice,
    next_actions: has_more
      ? [
          {
            tool: "cascade_read_response",
            reason: "Retrieve the next cached response slice.",
            input: {
              handle,
              offset: nextOffset,
              length: requestedLength,
            },
          },
        ]
      : [],
  };
}
