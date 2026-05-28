/**
 * Content asset schemas — page, file, folder, symlink, reference.
 *
 * Each inner object mirrors its generated cascade-cms-api TypeScript
 * counterpart, inheriting base fields via the `*Fields` bags from `./base.ts`.
 * Envelope wrappers live at the bottom; each is `.strict()` so only the
 * expected single typed key is accepted.
 */

import { z } from "zod";
import {
  FolderContainedAssetFields,
  ExpiringAssetFields,
  PublishableAssetFields,
} from "./base.js";
import {
  EntityTypeStringSchema,
  LinkRewritingSchema,
} from "./enums.js";
import {
  EmbeddedIdentifierSchema,
  EmbeddedWriteIdentifierSchema,
  PageConfigurationSchema,
  StructuredDataSchema,
} from "./nested.js";
import { objectWithRequiredAlternatives } from "../requiredAlternatives.js";

// ─── Page (envelope: `page`) ────────────────────────────────────────────────

export const PageAssetSchema = z
  .object({
    ...PublishableAssetFields,
    configurationSetId: z
      .string()
      .optional()
      .describe(
        "Page configuration set id. One of (contentTypeId > contentTypePath) > (configurationSetId > configurationSetPath) is REQUIRED on create.",
      ),
    configurationSetPath: z
      .string()
      .optional()
      .describe("Page configuration set path (alt to configurationSetId)."),
    contentTypeId: z
      .string()
      .optional()
      .describe("Content type id (preferred over configurationSet — uses the type's default config set)."),
    contentTypePath: z
      .string()
      .optional()
      .describe("Content type path (alt to contentTypeId)."),
    structuredData: StructuredDataSchema.optional().describe(
      "Structured data content. One of xhtml/structuredData REQUIRED. Priority: xhtml > structuredData.",
    ),
    xhtml: z
      .string()
      .optional()
      .describe("XHTML content for WYSIWYG pages. Priority: xhtml > structuredData."),
    pageConfigurations: z
      .array(PageConfigurationSchema)
      .optional()
      .describe(
        "Page-level region/block/format assignments. REQUIRED on edit to preserve existing assignments.",
      ),
    linkRewriting: LinkRewritingSchema.optional().describe(
      "Link-rewriting mode for this page. Default 'inherit'.",
    ),
  })
  .strict()
  .describe("Cascade page asset.");

export type PageAsset = z.infer<typeof PageAssetSchema>;

export const PageEnvelopeSchema = z
  .object({
    page: PageAssetSchema.describe("The page payload keyed under the `page` envelope."),
  })
  .strict();

// ─── File (envelope: `file`) ────────────────────────────────────────────────

export const FileAssetSchema = z
  .object({
    ...PublishableAssetFields,
    text: z
      .string()
      .optional()
      .describe(
        "Plaintext file content. One of text/data REQUIRED on create. Priority: text > data.",
      ),
    data: z
      .array(z.number().describe("Binary data number."))
      .optional()
      .describe("Binary content as a byte array. Used for non-text files."),
    rewriteLinks: z
      .boolean()
      .optional()
      .describe("Whether to rewrite links inside the file's content on publish."),
    linkRewriting: LinkRewritingSchema.optional().describe(
      "Link-rewriting mode for this file. Default 'inherit'.",
    ),
  })
  .strict()
  .describe("Cascade file asset (plaintext or binary).");

export type FileAsset = z.infer<typeof FileAssetSchema>;

export const FileEnvelopeSchema = z
  .object({
    file: FileAssetSchema.describe("The file payload keyed under the `file` envelope."),
  })
  .strict();

// ─── Folder (envelope: `folder`) ────────────────────────────────────────────

export const FolderAssetSchema = z
  .object({
    ...PublishableAssetFields,
    children: z
      .array(EmbeddedWriteIdentifierSchema)
      .optional()
      .describe("Child Identifier objects. If supplied in a write payload, each child requires id or path."),
    includeInStaleContent: z
      .boolean()
      .optional()
      .describe("Whether this folder participates in stale-content reports."),
  })
  .strict()
  .describe("Cascade folder asset.");

export type FolderAsset = z.infer<typeof FolderAssetSchema>;

export const FolderEnvelopeSchema = z
  .object({
    folder: FolderAssetSchema.describe("The folder payload keyed under the `folder` envelope."),
  })
  .strict();

// ─── Symlink (envelope: `symlink`) ──────────────────────────────────────────
// Symlink extends ExpiringAsset (NOT PublishableAsset).

export const SymlinkAssetSchema = z
  .object({
    ...ExpiringAssetFields,
    linkURL: z
      .string()
      .optional()
      .describe("Fully qualified URL this symlink points to (e.g. 'https://example.com')."),
  })
  .strict()
  .describe("Cascade symlink asset — a hyperlink asset, NOT a filesystem symlink.");

export type SymlinkAsset = z.infer<typeof SymlinkAssetSchema>;

export const SymlinkEnvelopeSchema = z
  .object({
    symlink: SymlinkAssetSchema.describe("The symlink payload keyed under the `symlink` envelope."),
  })
  .strict();

// ─── Reference (envelope: `reference`) ──────────────────────────────────────
// Reference extends FolderContainedAsset — no metadata, expiration, or publish flags.

const ReferenceAssetShape = {
  ...FolderContainedAssetFields,
  referencedAssetId: z
    .string()
    .optional()
    .describe(
      "Referenced asset id. One of referencedAssetId/referencedAssetPath REQUIRED. Priority: id > path.",
    ),
  referencedAssetPath: z
    .string()
    .optional()
    .describe("Referenced asset path (alt)."),
  referencedAssetType: EntityTypeStringSchema.describe(
    "REQUIRED: Entity type of the referenced asset.",
  ),
};

export const ReferenceAssetSchema = objectWithRequiredAlternatives(
  ReferenceAssetShape,
  [["referencedAssetId", "referencedAssetPath"]],
  "Cascade reference asset — a pointer to another asset in the same or another site.",
);

export type ReferenceAsset = z.infer<typeof ReferenceAssetSchema>;

export const ReferenceEnvelopeSchema = z
  .object({
    reference: ReferenceAssetSchema.describe("The reference payload keyed under the `reference` envelope."),
  })
  .strict();
