/**
 * Shared nested object schemas used inside Cascade asset payloads.
 *
 * Covers types that appear inside multiple concrete asset variants —
 * `Metadata`, `Tag`, `StructuredData` + `StructuredDataNode` (recursive),
 * `PageConfiguration`, `PageRegion`, and a re-exported Identifier for child
 * collections. Each object mirrors its generated cascade-cms-api TypeScript
 * definition.
 *
 * Everything is `.strict()` — every generated TypeScript field is modelled;
 * unknown keys are rejected so typos are caught early.
 */

import { z } from "zod";
import { IdentifierSchema } from "../common.js";
import {
  SerializationTypeSchema,
  StructuredDataAssetTypeSchema,
  StructuredDataTypeSchema,
} from "./enums.js";
import { objectWithRequiredAlternatives } from "../requiredAlternatives.js";

// ─── Tag ────────────────────────────────────────────────────────────────────

export const TagSchema = z
  .object({
    name: z.string().describe("REQUIRED: Tag value."),
  })
  .strict()
  .describe("Content tag. Used on every FolderContainedAsset-derived type.");

export type Tag = z.infer<typeof TagSchema>;

// ─── Metadata ───────────────────────────────────────────────────────────────

const FieldValueSchema = z
  .object({
    value: z.string().optional().describe("Value for a single dynamic-metadata option."),
  })
  .strict();

const DynamicMetadataFieldSchema = z
  .object({
    name: z.string().describe("REQUIRED: Dynamic metadata field name (matches the set's field definition)."),
    fieldValues: z.array(FieldValueSchema).optional().describe(
      "Zero or more values — single-select fields provide one value; multi-select fields provide several.",
    ),
  })
  .strict();

export const MetadataSchema = z
  .object({
    author: z.string().optional().describe("Dublin-core author."),
    displayName: z.string().optional().describe("Display name — often used in navigation."),
    endDate: z.string().optional().describe("Content end date (ISO 8601)."),
    keywords: z.string().optional().describe("Comma-separated keywords."),
    metaDescription: z.string().optional().describe("HTML meta-description tag content."),
    reviewDate: z.string().optional().describe("Scheduled review date (ISO 8601)."),
    startDate: z.string().optional().describe("Content start date (ISO 8601)."),
    summary: z.string().optional().describe("Short summary of the asset."),
    teaser: z.string().optional().describe("Teaser text."),
    title: z.string().optional().describe("Content title (distinct from the asset name)."),
    dynamicFields: z
      .array(DynamicMetadataFieldSchema)
      .optional()
      .describe(
        "Dynamic metadata defined by the asset's metadata set. Each field: { name, fieldValues: [{value}] }.",
      ),
  })
  .strict()
  .describe(
    "Wired + dynamic metadata for a content asset. Matches Cascade's Metadata type. All fields optional.",
  );

export type Metadata = z.infer<typeof MetadataSchema>;

// ─── StructuredData (recursive) ─────────────────────────────────────────────

/**
 * StructuredDataNode is self-referential — a group-type node may contain
 * child structured data nodes. Zod supports this via `z.lazy`.
 */
export type StructuredDataNode = {
  type: "text" | "asset" | "group";
  identifier: string;
  structuredDataNodes?: StructuredDataNode[];
  text?: string;
  assetType?: "block" | "file" | "page" | "symlink" | "page,file,symlink";
  blockId?: string;
  blockPath?: string;
  fileId?: string;
  filePath?: string;
  pageId?: string;
  pagePath?: string;
  symlinkId?: string;
  symlinkPath?: string;
  recycled?: boolean;
};

export const StructuredDataNodeSchema: z.ZodType<StructuredDataNode> = z.lazy(() =>
  z
    .object({
      type: StructuredDataTypeSchema.describe(
        "REQUIRED: Node kind — 'text' holds a string, 'asset' references another asset, 'group' contains child nodes.",
      ),
      identifier: z
        .string()
        .describe("REQUIRED: Stable identifier for this node within its definition."),
      structuredDataNodes: z
        .array(StructuredDataNodeSchema)
        .optional()
        .describe("Child nodes — only set when type === 'group'."),
      text: z
        .string()
        .optional()
        .describe("REQUIRED when type === 'text'. The node's string value."),
      assetType: StructuredDataAssetTypeSchema.optional().describe(
        "REQUIRED when type === 'asset'. Restricts which asset kinds may be referenced.",
      ),
      blockId: z.string().optional().describe("Block reference by id (when assetType includes 'block')."),
      blockPath: z.string().optional().describe("Block reference by path (alt)."),
      fileId: z.string().optional().describe("File reference by id."),
      filePath: z.string().optional().describe("File reference by path (alt)."),
      pageId: z.string().optional().describe("Page reference by id."),
      pagePath: z.string().optional().describe("Page reference by path (alt)."),
      symlinkId: z.string().optional().describe("Symlink reference by id."),
      symlinkPath: z.string().optional().describe("Symlink reference by path (alt)."),
      recycled: z.boolean().optional().describe("Read-only: true if the referenced asset is in the recycle bin."),
    })
    .strict(),
);

export const StructuredDataSchema = z
  .object({
    definitionId: z
      .string()
      .optional()
      .describe("Data definition id. Priority: definitionId > definitionPath."),
    definitionPath: z.string().optional().describe("Data definition path (alt)."),
    structuredDataNodes: z
      .array(StructuredDataNodeSchema)
      .optional()
      .describe("Tree of structured data nodes populating the definition."),
  })
  .strict()
  .describe(
    "Structured data content for a page or XHTML-datadefinition block. Shape of the nodes mirrors the data definition.",
  );

export type StructuredData = z.infer<typeof StructuredDataSchema>;

// ─── Page region ────────────────────────────────────────────────────────────

export const PageRegionSchema = z
  .object({
    id: z.string().optional().describe("Optional id — populated on read; omit on create/edit."),
    name: z.string().describe("REQUIRED: Region name matching the template region."),
    blockId: z.string().optional().describe("Block assigned to this region (by id). Priority: blockId > blockPath."),
    blockPath: z.string().optional().describe("Block assigned to this region (by path)."),
    blockRecycled: z.boolean().optional().describe("Read-only: true if the assigned block is recycled."),
    noBlock: z.boolean().optional().describe("Set true to explicitly clear any block assigned at a higher level. Default false."),
    formatId: z.string().optional().describe("Format assigned to this region (by id). Priority: formatId > formatPath."),
    formatPath: z.string().optional().describe("Format assigned to this region (by path)."),
    formatRecycled: z.boolean().optional().describe("Read-only: true if the assigned format is recycled."),
    noFormat: z.boolean().optional().describe("Set true to explicitly clear any format assigned at a higher level. Default false."),
  })
  .strict()
  .describe("A page region — named slot inside a template / page configuration.");

export type PageRegion = z.infer<typeof PageRegionSchema>;

// ─── Page configuration ─────────────────────────────────────────────────────

export const PageConfigurationSchema = z
  .object({
    id: z.string().optional().describe("Optional id — populated on read; omit on create."),
    name: z.string().describe("REQUIRED: Configuration name, unique within the set."),
    defaultConfiguration: z
      .boolean()
      .describe("REQUIRED: Whether this is the default configuration for its set."),
    templateId: z.string().optional().describe("Template backing this configuration (by id). Priority: templateId > templatePath."),
    templatePath: z.string().optional().describe("Template backing this configuration (by path)."),
    formatId: z.string().optional().describe("Default format for this configuration (by id)."),
    formatPath: z.string().optional().describe("Default format (by path)."),
    formatRecycled: z.boolean().optional().describe("Read-only: true if the assigned format is recycled."),
    pageRegions: z
      .array(PageRegionSchema)
      .optional()
      .describe("Page-level region/block/format overrides."),
    outputExtension: z.string().optional().describe("File extension applied on publish (e.g. '.html')."),
    serializationType: SerializationTypeSchema.optional().describe("Serialization format for the rendered output."),
    includeXMLDeclaration: z.boolean().optional().describe("Whether to emit an XML declaration on render."),
    publishable: z.boolean().optional().describe("Whether this configuration produces a publishable output."),
  })
  .strict()
  .describe("Page configuration — a named combination of template, format, and region assignments.");

export type PageConfiguration = z.infer<typeof PageConfigurationSchema>;

export const PageConfigurationSetPageConfigurationSchema = objectWithRequiredAlternatives(
  PageConfigurationSchema.shape,
  [["templateId", "templatePath"]],
  "Page configuration in a page configuration set — templateId or templatePath is required.",
);

export type PageConfigurationSetPageConfiguration = z.infer<
  typeof PageConfigurationSetPageConfigurationSchema
>;

// ─── Re-export Identifier so asset modules import from one place ────────────

export { IdentifierSchema } from "../common.js";
export type { Identifier } from "../common.js";

// ─── EmbeddedIdentifierSchema ───────────────────────────────────────────────
//
// Used for identifier arrays appearing INSIDE asset bodies (children,
// destinations, scheduled publish targets, etc.). Structurally identical to
// `IdentifierSchema` from common.ts but without the "id-or-path required"
// refinement. Round-trip from Cascade may return identifiers with only
// `type` or `recycled` populated; the request-side refine would reject
// those payloads on edit.

import { PathSchema } from "../common.js";
import { EntityTypeStringSchema } from "./enums.js";

export const EmbeddedIdentifierSchema = z
  .object({
    id: z.string().optional().describe("Asset id. Priority: id > path."),
    path: PathSchema.optional().describe("Asset path (alt to id)."),
    type: EntityTypeStringSchema.describe("REQUIRED: Entity type of the referenced asset."),
    recycled: z.boolean().optional().describe("True if the referenced asset is in the recycle bin."),
  })
  .strict()
  .describe(
    "Identifier embedded inside an asset body. Unlike the request-level IdentifierSchema, does not enforce 'id or path required' — Cascade may return type-only identifiers on read.",
  );

export type EmbeddedIdentifier = z.infer<typeof EmbeddedIdentifierSchema>;

const EmbeddedIdentifierFields = {
  type: EntityTypeStringSchema.describe("REQUIRED: Entity type of the referenced asset."),
  recycled: z.boolean().optional().describe("True if the referenced asset is in the recycle bin."),
};

export const EmbeddedWriteIdentifierSchema = z
  .union([
    z
      .object({
        ...EmbeddedIdentifierFields,
        id: z.string().describe("Asset id. Priority: id > path."),
        path: PathSchema.optional().describe("Asset path (alt to id)."),
      })
      .strict(),
    z
      .object({
        ...EmbeddedIdentifierFields,
        id: z.string().optional().describe("Asset id. Priority: id > path."),
        path: PathSchema.describe("Asset path (alt to id)."),
      })
      .strict(),
  ])
  .describe(
    "Identifier embedded inside a writeable asset body. Requires type plus either id or path; prefer id when available.",
  );

export type EmbeddedWriteIdentifier = z.infer<typeof EmbeddedWriteIdentifierSchema>;
