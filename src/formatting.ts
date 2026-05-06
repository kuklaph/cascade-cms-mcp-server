/**
 * Response formatting for the Cascade CMS MCP server.
 *
 * Produces MCP-compliant `CallToolResult` objects with both:
 *   - `content`: text (markdown or JSON). When over CHARACTER_LIMIT and
 *     a response cache is supplied, returns a bounded preview + a handle
 *     usable with the `cascade_read_response` tool. When no cache is
 *     supplied, falls back to a legacy truncation marker (back-compat).
 *   - `structuredContent`: the raw result object (NEVER truncated). On
 *     oversize a sibling `_cache` envelope is added with handle metadata.
 *
 * LLM agents get readable text by default (markdown), can request
 * full JSON via `response_format: "json"`, or can programmatically
 * consume `structuredContent` when they need complete data. Oversize
 * responses are recoverable via `cascade_read_response({handle, offset,
 * length})` rather than being silently lost.
 */

import type {
  CallToolResult,
  ResourceLink,
} from "@modelcontextprotocol/sdk/types.js";
import { CHARACTER_LIMIT, PREVIEW_LIMIT } from "./constants.js";
import type { ResponseCache } from "./cache.js";

export type ResponseFormat = "markdown" | "json";

/** Optional custom markdown renderer for a tool. */
export type MarkdownRenderer = (result: unknown) => string;

/** Options for `formatResponse` — optional cache + private-field stripping. */
export interface FormatResponseOptions {
  cache?: ResponseCache;
  /**
   * Field names to remove from `structuredContent` before sending. Useful
   * for private channels from a custom `renderMarkdown` to the text block —
   * e.g. `cascade_read_response` returns the slice via `_slice_text` so its
   * renderer can pass it through raw, then strips it here so it doesn't
   * duplicate into the structured payload.
   */
  stripFromStructured?: readonly string[];
}

/**
 * Format a tool result into an MCP `CallToolResult`.
 *
 * @param result       - Raw result from the Cascade API (any shape).
 * @param format       - "markdown" (human-friendly) or "json" (raw).
 * @param toolName     - Used in default markdown rendering and context.
 * @param renderMarkdown - Optional per-tool markdown override (ignored in json mode).
 */
export function formatResponse(
  result: unknown,
  format: ResponseFormat,
  toolName: string,
  renderMarkdown?: MarkdownRenderer,
  options?: FormatResponseOptions,
): CallToolResult {
  // Build the text block.
  let text: string;
  if (format === "json") {
    text = renderJson(result);
  } else {
    text = renderMarkdown
      ? renderMarkdown(result)
      : defaultMarkdown(result, toolName);
  }

  // Ensure non-empty text so agents always see something.
  if (text.length === 0) {
    text = "(empty response)";
  }

  const structured = stripFields(toStructured(result), options?.stripFromStructured);
  const resourceLinks = extractResourceLinks(result);

  // Oversize branch with cache: mint handle, return bounded preview + envelope.
  if (text.length > CHARACTER_LIMIT && options?.cache) {
    const handle = options.cache.put(toolName, format, text);
    const preview = buildOversizePreview(text, handle);
    const envelope = {
      handle,
      bytes_total: text.length,
      bytes_returned: PREVIEW_LIMIT,
      tool: "cascade_read_response" as const,
    };
    return {
      content: [{ type: "text", text: preview }, ...resourceLinks],
      structuredContent: { ...structured, _cache: envelope },
    };
  }

  // Back-compat: truncate with legacy marker, structuredContent untouched.
  text = truncate(text);

  return {
    content: [{ type: "text", text }, ...resourceLinks],
    structuredContent: structured,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderJson(result: unknown): string {
  if (result === undefined) return "undefined";
  if (result === null) return "null";
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

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const omitted = text.length - CHARACTER_LIMIT;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[truncated — ${omitted} chars omitted. structuredContent retains the full payload]`
  );
}

/**
 * Build a bounded preview + marker tail advertising the cache handle.
 * Shape of the marker is stable and used by downstream tooling/agents.
 */
function buildOversizePreview(fullText: string, handle: string): string {
  const preview = fullText.slice(0, PREVIEW_LIMIT);
  const marker =
    `\n\n---\n[Preview truncated at ${PREVIEW_LIMIT} of ${fullText.length} chars. ` +
    `Full response retained as handle ${handle}. ` +
    `To retrieve more: call cascade_read_response({handle, offset, length}). ` +
    `Slice with offset:${PREVIEW_LIMIT} to continue. ` +
    `See structuredContent._cache for machine-readable metadata.]`;
  return preview + marker;
}

/**
 * Default markdown renderer — handles the common Cascade response shapes
 * without needing per-tool overrides.
 */
function defaultMarkdown(result: unknown, toolName: string): string {
  if (result === null || result === undefined) {
    return "(empty response)";
  }

  if (typeof result !== "object") {
    return codeFence(String(result));
  }

  const obj = result as Record<string, unknown>;

  // Search-style: { success: true, matches: [...] } → table.
  if (obj.success === true && Array.isArray(obj.matches)) {
    return renderMatchesTable(obj.matches, toolName);
  }

  // Success OperationResult: bullet list of keys.
  if (obj.success === true) {
    return renderOperationResult(obj, toolName);
  }

  // Fallback: JSON in a code fence.
  return codeFence(JSON.stringify(obj, null, 2));
}

function renderOperationResult(
  obj: Record<string, unknown>,
  toolName: string,
): string {
  const lines: string[] = [`## ${toolName} succeeded`];
  for (const [key, value] of Object.entries(obj)) {
    if (key === "success") continue;
    lines.push(`- **${key}**: ${shortValue(value)}`);
  }
  return lines.join("\n");
}

function renderMatchesTable(matches: unknown[], toolName: string): string {
  const header = `## ${toolName} results (${matches.length} match${matches.length === 1 ? "" : "es"})`;
  const tableHeader = "| type | id | path |";
  const tableSep = "| --- | --- | --- |";
  const rows = matches.map((m) => {
    const rec = (m ?? {}) as Record<string, unknown>;
    const pathObj = rec.path as { path?: unknown } | undefined;
    return `| ${shortValue(rec.type)} | ${shortValue(rec.id)} | ${shortValue(pathObj?.path)} |`;
  });
  return [header, "", tableHeader, tableSep, ...rows].join("\n");
}

function shortValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function codeFence(content: string): string {
  return "```json\n" + content + "\n```";
}
