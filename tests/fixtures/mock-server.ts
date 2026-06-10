/**
 * Shared test helpers for MCP tool cohort tests.
 *
 * All 9 tool cohort tests use the same three helpers:
 *   - makeMockServer: captures registerTool calls into a list
 *   - findTool:       look up a registered tool by name
 *   - firstText:      read the first text block from a CallToolResult
 *
 * Extracted to one place so the Rule of Three is honored: the production
 * code uses `registerCascadeTool` to deduplicate tool registration; the
 * tests use this file to deduplicate mock-server setup.
 */

import { mock } from "bun:test";
import type {
  CallToolResult,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";

/** A captured call to `server.registerTool(...)`. */
export interface RegisteredTool {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: unknown;
    annotations: ToolAnnotations;
  };
  handler: (input: Record<string, unknown>) => Promise<CallToolResult>;
}

/** A spyable mock MCP server that records each `registerTool` call. */
export interface MockMcpServer {
  registerTool: ReturnType<typeof mock>;
}

/** Create a mock MCP server that captures every `registerTool` call. */
export function makeMockServer(): {
  server: MockMcpServer;
  tools: RegisteredTool[];
} {
  const tools: RegisteredTool[] = [];
  const server: MockMcpServer = {
    registerTool: mock((name: string, config: any, handler: any) => {
      tools.push({ name, config, handler });
      return {};
    }),
  };
  return { server, tools };
}

/** Look up a registered tool by name; throws if not found. */
export function findTool(
  tools: RegisteredTool[],
  name: string,
): RegisteredTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} not registered`);
  return t;
}

/** Extract the text from the first content block of a CallToolResult. */
export function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be 'text'");
  }
  return block.text;
}

export function inputJsonSchema(inputSchema: unknown): Record<string, any> {
  return (inputSchema as StandardSchemaWithJSON)["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  }) as Record<string, any>;
}

export async function validateInputSchema(
  inputSchema: unknown,
  input: unknown,
): Promise<Record<string, unknown>> {
  const result = await (inputSchema as StandardSchemaWithJSON)[
    "~standard"
  ].validate(input);
  if (result.issues) {
    throw new Error(
      result.issues.map((issue) => issue.message).join("; ") || "Invalid input",
    );
  }
  return result.value as Record<string, unknown>;
}
