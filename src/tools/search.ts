/**
 * Search tool: 1 discovery operation exposed to MCP clients.
 *
 *   cascade_search — search for assets across Cascade by term/field/type
 *
 * A thin `registerCascadeTool` call delegating to `client.search`. The
 * helper handles the validate → call → format → error-translate pipeline.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import { SearchRequestSchema } from "../schemas/requests.js";
import { paginatedHandler } from "../pagination.js";

export function registerSearchTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_search",
    title: "Search Cascade",
    description: buildCascadeToolDescription(
      `Search for assets across Cascade CMS by search terms, optional field subset, and asset type filter.

Runs a keyword search against Cascade's indexed content. Can be scoped to a single site (via siteId or siteName) or run across all sites when neither is provided. The searchFields array narrows which asset fields are matched (default: all searchable fields); searchTypes narrows which asset types are returned. Results are paginated client-side by this MCP layer.

Args:
  - searchInformation (object, required):
    - searchTerms (string, required): Keyword(s) to match, non-empty
    - siteId (string, optional): Restrict to a site by ID
    - siteName (string, optional): Restrict to a site by name (ignored if siteId is set)
    - searchFields (string[], optional): Fields to search. Allowed: "name", "path", "createdBy", "modifiedBy", "displayName", "title", "summary", "teaser", "keywords", "description", "author", "blob", "velocityFormatContent", "xml", "link". Default: all.
    - searchTypes (string[], optional): Asset types to return (e.g. ["page", "file"]). Default: all.
  - limit (number, optional): Max results per page, 1-500 (default 50)
  - offset (number, optional): Skip N results for pagination (default 0)

Returns:
  The response is a page:
  {
    success: true,
    total: <total items available>,
    count: <items in this page>,
    offset: <current offset>,
    has_more: <bool>,
    next_offset: <offset for next page, if has_more>,
    matches: [ { id, type, path: { path, siteId, siteName } }, ... ]
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Find all pages mentioning 'admissions'" -> { searchInformation: { searchTerms: "admissions", searchTypes: ["page"] } }
  - Use when: "Title search in site 'www'" -> { searchInformation: { searchTerms: "scholarship", siteName: "www", searchFields: ["title"] } }
  - Don't use when: You already know the id/path — use cascade_read directly.
  - Don't use when: You want audit events — use cascade_read_audits.

Pagination:
  - Default limit of 50 works for most queries. Increase up to 500 for larger pages.
  - If has_more is true and you need all results, call again with offset: next_offset.
  - For a complete enumeration (e.g., all pages matching a term), loop until has_more: false.
  - For focused searches where you only need top matches, stop as soon as you have what you need.

Error Handling:
  - "searchTerms must not be empty" when the term is missing or blank
  - "Site not found" when siteName/siteId is invalid
  - "Permission denied" when credentials lack read access`,
    ),
    inputSchema: SearchRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: paginatedHandler(
      (req) => client.search(req as unknown as Types.SearchRequest),
      "matches",
    ),
  }, deps);
}
