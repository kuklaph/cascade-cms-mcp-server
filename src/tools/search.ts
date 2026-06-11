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

Runs a keyword search against Cascade's indexed content. Can be scoped to a single site (via siteId or siteName) or run across all sites when neither is provided. Results are paginated client-side by this MCP layer.

Search semantics:
  - searchTerms is passed through unchanged to Cascade's server-side search.
  - Unquoted words are interpreted as a broader keyword search.
  - Literal double quotes can be used for phrase matching; include the quote characters around the phrase when that is intended.
  - ? and * are Cascade search wildcards; use them only when wildcard expansion is intended.
  - This MCP server does not split, escape, normalize, or reinterpret searchTerms.

Scope:
  - searchFields and searchTypes are optional filters.
  - Omit searchFields to search all Cascade-searchable fields.
  - Omit searchTypes to include all searchable asset types.
  - Adding searchFields or searchTypes narrows the search, which can improve precision but may exclude useful matches.
  - Use these filters when that narrowing is intentional for the search at hand.

Args:
  - searchInformation (object, required):
    - searchTerms (string, required): Query string passed through unchanged to Cascade search, non-empty
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
  - Broad discovery: { searchInformation: { searchTerms: "financial aid", siteName: "www" } }
  - Phrase search: { searchInformation: { searchTerms: '"financial aid"', siteName: "www" } }
  - Narrowed page search: { searchInformation: { searchTerms: "financial aid", siteName: "www", searchTypes: ["page"] } }
  - Field-focused search: { searchInformation: { searchTerms: '"financial aid"', searchFields: ["title", "summary"] } }
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
