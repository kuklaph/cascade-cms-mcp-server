/**
 * Local MCP server metadata tools.
 *
 * These tools report this MCP server's own metadata and do not call Cascade.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { ServerVersionRequestSchema } from "../schemas/requests.js";
import {
  buildCascadeToolDescription,
  registerCascadeTool,
} from "./helper.js";

export function registerServerVersionTool(server: McpServer): void {
  registerCascadeTool(server, {
    name: "server_version",
    title: "Read MCP server version",
    description: buildCascadeToolDescription(
      `Read this MCP server's name and version (server_version).

Use this tool when you need to confirm which cascade-cms-mcp-server version is running in the client.

Args:
  (none)

Returns:
  {
    success: true,
    name: "cascade-cms-mcp-server",
    version: "<server version>"
  }

Examples:
  - Check the MCP server version: {}`,
    ),
    inputSchema: ServerVersionRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => ({
      success: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
    }),
  });
}
