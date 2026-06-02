/**
 * Shared registration helper for all Cascade MCP tools.
 *
 * Every tool in this server goes through `registerCascadeTool` so the
 * validate → checked-tool gate → handle → format → error-translate pipeline lives
 * in ONE place.
 * When the MCP SDK or Cascade library contracts change, only this file
 * needs editing — not every individual tool registration.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { formatResponse } from "../formatting.js";
import { redactSecrets, translateError } from "../errors.js";
import { logToolInvocation } from "../audit.js";
import type { ResponseCache } from "../cache.js";
import type { AssetCache } from "../assetIndex.js";
import type { DraftCache } from "../assetDrafts.js";
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
  draftCache?: DraftCache;
  toolBlockStore?: ToolBlockStore;
}

/**
 * Configuration for a single Cascade MCP tool.
 *
 * @typeParam TSchema - The full Zod object schema for this tool's inputs.
 */
export interface CascadeToolConfig<TSchema extends z.ZodTypeAny> {
  /** Tool name (snake_case, "cascade_" prefix). */
  name: string;
  /** Short human-facing title. */
  title: string;
  /** LLM-facing description. Use `buildCascadeToolDescription` for consistency. */
  description: string;
  /** Full Zod schema; the helper extracts the object shape before passing to the SDK. */
  inputSchema: TSchema;
  /** MCP tool annotations (readOnlyHint, destructiveHint, etc.). */
  annotations: ToolAnnotations;
  /**
   * The Cascade operation to run. Receives fully parsed input. May throw;
   * errors are translated via `translateError`.
   */
  handler: (input: z.infer<TSchema>) => Promise<unknown>;
  /**
   * Optional list of fields to remove from `structuredContent` before
   * sending. Used by tools that pass private channels through the result
   * sending.
   */
  stripFromStructured?: readonly string[];
}

type RegisteredToolLike = {
  title?: string;
  description?: string;
  inputSchema?: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  annotations?: ToolAnnotations;
  execution?: unknown;
  _meta?: Record<string, unknown>;
  enabled: boolean;
};

const exactInputSchemas = new WeakMap<McpServer, Map<string, z.ZodTypeAny>>();

/**
 * Register a Cascade MCP tool on the given server.
 *
 * Wraps the tool handler in a pipeline that:
 *   1. Runs the full Zod schema against raw input.
 *   2. Checks tool-block rules for checked tools.
 *   3. Passes parsed input to the handler.
 *   4. Formats the result as JSON via `formatResponse`.
 *   5. Translates any thrown error via `translateError`.
 */
export function registerCascadeTool<TSchema extends z.ZodTypeAny>(
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
    stripFromStructured,
  } = config;
  const sdkInputSchema = looseSchemaForSdk(inputSchema);
  rememberExactInputSchema(server, name, inputSchema);

  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: sdkInputSchema as any,
      annotations,
    },
    // Wrapped handler: the MCP SDK provides already-validated input here.
    (async (input: Record<string, unknown>): Promise<CallToolResult> => {
      const start = Date.now();
      try {
        const parsed = inputSchema.safeParse(input ?? {});
        if (!parsed.success) {
          const formatted = validationErrorResponse(name, inputSchema, parsed.error);
          logToolInvocation(name, "error", Date.now() - start, "validation failed");
          return formatted;
        }

        if (deps?.toolBlockStore && shouldCheckToolBlocks(name)) {
          const denied = findDeniedToolCall(
            name,
            parsed.data as Record<string, unknown>,
            await deps.toolBlockStore.read(),
          );
          if (denied) {
            const reason = denied.reason ? ` ${denied.reason}` : "";
            throw new Error(
              `Tool call denied by tool block repository for ${name} ${describeToolBlockRule(denied)}.${reason}`,
            );
          }
        }

        const result = await handler(parsed.data);

        const formatted = formatResponse(result, name, {
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
 * Override only tools/list so clients see the exact tool schemas while
 * tools/call still reaches our project-owned structured validation errors.
 */
export function registerExactToolSchemaListHandler(server: McpServer): void {
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registeredTools(server)
      .filter(([, tool]) => tool.enabled)
      .map(([name, tool]) => {
        const toolDefinition: Record<string, unknown> = {
          name,
          title: tool.title,
          description: tool.description,
          inputSchema: jsonSchemaForToolInput(
            exactInputSchemas.get(server)?.get(name) ?? tool.inputSchema,
          ),
          annotations: tool.annotations,
          execution: tool.execution,
          _meta: tool._meta,
        };

        if (tool.outputSchema) {
          const outputSchema = normalizeObjectSchema(tool.outputSchema as any);
          if (outputSchema) {
            toolDefinition.outputSchema = toJsonSchemaCompat(outputSchema, {
              strictUnions: true,
              pipeStrategy: "output",
            });
          }
        }

        return toolDefinition;
      }),
  }));
}

/**
 * Compose a consistent tool description. Keeps the footer prose identical
 * across all tools so agents see uniform guidance on response formats.
 */
export function buildCascadeToolDescription(base: string): string {
  const footer =
    "Responses are JSON text; structuredContent is authoritative when the response fits. Oversized responses return bounded _cache metadata for cascade_read_response. For cascade_read, read_mode controls preview versus raw Cascade payload shape.";
  const trimmed = base.trim();
  const separator = trimmed.endsWith(".") ? " " : ". ";
  return `${trimmed}${separator}${footer}`;
}

function objectShapeForSdk(schema: z.ZodTypeAny): z.ZodRawShape {
  return Object.assign({}, ...objectShapesForSdk(schema));
}

function looseSchemaForSdk(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  const shape = objectShapeForSdk(schema);
  const looseShape = Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [
      key,
      looseField(value as z.ZodTypeAny),
    ]),
  ) as z.ZodRawShape;
  return z.object(looseShape).passthrough();
}

function objectShapesForSdk(schema: z.ZodTypeAny): z.ZodRawShape[] {
  if (schema instanceof z.ZodObject) return [schema.shape];
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option) =>
      objectShapesForSdk(option as z.ZodTypeAny),
    );
  }
  throw new Error("registerCascadeTool inputSchema must wrap a Zod object");
}

function validationErrorResponse(
  tool: string,
  schema: z.ZodTypeAny,
  error: z.ZodError,
): CallToolResult {
  const validFields = Object.keys(objectShapeForSdk(schema));
  const structuredContent = {
    success: false,
    error: {
      type: "validation_error",
      tool,
      message: "Invalid tool input",
      valid_fields: validFields,
      issues: error.issues.map((issue) => validationIssue(issue)),
    },
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function validationIssue(issue: z.ZodIssue): Record<string, unknown> {
  const issueInfo = issue as unknown as {
    code: string;
    path: PropertyKey[];
    message: string;
    keys?: string[];
    options?: unknown[];
    values?: unknown[];
  };
  const out: Record<string, unknown> = {
    path: redactSecrets(issueInfo.path.join(".")),
    code: issueInfo.code,
    message: redactSecrets(issueInfo.message),
    hint: redactSecrets(validationHint(issue)),
  };
  if (issueInfo.code === "invalid_enum_value" && issueInfo.options) {
    out.valid_values = issueInfo.options;
  }
  if (issueInfo.code === "invalid_value" && issueInfo.values) {
    out.valid_values = issueInfo.values;
  }
  if (issueInfo.code === "unrecognized_keys" && issueInfo.keys) {
    out.keys = issueInfo.keys.map((key) => redactSecrets(key));
  }
  return out;
}

function validationHint(issue: z.ZodIssue): string {
  const issueInfo = issue as unknown as {
    code: string;
    keys?: string[];
    options?: unknown[];
    values?: unknown[];
    input?: unknown;
    received?: string;
  };
  if (issueInfo.code === "unrecognized_keys" && issueInfo.keys) {
    return `Remove unsupported field${issueInfo.keys.length === 1 ? "" : "s"}: ${issueInfo.keys.join(", ")}.`;
  }
  if (issueInfo.code === "invalid_enum_value" && issueInfo.options) {
    return `Use one of: ${issueInfo.options.map((v) => JSON.stringify(v)).join(", ")}.`;
  }
  if (issueInfo.code === "invalid_value" && issueInfo.values) {
    return `Use one of: ${issueInfo.values.map((v) => JSON.stringify(v)).join(", ")}.`;
  }
  if (
    issueInfo.code === "invalid_type" &&
    (issueInfo.received === "undefined" || issueInfo.input === undefined)
  ) {
    return "Provide the required field.";
  }
  return "Use the schema fields and value types described by this tool.";
}

function schemaDescription(schema: z.ZodTypeAny): string | undefined {
  return schema.description;
}

function looseField(schema: z.ZodTypeAny): z.ZodTypeAny {
  const field = z.unknown().optional();
  const description = schemaDescription(schema);
  return description ? field.describe(description) : field;
}

function rememberExactInputSchema(
  server: McpServer,
  name: string,
  schema: z.ZodTypeAny,
): void {
  let toolSchemas = exactInputSchemas.get(server);
  if (!toolSchemas) {
    toolSchemas = new Map();
    exactInputSchemas.set(server, toolSchemas);
  }
  toolSchemas.set(name, schema);
}

function registeredTools(server: McpServer): [string, RegisteredToolLike][] {
  const holder = server as unknown as {
    _registeredTools: Record<string, RegisteredToolLike>;
  };
  return Object.entries(holder._registeredTools);
}

function jsonSchemaForToolInput(
  schema: z.ZodTypeAny | undefined,
): Record<string, unknown> {
  if (!schema) {
    return { type: "object", properties: {}, additionalProperties: false };
  }

  if (schema instanceof z.ZodObject) {
    const objectSchema = normalizeObjectSchema(schema as any);
    return objectSchema
      ? toJsonSchemaCompat(objectSchema, {
          strictUnions: true,
          pipeStrategy: "input",
        })
      : { type: "object", properties: {}, additionalProperties: false };
  }

  const jsonSchema = toJsonSchemaCompat(schema as any, {
    strictUnions: true,
    pipeStrategy: "input",
  });
  return rootObjectSchema(jsonSchema);
}

function rootObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") return schema;
  return { ...schema, type: "object" };
}
