/**
 * Base field definitions for Cascade asset inheritance chains.
 *
 * Cascade's OpenAPI spec builds every concrete asset via `allOf` from a small
 * set of base types:
 *
 *   BaseAsset
 *     └─ NamedAsset (+ name)
 *          ├─ FolderContainedAsset (+ parentFolderId/Path, siteId/Name, tags, ...)
 *          │    └─ DublinAwareAsset (+ metadata, metadataSetId/Path, review fields)
 *          │         └─ ExpiringAsset (+ expirationFolder*)
 *          │              └─ PublishableAsset (+ shouldBePublished, lastPublished*)
 *          └─ ContaineredAsset (admin-area — + parentContainerId/Path, siteId/Name)
 *
 * `Block` is an abstract alias for ExpiringAsset (no extra fields) and
 * `Group` extends BaseAsset directly (uses `groupName` instead of `name`).
 *
 * Each `*Fields` export below is a plain field bag that can be spread into a
 * `z.object({...}).strict()` definition, mirroring the OpenAPI composition.
 * All base fields are optional at the schema level — Cascade validates
 * "required on create" server-side (this schema is shared across create and
 * edit).
 *
 * A tolerant `type?: string` field is included on BaseAsset so the response
 * shape from `cascade_read` (which echoes the entity type) round-trips
 * through `cascade_edit` without rejection. Its value is informational; the
 * envelope key is the real discriminator.
 */

import { z } from "zod";
import { MetadataSchema, TagSchema } from "./nested.js";

// ─── BaseAsset ──────────────────────────────────────────────────────────────

export const BaseAssetFields = {
  id: z
    .string()
    .optional()
    .describe(
      "Asset id. Omit on create (Cascade assigns it); provide on edit to identify the target.",
    ),
  type: z
    .string()
    .optional()
    .describe(
      "Entity type — echoed by `cascade_read` responses and accepted here for round-trip compatibility. The envelope key is the true discriminator; this field is informational.",
    ),
};

// ─── NamedAsset = BaseAsset + name ─────────────────────────────────────────

export const NamedAssetFields = {
  ...BaseAssetFields,
  name: z
    .string()
    .describe(
      "Asset name. REQUIRED on create; ignored on edit — use the move operation to rename.",
    ),
};

// ─── FolderContainedAsset = NamedAsset + folder placement + site + audit ────

export const FolderContainedAssetFields = {
  ...NamedAssetFields,
  parentFolderId: z
    .string()
    .optional()
    .describe(
      "Parent folder id. REQUIRED on BOTH create and edit (use this or parentFolderPath). On edit, parent-folder fields identify the asset's current location — use cascade_move to relocate, not edit. Priority: parentFolderId > parentFolderPath.",
    ),
  parentFolderPath: z
    .string()
    .optional()
    .describe("Parent folder path. REQUIRED on BOTH create and edit (alt to parentFolderId). See cascade_move to relocate."),
  path: z
    .string()
    .optional()
    .describe("Current path of the asset. Read-only on create; may be present on edit."),
  lastModifiedDate: z.string().nullable().optional().describe("Read-only audit field."),
  lastModifiedBy: z.string().nullable().optional().describe("Read-only audit field."),
  createdDate: z.string().nullable().optional().describe("Read-only audit field."),
  createdBy: z.string().nullable().optional().describe("Read-only audit field."),
  siteId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Owning site id. REQUIRED (use this or siteName). Priority: siteId > siteName.",
    ),
  siteName: z
    .string()
    .nullable()
    .optional()
    .describe("Owning site name (alt to siteId)."),
  tags: z
    .array(TagSchema)
    .nullable()
    .optional()
    .describe("Content tags. Each: { name: string }."),
};

// ─── DublinAwareAsset = FolderContained + metadata ─────────────────────────

export const DublinAwareAssetFields = {
  ...FolderContainedAssetFields,
  metadata: MetadataSchema.optional().describe(
    "Wired and dynamic metadata (title, keywords, author, dynamicFields, ...).",
  ),
  metadataSetId: z
    .string()
    .optional()
    .describe("Metadata set id. Priority: metadataSetId > metadataSetPath."),
  metadataSetPath: z.string().optional().describe("Metadata set path (alt)."),
  reviewOnSchedule: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether Cascade sends periodic review reminders for this asset."),
  reviewEvery: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe("Review interval in days. Only meaningful when reviewOnSchedule=true."),
};

// ─── ExpiringAsset = DublinAware + expiration placement ────────────────────

export const ExpiringAssetFields = {
  ...DublinAwareAssetFields,
  expirationFolderId: z
    .string()
    .optional()
    .describe(
      "Folder to move the asset into when it expires. Priority: expirationFolderId > expirationFolderPath.",
    ),
  expirationFolderPath: z.string().optional().describe("Expiration folder path (alt)."),
  expirationFolderRecycled: z
    .boolean()
    .optional()
    .describe("Read-only: true if the configured expiration folder is recycled."),
};

// ─── PublishableAsset = Expiring + publish flags ───────────────────────────

export const PublishableAssetFields = {
  ...ExpiringAssetFields,
  shouldBePublished: z
    .boolean()
    .optional()
    .describe("Whether this asset is published when its site publishes. Default true."),
  shouldBeIndexed: z
    .boolean()
    .optional()
    .describe("Whether this asset appears in indexes. Default true."),
  lastPublishedDate: z.string().nullable().optional().describe("Read-only publish audit field."),
  lastPublishedBy: z.string().nullable().optional().describe("Read-only publish audit field."),
};

// ─── ContaineredAsset = NamedAsset + container placement + site ────────────
// Admin-area / system assets (contentType, workflowDefinition, etc.) live in
// containers, not folders. They do NOT inherit metadata, tags, or audit fields.

export const ContaineredAssetFields = {
  ...NamedAssetFields,
  parentContainerId: z
    .string()
    .optional()
    .describe(
      "Parent container id. REQUIRED on create. Priority: parentContainerId > parentContainerPath.",
    ),
  parentContainerPath: z
    .string()
    .optional()
    .describe("Parent container path (alt). REQUIRED on create if id not provided."),
  path: z
    .string()
    .optional()
    .describe("Current path of the asset. Omit on create; may be present on edit."),
  siteId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Owning site id. REQUIRED for per-site admin assets; omit for system-wide ones. Priority: siteId > siteName.",
    ),
  siteName: z
    .string()
    .nullable()
    .optional()
    .describe("Owning site name (alt to siteId)."),
};

// ─── Block (abstract) = ExpiringAsset ──────────────────────────────────────
// Block has no fields of its own; concrete blocks (TextBlock, FeedBlock, ...)
// extend ExpiringAsset directly.

export const BlockFields = { ...ExpiringAssetFields };
