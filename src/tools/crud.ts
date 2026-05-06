/**
 * CRUD tools: 6 basic asset operations exposed to MCP clients.
 *
 *   cascade_read   — fetch an asset by identifier
 *   cascade_create — create a new asset
 *   cascade_edit   — edit an existing asset
 *   cascade_remove — delete an asset
 *   cascade_move   — move and/or rename an asset
 *   cascade_copy   — copy an asset to a new location
 *
 * Each tool is a thin `registerCascadeTool` call delegating to the
 * matching `CascadeClient` method. The helper handles the
 * validate → call → format → error-translate pipeline.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import { createResponseCache } from "../cache.js";
import {
  createAssetCache,
  getRawValue,
  getIndexedNode,
  listRawFacts,
  listRawReferences,
  listIndexedChildren,
  searchRawKeys,
  searchRawValues,
  toAssetPreview,
  type AssetCache,
  type AssetPreview,
} from "../assetIndex.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import {
  ReadRequestSchema,
  AssetListFactsRequestSchema,
  AssetSearchValuesRequestSchema,
  AssetSearchKeysRequestSchema,
  AssetGetValueRequestSchema,
  AssetListReferencesRequestSchema,
  AssetListNodeletsRequestSchema,
  AssetGetNodeletRequestSchema,
  CreateRequestSchema,
  EditRequestSchema,
  RemoveRequestSchema,
  MoveRequestSchema,
  CopyRequestSchema,
} from "../schemas/requests.js";

function renderAssetPreview(result: unknown): string {
  const preview = result as AssetPreview;
  const lines = [
    "## cascade_read preview",
    `- asset_handle: ${preview.asset_handle}`,
    `- asset_type: ${preview.asset_type}`,
    `- raw_resource_uri: ${preview.raw_resource_uri}`,
    `- raw_hash: ${preview.raw_hash}`,
    `- index_version: ${preview.index_version}`,
    `- audit_complete: ${preview.audit_complete}`,
    `- total_fact_count: ${preview.total_fact_count}`,
    `- reference_count: ${preview.reference_count}`,
    `- node_count: ${preview.node_count}`,
    `- max_depth: ${preview.max_depth}`,
    "",
    "Use cascade_asset_list_facts, cascade_asset_search_values, cascade_asset_search_keys, cascade_asset_get_value, cascade_asset_list_references, cascade_asset_list_nodelets, or cascade_asset_get_nodelet with asset_handle for follow-up inspection.",
  ];
  if (preview.warnings.length > 0) {
    lines.push("", ...preview.warnings.map((warning) => `- warning: ${warning}`));
  }
  return lines.join("\n");
}

function registerAssetFollowUpTools(
  server: McpServer,
  assetCache: AssetCache,
  deps: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_asset_list_facts",
    title: "List cached raw asset facts",
    description: buildCascadeToolDescription(
      `Use after cascade_read. List object, array, key, and scalar facts indexed from the full cached raw Cascade response. Supports pointer, key, value, scalar, and reference filters with cursor pagination. This tool never reads Cascade directly and reports complete: true only when the current filter has no remaining matches.`,
    ),
    inputSchema: AssetListFactsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as Parameters<typeof listRawFacts>[1] & {
        asset_handle: string;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_list_facts");
      return listRawFacts(entry, args);
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_search_values",
    title: "Search cached raw asset scalar values",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Search full scalar values across the cached raw Cascade response, not shortened previews. Returns JSON Pointer provenance, scalar type, value length, preview, and match offsets where practical. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetSearchValuesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as Parameters<typeof searchRawValues>[1] & {
        asset_handle: string;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_search_values");
      return searchRawValues(entry, args);
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_search_keys",
    title: "Search cached raw asset object keys",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Find object key occurrences anywhere in the cached raw Cascade response. Returns the JSON Pointer to the keyed value plus parent pointer. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetSearchKeysRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as Parameters<typeof searchRawKeys>[1] & {
        asset_handle: string;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_search_keys");
      return searchRawKeys(entry, args);
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_get_value",
    title: "Get cached raw asset value",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Retrieve the exact raw cached value at a JSON Pointer. Long strings can be sliced with offset and length. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetGetValueRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as {
        asset_handle: string;
        pointer: string;
        offset?: number;
        length?: number;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_get_value");
      return getRawValue(entry, args.pointer, args);
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_list_references",
    title: "List cached Cascade asset references",
    description: buildCascadeToolDescription(
      `Use after cascade_read. List Cascade-native references discovered from id/path pairs, structured asset nodes, metadata, page configurations, and page regions. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetListReferencesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as Parameters<typeof listRawReferences>[1] & {
        asset_handle: string;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_list_references");
      return listRawReferences(entry, args);
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_list_nodelets",
    title: "List cached Cascade asset nodelets",
    description: buildCascadeToolDescription(
      `Use after cascade_read. List child structuredData nodelets for a JSON Pointer in the cached asset_handle returned by cascade_read. Use pointer "" to list root nodelets. This is a convenience view over structuredDataNodes, not an audit-complete view. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetListNodeletsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as {
        asset_handle: string;
        pointer: string;
        cursor?: string;
        limit?: number;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_list_nodelets");
      const listed = listIndexedChildren(entry, args.pointer, args);
      return {
        success: true,
        asset_handle: args.asset_handle,
        pointer: args.pointer,
        nodelets: listed.children,
        ...(listed.next_cursor ? { next_cursor: listed.next_cursor } : {}),
      };
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_get_nodelet",
    title: "Get cached Cascade asset nodelet",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Fetch the exact structuredData nodelet or bounded subtree at a JSON Pointer in the cached asset_handle returned by cascade_read. This is a convenience view over structuredDataNodes, not an audit-complete view. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetGetNodeletRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as {
        asset_handle: string;
        pointer: string;
        depth?: number;
        include_text?: boolean;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_get_nodelet");
      return {
        success: true,
        asset_handle: args.asset_handle,
        ...getIndexedNode(entry, args.pointer, args),
      };
    },
  }, deps);
}

function getAssetEntry(
  assetCache: AssetCache,
  handle: string,
  toolName: string,
) {
  const entry = assetCache.get(handle);
  if (!entry) {
    throw new Error(
      `${toolName}: asset handle ${handle} not found. Re-run cascade_read to create a fresh asset_handle.`,
    );
  }
  return entry;
}

export function registerCrudTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  const resolved: CascadeDeps = deps ?? { cache: createResponseCache() };
  const assetCache = resolved.assetCache ?? createAssetCache();

  registerCascadeTool(server, {
    name: "cascade_read",
    title: "Read Cascade Asset",
    description: buildCascadeToolDescription(
      `Read an asset from Cascade CMS by identifier.

Default preview mode returns a compact browse-oriented asset_handle, asset identity, raw_hash, index_version, fact/reference counts, node counts, root nodelet outline, and raw_resource_uri. Preview is not audit-complete; use cascade_asset_list_facts, cascade_asset_search_values, cascade_asset_search_keys, cascade_asset_get_value, cascade_asset_list_references, cascade_asset_list_nodelets, and cascade_asset_get_nodelet with the returned asset_handle for follow-up inspection. Use read_mode: "raw" only when the full REST payload is required.

Args:
  - identifier (object, required): The asset to read
    - id (string, optional): Cascade internal asset ID (e.g., "d3631e59ac1e..."). Takes priority over path when both are provided.
    - path (object, optional): Site-qualified path
      - path (string, required): Asset path within the site, starting from root (e.g., "/about/team")
      - siteId OR siteName (string): Which site the path belongs to
    - type (string, required): Entity type — one of the 56 EntityTypeString values (page, file, folder, block, template, etc.)
    - recycled (boolean, optional): Read from recycle bin.
  - read_mode (string, optional): 'preview' (default, compact handle-based output) or 'raw' (full REST payload; expensive for structured assets).
Returns:
  Preview mode:
  { asset_handle, asset_type, asset_identity, raw_resource_uri, raw_hash, index_version, audit_complete: false, total_fact_count, reference_count, node_count, max_depth, root_outline, omitted_fields, warnings, next_actions }
  Raw mode:
  { success: true, asset: { <type>: { ...type-specific representation } } }
  On failure: { success: false, message: "Asset not found" }

Examples:
  - Use when: "Read the homepage" -> { identifier: { type: "page", path: { path: "/", siteName: "www" } } }
  - Use when: "Get file by ID" -> { identifier: { type: "file", id: "abc123..." } }
  - Use when: "Load folder config" -> { identifier: { type: "folder", path: { path: "/about", siteName: "www" } } }
  - Don't use when: You want to modify — use cascade_edit instead.
  - Don't use when: You want to check access rights — use cascade_read_access_rights.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Permission denied" when credentials lack read access
  - "Site not found" when siteName/siteId is invalid`,
    ),
    inputSchema: ReadRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const readMode = raw.read_mode;
      const { read_mode: _rm, ...rest } = raw;
      const result = await client.read(rest as unknown as Types.ReadRequest);
      if (readMode === "raw") return result;

      const entry = assetCache.put(result);
      const preview = toAssetPreview(entry);
      return {
        ...preview,
        _resource_links: [
          {
            type: "resource_link" as const,
            uri: preview.raw_resource_uri,
            name: "Cascade raw asset JSON",
            description: "Exact raw JSON cached from this cascade_read call.",
            mimeType: "application/json",
          },
        ],
      };
    },
    renderMarkdown: renderAssetPreview,
    stripFromStructured: ["_resource_links"],
  }, resolved);

  registerAssetFollowUpTools(server, assetCache, resolved);

  registerCascadeTool(server, {
    name: "cascade_create",
    title: "Create Cascade Asset",
    description: buildCascadeToolDescription(
      `Create a new asset in Cascade CMS.

The request body wraps a typed envelope under \`asset\` — one of 48 envelope keys (page, file, folder, symlink, textBlock, feedBlock, indexBlock, xmlBlock, xhtmlDataDefinitionBlock, twitterFeedBlock, reference, template, xsltFormat, scriptFormat, user, group, role, assetFactory, contentType, destination, editorConfiguration, metadataSet, pageConfigurationSet, publishSet, dataDefinition, sharedField, site, workflowDefinition, workflowEmail, wordPressConnector, googleAnalyticsConnector, fileSystemTransport, ftpTransport, databaseTransport, cloudTransport, and the *Container types). This matches the upstream Cascade REST API \`Asset\` schema exactly. Returns the new asset's ID on success.

Payload conventions (apply to every create call):
  - Send ONLY the fields you actually need to set. Every optional field should be omitted unless you have a real value to provide — Cascade applies its own defaults server-side. Do not pad payloads with "reasonable defaults" like \`reviewOnSchedule: false\` or \`shouldBePublished: true\` when you do not need to override them.
  - For every \`<thing>Id\` / \`<thing>Path\` pair (parentFolderId vs parentFolderPath, siteId vs siteName, contentTypeId vs contentTypePath, metadataSetId vs metadataSetPath, ...), prefer the id form when you know the id. Path is a valid fallback and Cascade resolves it server-side — don't round-trip through cascade_read just to look up an id.
  - Text encoding: rich-text fields (xhtml, WYSIWYG structuredData text, xmlBlock xml) must be well-formed XML — named HTML entities like \`&nbsp;\` and astral-plane Unicode (including emoji) crash the render. See resource \`cascade://text-encoding\` for the per-field-category rules.

Args:
  - asset (object, required): Single-key envelope. Key is the camelCase type; value is the asset body.
    Common shapes (only required fields shown — add optionals only when you need to set them):
      - { page: { name, parentFolderId OR parentFolderPath, siteId OR siteName, contentTypeId OR contentTypePath, ... } }
      - { file: { name, parentFolderId OR parentFolderPath, siteId OR siteName, text? OR data?, ... } }
      - { folder: { name, parentFolderId OR parentFolderPath, siteId OR siteName, ... } }
      - { textBlock: { name, parentFolderId OR parentFolderPath, siteId OR siteName, text, ... } }
      - { xmlBlock: { name, parentFolderId OR parentFolderPath, siteId OR siteName, xml, ... } }
      - { symlink: { name, parentFolderId OR parentFolderPath, siteId OR siteName, linkURL, ... } }
    Admin-area types (assetFactory, contentType, transports, workflow*, *Container) use \`parentContainerId/Path\` instead of \`parentFolderId/Path\`.

Returns:
  Cascade OperationResult:
  { success: true, createdAssetId: "<new asset id>" }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Create a page under /about" -> { asset: { page: { name: "team", parentFolderPath: "/about", siteName: "www", contentTypePath: "/standard-page" } } }
  - Use when: "Upload a text file" -> { asset: { file: { name: "robots.txt", parentFolderPath: "/", siteName: "www", text: "User-agent: *" } } }
  - Use when: "Create a text block" -> { asset: { textBlock: { name: "greeting", parentFolderPath: "/blocks", siteName: "www", text: "Hello" } } }
  - Don't use when: The asset already exists — use cascade_edit.
  - Don't use when: You want to duplicate an existing asset — use cascade_copy.

Error Handling:
  - "Parent folder not found" when parentFolderId/parentFolderPath is invalid
  - "Asset name collision" when an asset with the same name exists in the parent
  - "Permission denied" when credentials lack create access on the parent
  - "Invalid content type" when contentTypeId/contentTypePath doesn't resolve`,
    ),
    inputSchema: CreateRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.create(input as unknown as Types.CreateRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_edit",
    title: "Edit Cascade Asset",
    description: buildCascadeToolDescription(
      `Edit an existing Cascade CMS asset.

Accepts the full asset body (same envelope shape as cascade_create). The workflow is symmetric when cascade_read is called with read_mode: "raw": modify the raw asset envelope and pass the same envelope back to cascade_edit. Some asset types require a prior cascade_check_out.

Payload conventions:
  - Edit replaces the asset body, so send the full object as read — do not try to send only the fields you are changing.
  - When constructing an edit payload from scratch (not round-tripping a read), still omit optional fields you have no intention of setting; don't invent defaults.
  - Prefer id over path on every id/path pair (metadataSetId over metadataSetPath, etc.). Cascade resolves paths server-side.
  - Text encoding: same rules as cascade_create — rich-text fields must be well-formed XML with only the five XML built-in entities (\`&amp;\`, \`&lt;\`, \`&gt;\`, \`&quot;\`, \`&apos;\`). See resource \`cascade://text-encoding\`.

Args:
  - asset (object, required): Single-key envelope (same as cascade_create). Inner object must include \`id\` to identify the existing asset.

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Update a page's metadata" -> Read first with cascade_read; modify \`asset.page.metadata\`; pass { asset: asset.asset } back.
  - Use when: "Change a block's structured data" -> { asset: { xhtmlDataDefinitionBlock: { id: "...", structuredData: { ... } } } }
  - Use when: "Rewrite a symlink's target" -> { asset: { symlink: { id: "...", linkURL: "https://new.example.com" } } }
  - Don't use when: The asset doesn't exist — use cascade_create.
  - Don't use when: You want a partial patch — Cascade's edit replaces the asset body; always send the full object.

Error Handling:
  - "Asset not found" when id doesn't resolve
  - "Permission denied" when credentials lack edit rights
  - "Asset is checked out by another user" when the asset is locked
  - "Validation error" when required fields are missing or malformed`,
    ),
    inputSchema: EditRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.edit(input as unknown as Types.EditRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_remove",
    title: "Remove (Delete) Cascade Asset",
    description: buildCascadeToolDescription(
      `Delete an asset from Cascade CMS.

By default, deletion sends the asset to the recycle bin; deleteParameters can unpublish and/or hard-delete. If the asset is under a workflow that requires review, workflowConfiguration specifies the approval flow. This is a DESTRUCTIVE operation — confirm intent before calling.

Args:
  - identifier (object, required): The asset to delete
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
  - deleteParameters (object, optional, shape varies — see Cascade docs): Controls delete behavior
    - doWorkflow (boolean): Whether to run the workflow on delete
    - unpublish (boolean): Unpublish from destinations before deleting
  - workflowConfiguration (object, optional, shape varies — see Cascade docs): Workflow step assignments when user can't bypass workflow

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Delete a page" -> { identifier: { type: "page", id: "..." } }
  - Use when: "Unpublish then delete" -> { identifier: { type: "page", id: "..." }, deleteParameters: { unpublish: true } }
  - Don't use when: You just want to move/rename — use cascade_move.
  - Don't use when: You want to unpublish without deleting — use cascade_publish_unpublish with unpublish: true.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Permission denied" when credentials lack delete rights
  - "Asset has children" when deleting a non-empty folder without cascade
  - "Workflow required" when the container requires workflow and none was supplied`,
    ),
    inputSchema: RemoveRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.remove(input as unknown as Types.RemoveRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_move",
    title: "Move or Rename Cascade Asset",
    description: buildCascadeToolDescription(
      `Move an asset to a new container and/or rename it.

Performs an in-place rename when newName is set but destinationContainerIdentifier is omitted, a pure move when destinationContainerIdentifier is set and newName is omitted, or both simultaneously when both are provided. References to the asset from other assets are updated automatically by Cascade.

Args:
  - identifier (object, required): The asset to move
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
  - moveParameters (object, required):
    - destinationContainerIdentifier (object, optional): Where to move the asset. Omit to keep in current container.
    - doWorkflow (boolean, required): Whether to run workflow on the move
    - newName (string, optional): New asset name. Omit to keep current name.
  - workflowConfiguration (object, optional, shape varies — see Cascade docs): Workflow step assignments

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Rename /about/teem to /about/team" -> { identifier: { type: "page", id: "..." }, moveParameters: { doWorkflow: false, newName: "team" } }
  - Use when: "Move page to /archive" -> { identifier: { type: "page", id: "..." }, moveParameters: { doWorkflow: false, destinationContainerIdentifier: { type: "folder", path: { path: "/archive", siteName: "www" } } } }
  - Don't use when: You want to duplicate — use cascade_copy.

Error Handling:
  - "Asset not found" when the source identifier doesn't resolve
  - "Destination not found" when destinationContainerIdentifier is invalid
  - "Name collision" when an asset with newName already exists in the destination
  - "Permission denied" when credentials lack move rights on source or destination`,
    ),
    inputSchema: MoveRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.move(input as unknown as Types.MoveRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_copy",
    title: "Copy Cascade Asset",
    description: buildCascadeToolDescription(
      `Copy an asset to a new container with a new name.

Creates a fresh, independent copy of an asset. Unlike cascade_move, the original stays in place and the copy gets its own ID. destinationContainerIdentifier and newName are both required. For copying an entire site, use cascade_site_copy instead.

Args:
  - identifier (object, required): The source asset to copy
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the source
  - copyParameters (object, required):
    - destinationContainerIdentifier (object, required): The container (folder/site) that will receive the copy
    - doWorkflow (boolean, required): Whether to run workflow on the copy
    - newName (string, required): Name for the new asset (must be unique within destination)
  - workflowConfiguration (object, optional, shape varies — see Cascade docs): Workflow step assignments

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Duplicate /templates/basic as /templates/basic-v2" -> { identifier: { type: "page", path: { path: "/templates/basic", siteName: "www" } }, copyParameters: { destinationContainerIdentifier: { type: "folder", path: { path: "/templates", siteName: "www" } }, newName: "basic-v2", doWorkflow: false } }
  - Don't use when: You want to rename in place — use cascade_move.
  - Don't use when: You want to copy an entire site — use cascade_site_copy.

Error Handling:
  - "Asset not found" when the source identifier doesn't resolve
  - "Destination not found" when destinationContainerIdentifier is invalid
  - "Name collision" when newName already exists in destination
  - "Permission denied" when credentials lack read on source or create on destination`,
    ),
    inputSchema: CopyRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.copy(input as unknown as Types.CopyRequest),
  }, deps);
}
