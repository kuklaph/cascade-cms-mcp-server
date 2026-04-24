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
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import {
  ReadRequestSchema,
  CreateRequestSchema,
  EditRequestSchema,
  RemoveRequestSchema,
  MoveRequestSchema,
  CopyRequestSchema,
} from "../schemas/requests.js";

/**
 * Fields retained by the "summary" projection on a Cascade read result.
 *
 * Keeps only lightweight discovery fields — id, name, path, type, the
 * lastModifiedDate timestamp, and the metadata block. Everything else on
 * the asset entity (xhtml body, structuredData, file bytes, page
 * configurations, velocity/script bodies, etc.) is stripped.
 */
const SUMMARY_ALLOWLIST = [
  "id",
  "name",
  "path",
  "type",
  "lastModifiedDate",
  "metadata",
] as const;

/**
 * Project a Cascade `read` response down to the summary allowlist.
 *
 * The upstream shape is `{success, asset: {<typeKey>: {...}}}` where
 * `<typeKey>` is exactly one of `page`, `file`, `folder`, `block`,
 * `template`, etc. This helper projects that entity down to the
 * allowlisted fields. Returns the original result unchanged when:
 *   - input isn't an object,
 *   - `asset` is missing, non-object, or empty,
 *   - `asset` has more than one key (unfamiliar shape — fail safe),
 *   - the entity has none of the allowlisted fields (would project to
 *     an empty object, which is less useful than the original).
 *
 * Note: the allowlist (`id, name, path, type, lastModifiedDate, metadata`)
 * is sized for asset entities like page/file/folder/block. Other Cascade
 * entity types (user, workflow, transport, etc.) lack most of these
 * fields; on those, the empty-projection guard returns the original.
 */
function summarizeReadResult(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;

  const result = raw as Record<string, unknown>;
  const asset = result.asset;
  if (typeof asset !== "object" || asset === null) return raw;

  const assetRecord = asset as Record<string, unknown>;
  const typeKeys = Object.keys(assetRecord);
  // Guard against unfamiliar shapes: if `asset` has 0 or 2+ keys,
  // we can't safely pick "the entity" — return raw.
  if (typeKeys.length !== 1) return raw;

  const typeKey = typeKeys[0]!;
  const entity = assetRecord[typeKey];
  if (typeof entity !== "object" || entity === null) return raw;

  const entityRecord = entity as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of SUMMARY_ALLOWLIST) {
    if (field in entityRecord) {
      projected[field] = entityRecord[field];
    }
  }

  // If the entity has none of the allowlisted fields (e.g. a user,
  // workflow, or other entity type without id/name/path), the projection
  // would be an empty object — less useful than returning the original.
  if (Object.keys(projected).length === 0) return raw;

  return {
    ...result,
    asset: { [typeKey]: projected },
  };
}

export function registerCrudTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_read",
    title: "Read Cascade Asset",
    description: buildCascadeToolDescription(
      `Read an asset from Cascade CMS by identifier.

Retrieves the full representation of any Cascade asset (pages, files, folders, blocks, templates, workflows, etc.) given either an asset ID or a site-qualified path. Returns the complete asset data structure, including metadata, structured content, and parent-folder relationships.

Args:
  - identifier (object, required): The asset to read
    - id (string, optional): Cascade internal asset ID (e.g., "d3631e59ac1e..."). Takes priority over path when both are provided.
    - path (object, optional): Site-qualified path
      - path (string, required): Asset path within the site, starting from root (e.g., "/about/team")
      - siteId OR siteName (string): Which site the path belongs to
    - type (string, required): Entity type — one of the 56 EntityTypeString values (page, file, folder, block, template, etc.)
    - recycled (boolean, optional): Read from recycle bin.
  - response_detail (string, optional): 'full' (default, complete asset) or 'summary' (lean projection keeping only id, name, path, type, lastModifiedDate, metadata; strips xhtml, structuredData, file data, page configurations, and similar heavy fields). Use 'summary' to discover/describe an asset without loading its body.

Returns:
  Cascade OperationResult with the asset body:
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
      const detail = raw.response_detail;
      const { response_detail: _rd, ...rest } = raw;
      const result = await client.read(rest as unknown as Types.ReadRequest);
      return detail === "summary" ? summarizeReadResult(result) : result;
    },
  }, deps);

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

Accepts the full asset body (same envelope shape as cascade_create). The workflow is symmetric: cascade_read returns { asset: { <typeKey>: {...} } }; modify the inner object; pass the same envelope back to cascade_edit. Some asset types require a prior cascade_check_out.

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
