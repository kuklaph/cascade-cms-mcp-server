import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BrowserCheckDraftRequestSchema,
  BrowserCreateSnippetRequestSchema,
  BrowserDeleteSnippetsRequestSchema,
  BrowserListSnippetsRequestSchema,
  BrowserLoginRequestSchema,
  BrowserUpdateSnippetRequestSchema,
} from "../schemas/requests.js";
import {
  buildCascadeToolDescription,
  registerCascadeTool,
  type CascadeDeps,
} from "./helper.js";

const browserSessionRequirement =
  "This tool uses a cached browser session, or logs in automatically when CASCADE_BROWSER_USERNAME, CASCADE_BROWSER_PASSWORD, and CASCADE_BROWSER_SITE_ID are configured. If CASCADE_BROWSER_SITE_ID is missing, run cascade_browser_login with site_id before calling this tool. It never accepts credentials or cookies in tool input.";

export function registerBrowserTools(
  server: McpServer,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_browser_login",
    title: "Log In To Cascade Browser UI",
    description: buildCascadeToolDescription(
      `Authenticate against Cascade's browser UI and store the resulting session in this MCP server process for later browser-backed tools.

This is the recovery path for browser-only operations when startup login failed or CASCADE_BROWSER_SITE_ID was not configured. Normal browser setup should provide CASCADE_BROWSER_USERNAME, CASCADE_BROWSER_PASSWORD, and CASCADE_BROWSER_SITE_ID before the MCP server starts. Credentials are never accepted in tool input or returned in tool output. The browser base URL is derived from CASCADE_URL unless CASCADE_BROWSER_URL is set.

Args:
  - site_id (string, optional): Cascade site ID to switch into after browser login. Required unless CASCADE_BROWSER_SITE_ID is configured. Use the production site ID by default.

Returns:
  { success: true, authenticated: true, browser_url, site_id, cookie_names, logged_in_at }

Use when: setting up browser-backed Cascade functionality before calling browser tools.
Don't use when: the standard Cascade REST/SOAP API tool can perform the operation directly.`,
    ),
    inputSchema: BrowserLoginRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => {
      return requireBrowserSession(deps).login({ siteId: input.site_id });
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_browser_check_draft",
    title: "Check Browser Draft Notification",
    description: buildCascadeToolDescription(
      `Check Cascade's browser-only editing-users notification endpoint for an asset.

${browserSessionRequirement}

Args:
  - asset_id (string, required): Cascade asset ID to check.
  - asset_type (string, required): Cascade entity type for the asset, used in the browser edit referer.

Returns:
  { success: true, asset_id, asset_type, has_draft, status, message? }

Use when: checking whether a Cascade asset has an active editing draft notification that is only available through the browser UI.
Don't use when: you need to edit or submit drafts; use the MCP draft tools for local draft workflow operations.`,
    ),
    inputSchema: BrowserCheckDraftRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      return requireBrowserSession(deps).checkDraft({
        assetId: input.asset_id,
        assetType: input.asset_type,
      });
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_browser_list_snippets",
    title: "List Browser Snippets",
    description: buildCascadeToolDescription(
      `List Cascade snippets from the browser-only administration endpoint.

${browserSessionRequirement}

Args:
  - limit (number, optional): Max snippets per page, 1-500 (default 50)
  - offset (number, optional): Skip N snippets for pagination (default 0)

Returns:
  { success: true, snippets, total, count, offset, has_more, next_offset?, status }

Use when: discovering snippet IDs, names, titles, values, and tokens before updating or deleting snippets.
Don't use when: you need standard Cascade assets; use REST/SOAP tools for normal asset operations.`,
    ),
    inputSchema: BrowserListSnippetsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => requireBrowserSession(deps).listSnippets(input),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_browser_create_snippet",
    title: "Create Browser Snippet",
    description: buildCascadeToolDescription(
      `Create a Cascade snippet through the browser-only snippets administration endpoint.

${browserSessionRequirement}

Args:
  - title (string, required): Human-readable snippet title.
  - name (string, required): Snippet system name used in the snippet token.
  - value (string, required): Snippet replacement value.

Returns:
  { success: true, status, message? }

Use when: creating an administration snippet that is not exposed through the standard Cascade REST/SOAP API.
Don't use when: updating an existing snippet; use cascade_browser_update_snippet.`,
    ),
    inputSchema: BrowserCreateSnippetRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => requireBrowserSession(deps).createSnippet(input),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_browser_update_snippet",
    title: "Update Browser Snippet",
    description: buildCascadeToolDescription(
      `Update a Cascade snippet through the browser-only snippets administration endpoint.

${browserSessionRequirement}

Args:
  - id (string, required): Snippet ID from cascade_browser_list_snippets.
  - title (string, required): Updated snippet title.
  - value (string, required): Updated snippet replacement value.

Returns:
  { success: true, status, message? }

Use when: changing an existing snippet's title or value.
Don't use when: you only know the snippet name; first call cascade_browser_list_snippets to get its ID.`,
    ),
    inputSchema: BrowserUpdateSnippetRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => requireBrowserSession(deps).updateSnippet(input),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_browser_delete_snippets",
    title: "Delete Browser Snippets",
    description: buildCascadeToolDescription(
      `Delete one or more Cascade snippets through the browser-only snippets administration endpoint.

This is destructive. ${browserSessionRequirement}

Args:
  - ids (string[], required): One or more snippet IDs from cascade_browser_list_snippets.

Returns:
  { success: true, status, message?, results? }

Use when: permanently removing known snippets by ID.
Don't use when: you only know the snippet name; first call cascade_browser_list_snippets to get IDs.`,
    ),
    inputSchema: BrowserDeleteSnippetsRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => requireBrowserSession(deps).deleteSnippets(input),
  }, deps);
}

function requireBrowserSession(deps: CascadeDeps | undefined) {
  if (deps?.browserSession) return deps.browserSession;
  throw new Error(
    "Browser API login is not configured. Set CASCADE_BROWSER_USERNAME and CASCADE_BROWSER_PASSWORD to enable browser login. Set CASCADE_BROWSER_SITE_ID for startup/automatic browser login, or pass site_id to cascade_browser_login. Set CASCADE_BROWSER_URL only when the browser UI root differs from the origin derived from CASCADE_URL.",
  );
}
