/**
 * Site tools: 2 site-level operations exposed to MCP clients.
 *
 *   list_sites — list sites accessible to the API credentials
 *   site_copy  — duplicate an entire site under a new name
 *
 * Each tool is a thin `registerCascadeTool` call delegating to the
 * matching `CascadeClient` method. The helper handles the
 * validate → call → format → error-translate pipeline.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import {
  ListSitesRequestSchema,
  SiteCopyRequestSchema,
} from "../schemas/requests.js";

export function registerSiteTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "list_sites",
    title: "List Cascade Sites",
    description: buildCascadeToolDescription(
      `List all sites accessible with the current API credentials.

Returns site Identifier objects for every site the authenticated user can see. Site names appear in identifier.path.path, not in a top-level name field. This is typically the first call an agent makes to discover which sites exist before reading or editing assets inside them. The response contains only identifiers — call read with { identifier: <site identifier returned by list_sites> } to fetch a site's full configuration.

Args:
  (none)

Returns:
  Cascade OperationResult:
  { success: true, sites: [ { id, type: "site", path: { path, siteId, siteName } }, ... ] }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "What sites do I have access to?" -> {}
  - Use when: "I need to find a siteId before reading a page" -> call this, then match by id or path.path.
  - Don't use when: You already know the site name/id — skip straight to read.
  - Don't use when: You need a site's full config — use read with { identifier: <site identifier> }.

Error Handling:
  - "Permission denied" when credentials are invalid
  - "Authentication failed" when the API key is missing or revoked`,
    ),
    inputSchema: ListSitesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.listSites(input as unknown as Types.ListSitesRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "site_copy",
    title: "Copy Cascade Site",
    description: buildCascadeToolDescription(
      `Copy an entire site to a new site with a new name.

Duplicates all assets, folders, templates, and configuration from an existing site into a brand-new site. This is a LONG-RUNNING operation — Cascade returns once the copy has started but finishes asynchronously. Poll list_sites to confirm completion. Either originalSiteId or originalSiteName must be provided; if both are given, originalSiteId wins.

Args:
  - originalSiteId (string, optional): Source site ID. Preferred when known.
  - originalSiteName (string, optional): Source site name. Used when originalSiteId is omitted.
  - newSiteName (string, required): Name for the new copied site. Must be unique across sites.

(Either originalSiteId or originalSiteName is required; the tool rejects calls that omit both.)

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Duplicate the 'staging' site as 'staging-2026'" -> { originalSiteName: "staging", newSiteName: "staging-2026" }
  - Use when: "Copy site by id for a new campaign" -> { originalSiteId: "abc123...", newSiteName: "campaign-fall" }
  - Don't use when: You want to copy a single asset — use copy.
  - Don't use when: The site already exists under newSiteName — no merge behavior is supported.

Error Handling:
  - "requires either originalSiteId or originalSiteName" when both are omitted
  - "Source site not found" when the original identifier doesn't resolve
  - "Site name collision" when newSiteName already exists
  - "Permission denied" when the user isn't a site-copy administrator`,
    ),
    inputSchema: SiteCopyRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.siteCopy(input as unknown as Types.SiteCopyRequest),
  }, deps);
}
