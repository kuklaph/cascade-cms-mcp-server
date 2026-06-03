/**
 * CRUD and cached asset follow-up tools exposed to MCP clients.
 *
 *   cascade_read   — fetch an asset by identifier
 *   cascade_create — create a new asset
 *   cascade_edit   — edit an existing asset
 *   cascade_remove — delete an asset
 *   cascade_move   — move and/or rename an asset
 *   cascade_copy   — copy an asset to a new location
 *
 * CRUD tools delegate to the matching `CascadeClient` method. Cached follow-up
 * tools inspect local read-cache entries without calling Cascade.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { open, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import { createResponseCache } from "../cache.js";
import { FILE_DATA_MAX_BYTES } from "../constants.js";
import {
  createAssetCache,
  getRawValue,
  getIndexedNode,
  listRawFacts,
  listAssetScalarArtifacts,
  listRawReferences,
  listIndexedChildren,
  searchRawKeys,
  searchRawValues,
  toAssetPreview,
  type AssetCache,
  type AssetCacheEntry,
} from "../assetIndex.js";
import {
  isNumberArray,
  isVerifiedImageSummary,
  readFileDataRange,
  toUnsignedByteSlice,
  toUnsignedBytes,
  type BinaryFieldSummary,
} from "../fileData.js";
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
  AssetListScalarArtifactsRequestSchema,
  AssetListReferencesRequestSchema,
  AssetListNodeletsRequestSchema,
  AssetGetNodeletRequestSchema,
  AssetResolveNodesRequestSchema,
  AssetAssertValuesRequestSchema,
  FileDataExportRequestSchema,
  FileDataInfoRequestSchema,
  FileDataImageRequestSchema,
  FileDataReadRequestSchema,
  CreateRequestSchema,
  EditRequestSchema,
  RemoveRequestSchema,
  MoveRequestSchema,
  CopyRequestSchema,
} from "../schemas/requests.js";
import {
  evaluateStructuredDataAssertions,
  resolveStructuredDataNodes,
  type StructuredDataAssertion,
  type StructuredDataSelector,
} from "../structuredDataSelectors.js";

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const FILE_DATA_EXPORT_CHUNK_BYTES = 64 * 1024;

function registerAssetFollowUpTools(
  server: McpServer,
  client: CascadeClient,
  assetCache: AssetCache,
  deps: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_asset_list_facts",
    title: "List cached raw asset facts",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Browse object, array, key, and scalar facts indexed from the full cached raw Cascade response. Use this for audit/debug enumeration; when the task is to find text or content by snippet, prefer cascade_asset_search_values because list_facts can return both key facts and scalar facts for the same value. Supports pointer, key, value, scalar, and reference filters with cursor pagination. This tool never reads Cascade directly and reports complete: true only when the current filter has no remaining matches.`,
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
      `Use after cascade_read. Search full scalar string/number/boolean/null values across the cached raw Cascade response, not shortened previews. Best first choice for finding text/content by known snippet. Returns JSON Pointer provenance, scalar type, value length, preview, and match offsets where practical. This tool never reads Cascade directly.`,
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
    name: "cascade_asset_list_scalar_artifacts",
    title: "List cached raw scalar artifacts",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Enumerate derived link/path-like artifacts from cached raw string scalar facts. Use href for any value found in an HTML/XHTML href attribute, whether absolute, root-relative, relative, or site://; use site_link for non-root, non-URL Cascade *Path fields such as pagePath, filePath, blockPath, and parentFolderPath. Other artifact kinds include http_url, src, anchor, mailto, tel, and root_path. Returns JSON Pointer and offset provenance. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetListScalarArtifactsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as Parameters<typeof listAssetScalarArtifacts>[1] & {
        asset_handle: string;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_list_scalar_artifacts");
      return listAssetScalarArtifacts(entry, args);
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
        next_actions: [
          ...(listed.next_cursor
            ? [
                {
                  tool: "cascade_asset_list_nodelets",
                  reason: "Continue listing nodelets from the next cursor.",
                  input: {
                    asset_handle: args.asset_handle,
                    pointer: args.pointer,
                    cursor: listed.next_cursor,
                    ...(args.limit ? { limit: args.limit } : {}),
                  },
                },
              ]
            : []),
          ...listed.children.map((nodelet) => ({
            tool: "cascade_asset_get_nodelet",
            reason: "Fetch this nodelet or a bounded subtree.",
            input: {
              asset_handle: args.asset_handle,
              pointer: nodelet.pointer,
            },
          })),
        ],
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

  registerCascadeTool(server, {
    name: "cascade_asset_resolve_nodes",
    title: "Resolve cached structured data nodes",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Resolve structuredData nodes from the cached asset_handle by node type, identifier, text, direct child criteria, or field values. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetResolveNodesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as {
        asset_handle: string;
        selector: StructuredDataSelector;
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_resolve_nodes");
      return {
        success: true,
        asset_handle: args.asset_handle,
        ...resolveStructuredDataNodes(entry, args.selector),
      };
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_asset_assert_values",
    title: "Assert cached structured data values",
    description: buildCascadeToolDescription(
      `Use after cascade_read. Assert structuredData values from the cached asset_handle by semantic node selector and target field. This tool never reads Cascade directly.`,
    ),
    inputSchema: AssetAssertValuesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as unknown as {
        asset_handle: string;
        assertions: StructuredDataAssertion[];
      };
      const entry = getAssetEntry(assetCache, args.asset_handle, "cascade_asset_assert_values");
      return {
        success: true,
        asset_handle: args.asset_handle,
        ...evaluateStructuredDataAssertions(entry, args.assertions),
      };
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_file_data_info",
    title: "Inspect Cascade file data",
    description: buildCascadeToolDescription(
      `Inspect binary data for a Cascade file asset without dumping the raw byte array. Use asset_handle after cascade_read preview, or identifier for a direct file read that creates a fresh asset_handle for follow-up calls.`,
    ),
    inputSchema: FileDataInfoRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const entry = await resolveFileDataEntry(
        client,
        assetCache,
        input as FileDataSourceInput,
        "cascade_file_data_info",
      );
      const { summary } = fileDataFromEntry(entry, "cascade_file_data_info");
      return fileDataInfoResult(entry, summary);
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_file_data_read",
    title: "Read Cascade file data range",
    description: buildCascadeToolDescription(
      `Read a bounded byte range from binary data for a Cascade file asset. Use this instead of reading file.data directly when the file may be large. Accepts asset_handle after cascade_read preview, or identifier for a direct file read that creates a fresh asset_handle.`,
    ),
    inputSchema: FileDataReadRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const args = input as FileDataSourceInput & {
        offset?: number;
        length?: number;
        encoding?: "hex" | "base64";
      };
      const entry = await resolveFileDataEntry(
        client,
        assetCache,
        args,
        "cascade_file_data_read",
      );
      const { data, summary } = fileDataFromEntry(entry, "cascade_file_data_read");
      return {
        ...fileDataInfoResult(entry, summary),
        ...readFileDataRange(data, args),
      };
    },
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_file_data_image",
    title: "Return Cascade file data as image content",
    description: buildCascadeToolDescription(
      `Return binary data for a Cascade image file as MCP image content without dumping base64 into the JSON text response. Accepts asset_handle after cascade_read preview, or identifier for a direct file read that creates a fresh asset_handle.`,
    ),
    inputSchema: FileDataImageRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const entry = await resolveFileDataEntry(
        client,
        assetCache,
        input as FileDataSourceInput,
        "cascade_file_data_image",
      );
      const { data, summary } = fileDataFromEntry(entry, "cascade_file_data_image");
      if (!isVerifiedImageSummary(summary)) {
        throw new Error(
          `cascade_file_data_image: cached file asset ${entry.handle} is ${summary.mime_type} from ${summary.mime_source}, not a magic-byte verified image.`,
        );
      }
      if (summary.bytes_total > MAX_INLINE_IMAGE_BYTES) {
        throw new Error(
          `cascade_file_data_image: image is too large for inline MCP image content (${summary.bytes_total} bytes, max ${MAX_INLINE_IMAGE_BYTES}). Use cascade_file_data_export instead.`,
        );
      }
      const bytes = toUnsignedBytes(data);
      return {
        ...fileDataInfoResult(entry, summary),
        _content_blocks: [
          {
            type: "image" as const,
            data: Buffer.from(bytes).toString("base64"),
            mimeType: summary.mime_type,
          },
        ],
      };
    },
    stripFromStructured: ["_content_blocks"],
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_file_data_export",
    title: "Export Cascade file data",
    description: buildCascadeToolDescription(
      `Export binary data for a Cascade file asset to an explicit local output_path. This writes to the local filesystem but does not mutate Cascade. Parent directories must already exist; overwrite defaults to false.`,
    ),
    inputSchema: FileDataExportRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => {
      const args = input as FileDataSourceInput & {
        output_path: string;
        overwrite?: boolean;
        expected_sha256?: string;
      };
      const entry = await resolveFileDataEntry(
        client,
        assetCache,
        args,
        "cascade_file_data_export",
      );
      const { data, summary } = fileDataFromEntry(entry, "cascade_file_data_export");
      if (
        args.expected_sha256 &&
        args.expected_sha256.toLowerCase() !== summary.sha256.toLowerCase()
      ) {
        throw new Error(
          `cascade_file_data_export: expected_sha256 mismatch for ${entry.handle}. Expected ${args.expected_sha256}, actual ${summary.sha256}.`,
        );
      }
      if (summary.bytes_total > FILE_DATA_MAX_BYTES) {
        throw new Error(
          `cascade_file_data_export: file.data is too large to export (${summary.bytes_total} bytes, max ${FILE_DATA_MAX_BYTES}).`,
        );
      }

      const outputPath = resolve(args.output_path);
      await assertExportParentDirectory(outputPath);
      await writeFileData(outputPath, data, args.overwrite ?? false);

      return {
        ...fileDataInfoResult(entry, summary),
        output_path: outputPath,
        bytes_written: data.length,
        overwrite: args.overwrite ?? false,
      };
    },
  }, deps);
}

interface FileDataSourceInput {
  asset_handle?: string;
  identifier?: Types.Identifier;
}

async function resolveFileDataEntry(
  client: CascadeClient,
  assetCache: AssetCache,
  input: FileDataSourceInput,
  toolName: string,
): Promise<AssetCacheEntry> {
  if (input.asset_handle) {
    return getAssetEntry(assetCache, input.asset_handle, toolName);
  }
  if (!input.identifier) {
    throw new Error(`${toolName}: provide exactly one of asset_handle or identifier.`);
  }
  const result = await client.read({
    identifier: input.identifier,
  } as unknown as Types.ReadRequest);
  return assetCache.put(result);
}

function fileDataFromEntry(
  entry: AssetCacheEntry,
  toolName: string,
): { data: number[]; summary: BinaryFieldSummary } {
  if (entry.assetType !== "file") {
    throw new Error(`${toolName}: cached asset ${entry.handle} is not a file asset.`);
  }
  const data = entry.asset?.data;
  if (!isNumberArray(data) || entry.binaryFields.length === 0) {
    throw new Error(`${toolName}: cached file asset ${entry.handle} has no binary data.`);
  }
  return { data, summary: entry.binaryFields[0]! };
}

function fileDataInfoResult(
  entry: AssetCacheEntry,
  summary: BinaryFieldSummary,
): Record<string, unknown> {
  return {
    success: true,
    asset_handle: entry.handle,
    asset_type: entry.assetType,
    asset_identity: entry.assetIdentity,
    raw_resource_uri: entry.rawResourceUri,
    raw_hash: entry.rawHash,
    index_version: entry.indexVersion,
    ...summary,
    next_actions: fileDataNextActions(entry.handle, summary),
  };
}

function fileDataNextActions(
  assetHandle: string,
  summary: BinaryFieldSummary,
): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [
    {
      tool: "cascade_file_data_read",
      reason: "Read a bounded byte range from this cached file data.",
      input: { asset_handle: assetHandle },
    },
    {
      tool: "cascade_file_data_export",
      reason: "Export this file data to an explicit local output_path.",
      required_inputs: ["asset_handle", "output_path"],
    },
  ];
  if (isVerifiedImageSummary(summary)) {
    actions.splice(1, 0, {
      tool: "cascade_file_data_image",
      reason: "Return this cached file data as MCP image content.",
      input: { asset_handle: assetHandle },
    });
  }
  return actions;
}

async function assertExportParentDirectory(outputPath: string): Promise<void> {
  const parent = dirname(outputPath);
  let parentStat;
  try {
    parentStat = await stat(parent);
  } catch {
    throw new Error(`cascade_file_data_export: Parent directory does not exist: ${parent}`);
  }
  if (!parentStat.isDirectory()) {
    throw new Error(`cascade_file_data_export: Parent path is not a directory: ${parent}`);
  }
}

async function writeFileData(
  outputPath: string,
  data: readonly number[],
  overwrite: boolean,
): Promise<void> {
  const file = await open(outputPath, overwrite ? "w" : "wx").catch((err: unknown) => {
    if (isFileExistsError(err)) {
      throw new Error(
        `cascade_file_data_export: output_path already exists. Set overwrite: true to replace it.`,
      );
    }
    throw err;
  });
  try {
    for (let offset = 0; offset < data.length; offset += FILE_DATA_EXPORT_CHUNK_BYTES) {
      const end = Math.min(data.length, offset + FILE_DATA_EXPORT_CHUNK_BYTES);
      await file.write(toUnsignedByteSlice(data, offset, end));
    }
  } finally {
    await file.close();
  }
}

function isFileExistsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "EEXIST"
  );
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

Default preview mode returns a compact browse-oriented asset_handle, asset identity, raw_hash, index_version, fact/reference counts, node counts, root nodelet outline, and raw_resource_uri. Preview is not audit-complete; use cascade_asset_list_facts, cascade_asset_search_values, cascade_asset_search_keys, cascade_asset_get_value, cascade_asset_list_scalar_artifacts, cascade_asset_list_references, cascade_asset_list_nodelets, cascade_asset_get_nodelet, cascade_asset_resolve_nodes, and cascade_asset_assert_values with the returned asset_handle for follow-up inspection. Use read_mode: "raw" only when the full REST payload is required.

Args:
  - identifier (object, required): The asset to read
    - id (string, optional): Cascade internal asset ID (e.g., "d3631e59ac1e..."). Takes priority over path when both are provided.
    - path (object, optional): Site-qualified path
      - path (string, required): Asset path within the site, starting from root (e.g., "/about/team")
      - siteId OR siteName (string): Which site the path belongs to
    - type (string, required): Entity type — one of the 56 EntityTypeString values (page, file, folder, block, template, etc.)
    - recycled (boolean, optional): Read from recycle bin.
    - requires type plus either id or path; prefer id when known
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
  - Don't use when: You already have a complete edit payload — use cascade_edit instead.
  - Use when: You need a cached starting point for draft editing — read preview, then use cascade_draft_open.
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
    stripFromStructured: ["_resource_links"],
  }, resolved);

  registerAssetFollowUpTools(server, client, assetCache, resolved);

  registerCascadeTool(server, {
    name: "cascade_create",
    title: "Create Cascade Asset",
    description: buildCascadeToolDescription(
      `Create a new asset in Cascade CMS.

The request body wraps a typed concrete asset envelope under \`asset\` — one concrete key (page, file, folder, symlink, textBlock, feedBlock, indexBlock, xmlBlock, xhtmlDataDefinitionBlock, twitterFeedBlock, reference, template, xsltFormat, scriptFormat, user, group, role, assetFactory, contentType, destination, editorConfiguration, metadataSet, pageConfigurationSet, publishSet, dataDefinition, sharedField, site, workflowDefinition, workflowEmail, facebookConnector, wordPressConnector, googleAnalyticsConnector, fileSystemTransport, ftpTransport, databaseTransport, cloudTransport, assetFactoryContainer, contentTypeContainer, connectorContainer, pageConfigurationSetContainer, dataDefinitionContainer, sharedFieldContainer, metadataSetContainer, publishSetContainer, siteDestinationContainer, transportContainer, workflowDefinitionContainer, or workflowEmailContainer), with optional \`workflowConfiguration\` alongside it. Uses generated \`AssetProperties\` branch names; this MCP enforces exactly one concrete asset branch plus optional \`workflowConfiguration\`. Returns the new asset's ID on success.

Payload conventions (apply to every create call):
  - Send ONLY the fields you actually need to set. Every optional field should be omitted unless you have a real value to provide — Cascade applies its own defaults server-side. Do not pad payloads with "reasonable defaults" like \`reviewOnSchedule: false\` or \`shouldBePublished: true\` when you do not need to override them.
  - For every \`<thing>Id\` / \`<thing>Path\` pair (parentFolderId vs parentFolderPath, siteId vs siteName, contentTypeId vs contentTypePath, metadataSetId vs metadataSetPath, ...), prefer the id form when you know the id. Path is a valid fallback and Cascade resolves it server-side — don't round-trip through cascade_read just to look up an id.
  - Text encoding: rich-text fields (xhtml, WYSIWYG structuredData text, xmlBlock xml) must be well-formed XML — named HTML entities like \`&nbsp;\` and astral-plane Unicode (including emoji) crash the render. See resource \`cascade://text-encoding\` for the per-field-category rules.

Args:
  - asset (object, required): One concrete asset envelope. Key is the camelCase type; value is the asset body. Optional \`workflowConfiguration\` may be included alongside the concrete asset key. If workflowConfiguration is supplied, include workflowName, workflowComments, and workflowDefinitionId or workflowDefinitionPath.
    Common shapes (required fields plus representative optionals shown — omit optionals unless you need them):
      - { page: { name, parentFolderId OR parentFolderPath, siteId OR siteName, contentTypeId OR contentTypePath, xhtml OR structuredData, ... } }
      - { file: { name, parentFolderId OR parentFolderPath, siteId OR siteName, text OR data, ... } }
      - { folder: { name, parentFolderId OR parentFolderPath, siteId OR siteName, ... } }
      - { textBlock: { name, parentFolderId OR parentFolderPath, siteId OR siteName, text, ... } }
      - { xmlBlock: { name, parentFolderId OR parentFolderPath, siteId OR siteName, xml, ... } }
      - { symlink: { name, parentFolderId OR parentFolderPath, siteId OR siteName, linkURL?, ... } }
    Admin-area types (assetFactory, contentType, transports, workflow*, *Container) use \`parentContainerId/Path\` instead of \`parentFolderId/Path\`.

Returns:
  Cascade OperationResult:
  { success: true, createdAssetId: "<new asset id>" }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Create a page under /about" -> { asset: { page: { name: "team", parentFolderPath: "/about", siteName: "www", contentTypePath: "/standard-page", xhtml: "<p>Team</p>" } } }
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

Accepts the full asset body using the same envelope wrapper as cascade_create, with edit-specific validation. The workflow is symmetric when cascade_read is called with read_mode: "raw": remove read-only inner type fields from the raw asset envelope, modify the envelope, and pass it back to cascade_edit. Some asset types require a prior cascade_check_out.

Payload conventions:
  - Edit replaces the asset body, so send the full object as read — do not try to send only the fields you are changing.
  - When constructing an edit payload from scratch (not round-tripping a read), still omit optional fields you have no intention of setting; don't invent defaults.
  - Prefer id over path on every id/path pair (metadataSetId over metadataSetPath, etc.). Cascade resolves paths server-side.
  - Text encoding: same rules as cascade_create — rich-text fields must be well-formed XML with only the five XML built-in entities (\`&amp;\`, \`&lt;\`, \`&gt;\`, \`&quot;\`, \`&apos;\`). See resource \`cascade://text-encoding\`.

Args:
  - asset (object, required): One concrete asset envelope using the same wrapper as cascade_create, with edit-specific validation and optional workflowConfiguration alongside it. Include \`id\` when available/preferred. If workflowConfiguration is supplied, include workflowName, workflowComments, and workflowDefinitionId or workflowDefinitionPath.

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Update a page's metadata" -> Read first with cascade_read using read_mode: "raw"; remove read-only inner type fields; modify \`asset.page.metadata\`; pass { asset: raw.asset } back.
  - Use when: "Change a block's structured data" -> Read raw first; remove read-only inner type fields; modify the full xhtmlDataDefinitionBlock envelope; pass { asset: raw.asset }.
  - Use when: "Rewrite a symlink's target" -> Read raw first; remove read-only inner type fields; modify asset.symlink.linkURL on the full envelope; pass { asset: raw.asset }.
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

By default, deletion sends the asset to the recycle bin; deleteParameters can run workflow and optionally unpublish first. Site removal and root-folder path "/" removal are rejected; root-folder ID safeguards require generated tool-block rules. If the asset is under a workflow that requires review, workflowConfiguration specifies the approval flow. This is a DESTRUCTIVE operation — confirm intent before calling.

Args:
  - identifier (object, required): The asset to delete
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known
  - deleteParameters (object, optional): Controls delete behavior
    - doWorkflow (boolean, required if deleteParameters is provided): Whether to run the workflow on delete
    - unpublish (boolean | null, optional): Unpublish from destinations before deleting
    - destinations (array | null, optional): Destination identifiers for unpublish behavior
  - workflowConfiguration (object, optional): Generated WorkflowConfiguration. If supplied, include workflowName, workflowComments, and workflowDefinitionId or workflowDefinitionPath; workflowStepConfigurations are optional.

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Delete a page" -> { identifier: { type: "page", id: "..." } }
  - Use when: "Unpublish then delete" -> { identifier: { type: "page", id: "..." }, deleteParameters: { doWorkflow: false, unpublish: true } }
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
    - requires type plus either id or path; prefer id when known
  - moveParameters (object, required):
    - destinationContainerIdentifier (object, optional): Where to move the asset. Omit to keep in current container.
    - doWorkflow (boolean, required): Whether to run workflow on the move
    - newName (string, optional): New asset name. Omit to keep current name.
  - workflowConfiguration (object, optional): Generated WorkflowConfiguration. If supplied, include workflowName, workflowComments, and workflowDefinitionId or workflowDefinitionPath; workflowStepConfigurations are optional.

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
    - requires type plus either id or path; prefer id when known
  - copyParameters (object, required):
    - destinationContainerIdentifier (object, required): The container (folder/site) that will receive the copy
    - doWorkflow (boolean, required): Whether to run workflow on the copy
    - newName (string, required): Name for the new asset (must be unique within destination)
  - workflowConfiguration (object, optional): Generated WorkflowConfiguration. If supplied, include workflowName, workflowComments, and workflowDefinitionId or workflowDefinitionPath; workflowStepConfigurations are optional.

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
