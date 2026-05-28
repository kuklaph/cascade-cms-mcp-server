/**
 * Common Zod schemas shared across all Cascade CMS request schemas.
 *
 * Exports:
 *   - EntityTypeSchema: the EntityTypeString union used in identifier.type
 *   - PathSchema: an asset path with optional site id/name
 *   - IdentifierSchema: an asset identifier (id-or-path + required type)
 *   - ReadModeSchema: "preview" | "raw" (defaults to "preview"; cascade_read only)
 */

import { z } from "zod";

/**
 * Cascade entity type strings — the values accepted by `identifier.type` and
 * other identifier-level type fields.
 *
 * Cascade uses two parallel naming schemes for asset kinds that are easy to
 * confuse:
 *
 *   - **EntityType strings** (this schema): lowercase or snake_case
 *     identifiers used in identifier.type — e.g. 'page', 'file', 'folder',
 *     'contenttype', 'editorconfiguration', 'metadataset',
 *     'block_XHTML_DATADEFINITION', 'block_TEXT', 'format_XSLT',
 *     'transport_ftp', 'wordpressconnector'.
 *   - **Asset envelope keys** (see `src/schemas/assets.ts`): camelCase
 *     property names on the Asset body — e.g. 'contentType',
 *     'editorConfiguration', 'metadataSet', 'xhtmlDataDefinitionBlock',
 *     'textBlock', 'xsltFormat', 'ftpTransport', 'wordPressConnector'.
 *
 * A handful of types ('page', 'file', 'folder', 'symlink', 'template',
 * 'reference', 'destination', 'role', 'site', 'user', 'group', 'message',
 * 'workflow', 'format', 'block', 'transport', 'pageregion',
 * 'pageconfiguration') spell the same in both schemes; most do not. Only the
 * EntityType strings are valid as identifier.type — envelope keys must not
 * appear here.
 *
 * Mirrors `cascade-cms-api/types/types.d.ts::EntityTypeString`. The generated
 * TypeScript type is the source of truth for accepted MCP input values.
 */
export const EntityTypeSchema = z
  .enum([
    "assetfactory",
    "assetfactorycontainer",
    "block",
    "block_FEED",
    "block_INDEX",
    "block_TEXT",
    "block_XHTML_DATADEFINITION",
    "block_XML",
    "block_TWITTER_FEED",
    "connectorcontainer",
    "twitterconnector",
    "facebookconnector",
    "wordpressconnector",
    "googleanalyticsconnector",
    "contenttype",
    "contenttypecontainer",
    "destination",
    "editorconfiguration",
    "file",
    "folder",
    "group",
    "message",
    "metadataset",
    "metadatasetcontainer",
    "page",
    "pageconfigurationset",
    "pageconfiguration",
    "pageregion",
    "pageconfigurationsetcontainer",
    "publishset",
    "publishsetcontainer",
    "reference",
    "role",
    "datadefinition",
    "datadefinitioncontainer",
    "sharedfield",
    "sharedfieldcontainer",
    "format",
    "format_XSLT",
    "format_SCRIPT",
    "site",
    "sitedestinationcontainer",
    "symlink",
    "template",
    "transport",
    "transport_fs",
    "transport_ftp",
    "transport_db",
    "transport_cloud",
    "transportcontainer",
    "user",
    "workflow",
    "workflowdefinition",
    "workflowdefinitioncontainer",
    "workflowemail",
    "workflowemailcontainer",
  ])
  .describe(
    "Cascade CMS asset type discriminator — used in identifier.type. Values are EntityType strings from cascade-cms-api generated TypeScript types: 'page', 'file', 'folder', 'block', 'symlink', 'template', 'contenttype', 'editorconfiguration', 'metadataset', 'block_TEXT', 'block_XML', 'block_FEED', 'block_INDEX', 'block_XHTML_DATADEFINITION', 'block_TWITTER_FEED', 'format_XSLT', 'format_SCRIPT', 'transport_fs', 'transport_ftp', 'transport_db', 'transport_cloud', 'facebookconnector', 'twitterconnector', 'wordpressconnector', 'googleanalyticsconnector', etc.",
  );

export type EntityType = z.infer<typeof EntityTypeSchema>;

export const PathSchema = z
  .object({
    path: z
      .string()
      .min(1, "path must not be empty")
      .describe(
        "Asset path within a site, starting from root (e.g. '/about/team'). Works only for non-recycled assets. When reading a site, set this to the site's name.",
      ),
    siteId: z
      .string()
      .optional()
      .describe(
        "Optional site ID. Takes precedence over siteName when both are provided.",
      ),
    siteName: z
      .string()
      .optional()
      .describe(
        "Optional site name. Used to resolve the path if siteId is not supplied.",
      ),
  })
  .strict()
  .describe(
    "Fully qualified path to an asset. Pair `path` with one of siteId/siteName to disambiguate across sites.",
  );

export type Path = z.infer<typeof PathSchema>;

const IdentifierFields = {
  type: EntityTypeSchema.describe(
    "REQUIRED: The entity type of this asset. Use the EntityTypeString literal from cascade-cms-api generated TypeScript types. Most values differ from Asset body envelope keys — e.g. identifier uses 'block_XHTML_DATADEFINITION' / 'block_TEXT' / 'format_XSLT' / 'transport_ftp' / 'contenttype' / 'editorconfiguration' / 'wordpressconnector', while the Asset body envelope uses 'xhtmlDataDefinitionBlock' / 'textBlock' / 'xsltFormat' / 'ftpTransport' / 'contentType' / 'editorConfiguration' / 'wordPressConnector'. See cascade://entity-types for the full list.",
  ),
  recycled: z
    .boolean()
    .optional()
    .describe(
      "Set true to target an asset inside the recycle bin. For reading only; ignored on edit/copy/move.",
    ),
};

export const IdentifierSchema = z
  .union([
    z
      .object({
        ...IdentifierFields,
        id: z
          .string()
          .describe(
            "Asset ID. Prefer this over path whenever the ID is known — IDs are stable across moves/renames and, when both are supplied, id takes precedence. One of `id` or `path` is required.",
          ),
        path: PathSchema.optional().describe(
          "Asset path object (path + site). A valid fallback when the id is unknown, or when working from a known path is more natural. Cascade resolves path→id server-side, so there is no need to read the asset first just to get the id. Works only for non-recycled assets. One of `id` or `path` is required.",
        ),
      })
      .strict(),
    z
      .object({
        ...IdentifierFields,
        id: z
          .string()
          .optional()
          .describe(
            "Asset ID. Prefer this over path whenever the ID is known — IDs are stable across moves/renames and, when both are supplied, id takes precedence. One of `id` or `path` is required.",
          ),
        path: PathSchema.describe(
          "Asset path object (path + site). A valid fallback when the id is unknown, or when working from a known path is more natural. Cascade resolves path→id server-side, so there is no need to read the asset first just to get the id. Works only for non-recycled assets. One of `id` or `path` is required.",
        ),
      })
      .strict(),
  ])
  .describe(
    "Uniquely identifies a Cascade asset. Supply either `id` (preferred when known) or `path` plus the asset `type`. This id-over-path preference applies to every id/path pair Cascade exposes (parentFolderId vs parentFolderPath, siteId vs siteName, etc.).",
  );

export type Identifier = z.infer<typeof IdentifierSchema>;

export const ReadModeSchema = z
  .enum(["preview", "raw"])
  .default("preview")
  .describe(
    "Read mode for cascade_read. 'preview' (default) returns a compact asset_handle plus nodelet outline for structured assets. 'raw' returns the full Cascade REST payload and can be expensive for pages or data-definition blocks.",
  );

export type ReadMode = z.infer<typeof ReadModeSchema>;
