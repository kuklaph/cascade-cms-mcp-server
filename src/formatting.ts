/**
 * Response formatting for the Cascade CMS MCP server.
 *
 * Produces MCP-compliant `CallToolResult` objects with both:
 *   - `content`: JSON text plus extracted MCP content blocks. Multimodal
 *     tools may opt in to return only extracted content blocks.
 *   - `structuredContent`: the raw result object when it fits. Oversize
 *     results return bounded `_cache` metadata and must be read by handle.
 *
 * LLM agents should prefer `structuredContent`; JSON text is a compatibility
 * projection for clients that only expose the text content block.
 */

import type {
  CallToolResult,
  ResourceLink,
} from "@modelcontextprotocol/server";
import { CHARACTER_LIMIT, PREVIEW_LIMIT } from "./constants.js";
import type { ResponseCache } from "./cache.js";

/** Options for `formatResponse` — optional cache + private-field stripping. */
export interface FormatResponseOptions {
  cache?: ResponseCache;
  contentBlocksOnly?: boolean;
  stripFromStructured?: readonly string[];
}

/**
 * Format a tool result into an MCP `CallToolResult`.
 *
 * @param result       - Raw result from the Cascade API (any shape).
 * @param toolName     - Used for cache metadata.
 */
export function formatResponse(
  result: unknown,
  toolName: string,
  options?: FormatResponseOptions,
): CallToolResult {
  const structured = stripFields(toStructured(result), options?.stripFromStructured);
  const resourceLinks = extractResourceLinks(result);
  const contentBlocks = extractContentBlocks(result);
  if (options?.contentBlocksOnly && contentBlocks.length > 0) {
    return { content: contentBlocks };
  }

  const text = renderJson(structured);
  const content = buildContent(
    { type: "text", text },
    resourceLinks,
    contentBlocks,
  );

  if (text.length > CHARACTER_LIMIT) {
    const handle = options?.cache?.put(toolName, text);
    const envelope = buildOversizeEnvelope(text, handle);
    return {
      content: buildContent(
        { type: "text", text: renderJson(envelope) },
        resourceLinks,
        contentBlocks,
      ),
      structuredContent: boundedStructuredEnvelope(structured, envelope),
    };
  }

  return {
    content,
    structuredContent: structured,
  };
}

function boundedStructuredEnvelope(
  structured: Record<string, unknown>,
  envelope: ReturnType<typeof buildOversizeEnvelope>,
): Record<string, unknown> {
  return {
    ...(typeof structured.success === "boolean" ? { success: structured.success } : {}),
    truncated: true,
    _cache: envelope,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderJson(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

function toStructured(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) return {};
  if (typeof result !== "object") {
    return { value: result };
  }
  return result as Record<string, unknown>;
}

/**
 * Return a shallow copy of `structured` with `fields` removed. No-op
 * (identity) when `fields` is empty/undefined to avoid an unnecessary copy
 * on the common path. Used to strip handler-private channels from
 * structuredContent (see `FormatResponseOptions.stripFromStructured`).
 */
function stripFields(
  structured: Record<string, unknown>,
  fields: readonly string[] | undefined,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return structured;
  const out: Record<string, unknown> = { ...structured };
  for (const f of fields) delete out[f];
  return out;
}

function extractResourceLinks(result: unknown): ResourceLink[] {
  if (typeof result !== "object" || result === null) return [];
  const links = (result as { _resource_links?: unknown })._resource_links;
  if (!Array.isArray(links)) return [];
  return links.filter((link): link is ResourceLink => {
    if (typeof link !== "object" || link === null) return false;
    const rec = link as Record<string, unknown>;
    return (
      rec.type === "resource_link" &&
      typeof rec.uri === "string" &&
      typeof rec.name === "string"
    );
  });
}

function extractContentBlocks(result: unknown): CallToolResult["content"] {
  if (typeof result !== "object" || result === null) return [];
  const blocks = (result as { _content_blocks?: unknown })._content_blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((block): block is CallToolResult["content"][number] => {
    if (typeof block !== "object" || block === null) return false;
    const rec = block as Record<string, unknown>;
    return (
      rec.type === "image" &&
      typeof rec.data === "string" &&
      typeof rec.mimeType === "string"
    );
  });
}

function buildContent(
  textBlock: CallToolResult["content"][number],
  resourceLinks: ResourceLink[],
  contentBlocks: CallToolResult["content"],
): CallToolResult["content"] {
  return [textBlock, ...resourceLinks, ...contentBlocks];
}

function buildOversizeEnvelope(fullText: string, handle?: string) {
  const maxPreviewLength = Math.min(PREVIEW_LIMIT, fullText.length);
  let low = 0;
  let high = maxPreviewLength;
  let best = createOversizeEnvelope(fullText, handle, 0);

  while (low <= high) {
    const previewLength = Math.floor((low + high) / 2);
    const candidate = createOversizeEnvelope(fullText, handle, previewLength);
    if (renderJson(candidate).length <= CHARACTER_LIMIT) {
      best = candidate;
      low = previewLength + 1;
    } else {
      high = previewLength - 1;
    }
  }

  return best;
}

function createOversizeEnvelope(
  fullText: string,
  handle: string | undefined,
  previewLength: number,
) {
  return {
    truncated: true,
    preview: fullText.slice(0, previewLength),
    bytes_total: fullText.length,
    bytes_returned: previewLength,
    ...(handle ? { handle, tool: "cascade_read_response" as const } : {}),
    next_actions: handle
      ? [
          {
            tool: "cascade_read_response",
            reason: "Retrieve additional bytes from this cached JSON response.",
            input: { handle, offset: previewLength },
          },
        ]
      : [],
  };
}
