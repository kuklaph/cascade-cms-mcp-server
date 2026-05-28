/**
 * Server factory for the Cascade CMS MCP server.
 *
 * Instantiates a single `McpServer` and registers Cascade tools, handle-based
 * asset inspection tools, local MCP utility tools, and MCP resources/templates.
 *
 * Pure and side-effect-free: callers own transport/lifecycle.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CascadeClient } from "./client.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { createResponseCache } from "./cache.js";
import { createAssetCache } from "./assetIndex.js";
import { createToolBlockStore } from "./toolBlocks.js";
import {
  registerExactToolSchemaListHandler,
  type CascadeDeps,
} from "./tools/helper.js";
import { registerCrudTools } from "./tools/crud.js";
import { registerSearchTools } from "./tools/search.js";
import { registerSiteTools } from "./tools/sites.js";
import { registerAccessTools } from "./tools/access.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerCheckoutTools } from "./tools/checkout.js";
import { registerAuditTools } from "./tools/audits.js";
import { registerPublishTools } from "./tools/publish.js";
import {
  registerSiteRemovalProtectionTool,
  registerToolBlockTool,
} from "./tools/toolBlocks.js";
import { registerReadResponseTool } from "./tools/readResponse.js";
import { registerServerVersionTool } from "./tools/version.js";
import { registerCascadeResources } from "./resources.js";

/**
 * Build an `McpServer` with all Cascade tools registered.
 *
 * The server is returned unconnected; the caller must attach a transport
 * (e.g., `StdioServerTransport`) and invoke `server.connect(transport)`.
 *
 * @param client - The Cascade API client.
 * @param deps   - Optional shared dependencies. When omitted, a fresh in-memory
 *                 response cache is built so oversize tool results can mint
 *                 handles consumable by `cascade_read_response`.
 */
export function createServer(
  client: CascadeClient,
  deps?: Partial<CascadeDeps>,
): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const resolved: CascadeDeps = {
    cache: deps?.cache ?? createResponseCache(),
    assetCache: deps?.assetCache ?? createAssetCache(),
    toolBlockStore: deps?.toolBlockStore ?? createToolBlockStore(),
  };

  registerCrudTools(server, client, resolved);
  registerSearchTools(server, client, resolved);
  registerSiteTools(server, client, resolved);
  registerAccessTools(server, client, resolved);
  registerWorkflowTools(server, client, resolved);
  registerMessageTools(server, client, resolved);
  registerCheckoutTools(server, client, resolved);
  registerAuditTools(server, client, resolved);
  registerPublishTools(server, client, resolved);

  registerCascadeResources(server, client, resolved);

  // Local MCP tools: manage guardrails and read slices from the response
  // cache populated by the other tool cohorts above.
  registerToolBlockTool(server, resolved);
  registerSiteRemovalProtectionTool(server, client, resolved);
  registerServerVersionTool(server);
  registerReadResponseTool(server, resolved);

  registerExactToolSchemaListHandler(server);

  return server;
}
