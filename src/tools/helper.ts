/**
 * Shared registration helper for all Cascade MCP tools.
 *
 * Every tool in this server goes through `registerCascadeTool` so the
 * validate → handle → format → error-translate pipeline lives in ONE place.
 * When the MCP SDK or Cascade library contracts change, only this file
 * needs editing — not every individual tool registration.
 */

import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import {
  formatResponse,
  type MarkdownRenderer,
  type ResponseFormat,
} from "../formatting.js";
import { translateError } from "../errors.js";
import { logToolInvocation } from "../audit.js";
import type { ResponseCache } from "../cache.js";
import type { AssetCache } from "../assetIndex.js";
import {
  describeToolBlockRule,
  findDeniedToolCall,
  shouldCheckToolBlocks,
  type ToolBlockStore,
} from "../toolBlocks.js";

/**
 * Shared dependencies threaded through tool registration so tools can
 * opt in to infrastructure (e.g., the response cache for oversize
 * payloads). Optional at every call site so existing tests that don't
 * supply deps keep working.
 */
export interface CascadeDeps {
  cache: ResponseCache;
  assetCache?: AssetCache;
  toolBlockStore?: ToolBlockStore;
}

/**
 * Configuration for a single Cascade MCP tool.
 *
 * @typeParam TSchema - The full Zod object schema for this tool's inputs.
 */
export interface CascadeToolConfig<TSchema extends z.ZodObject<any>> {
  /** Tool name (snake_case, "cascade_" prefix). */
  name: string;
  /** Short human-facing title. */
  title: string;
  /** LLM-facing description. Use `buildCascadeToolDescription` for consistency. */
  description: string;
  /** Full Zod object schema; the helper extracts `.shape` before passing to the SDK. */
  inputSchema: TSchema;
  /** MCP tool annotations (readOnlyHint, destructiveHint, etc.). */
  annotations: ToolAnnotations;
  /**
   * The Cascade operation to run. Receives validated input minus `response_format`.
   * May throw; errors are translated via `translateError`.
   */
  handler: (input: Omit<z.infer<TSchema>, "response_format">) => Promise<unknown>;
  /** Optional per-tool markdown override (ignored in json mode). */
  renderMarkdown?: MarkdownRenderer;
  /**
   * Optional list of fields to remove from `structuredContent` before
   * sending. Used by tools that pass private channels through the result
   * (e.g. `cascade_read_response` returns the slice via `_slice_text` for
   * its custom renderer; this strips it from `structuredContent`).
   */
  stripFromStructured?: readonly string[];
}

/**
 * Register a Cascade MCP tool on the given server.
 *
 * Wraps the tool handler in a pipeline that:
 *   1. Extracts `response_format` from the validated input (defaults "markdown").
 *   2. Passes the rest of the input to the handler.
 *   3. Formats the result via `formatResponse`.
 *   4. Translates any thrown error via `translateError`.
 */
export function registerCascadeTool<TSchema extends z.ZodObject<any>>(
  server: McpServer,
  config: CascadeToolConfig<TSchema>,
  deps?: CascadeDeps,
): void {
  const {
    name,
    title,
    description,
    inputSchema,
    annotations,
    handler,
    renderMarkdown,
    stripFromStructured,
  } = config;

  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: inputSchema.shape as any,
      annotations,
    },
    // Wrapped handler: the MCP SDK provides already-validated input here.
    (async (input: Record<string, unknown>): Promise<CallToolResult> => {
      const start = Date.now();
      try {
        const format: ResponseFormat =
          (input?.response_format as ResponseFormat | undefined) ?? "markdown";

        // Strip response_format before delegating to the Cascade operation.
        const { response_format: _rf, ...rest } = input ?? {};

        if (deps?.toolBlockStore && shouldCheckToolBlocks(name)) {
          const denied = findDeniedToolCall(
            name,
            rest,
            await deps.toolBlockStore.read(),
          );
          if (denied) {
            const reason = denied.reason ? ` ${denied.reason}` : "";
            throw new Error(
              `Tool call denied by tool block repository for ${name} ${describeToolBlockRule(denied)}.${reason}`,
            );
          }
        }

        const result = await handler(rest as Omit<z.infer<TSchema>, "response_format">);

        const formatted = formatResponse(result, format, name, renderMarkdown, {
          cache: deps?.cache,
          stripFromStructured,
        });
        logToolInvocation(name, "ok", Date.now() - start);
        return formatted;
      } catch (err) {
        const translated = translateError(err, name);
        const errMsg = err instanceof Error ? err.message : String(err);
        logToolInvocation(name, "error", Date.now() - start, errMsg);
        return translated;
      }
    }) as any,
  );
}

/**
 * Compose a consistent tool description. Keeps the footer prose identical
 * across all tools so agents see uniform guidance on response formats.
 */
export function buildCascadeToolDescription(base: string): string {
  const footer =
    "Supports response_format: markdown (default, human-readable) or json (machine-readable structured result).";
  const trimmed = base.trim();
  const separator = trimmed.endsWith(".") ? " " : ". ";
  return `${trimmed}${separator}${footer}`;
}
