/**
 * Format / template asset schemas — XSLT formats, script formats, and
 * templates. All extend `FolderContainedAsset` (they live in folders and
 * accept tags, but do NOT carry metadata, expiration, or publish flags
 * on their own).
 */

import { z } from "zod";
import { FolderContainedAssetFields } from "./base.js";
import { PageRegionSchema } from "./nested.js";

// ─── XsltFormat (envelope: `xsltFormat`) ────────────────────────────────────

export const XsltFormatAssetSchema = z
  .object({
    ...FolderContainedAssetFields,
    xml: z.string().describe("REQUIRED: XSLT document body."),
  })
  .strict()
  .describe("XSLT format asset — an XSLT transformation applied during rendering.");

export type XsltFormatAsset = z.infer<typeof XsltFormatAssetSchema>;

export const XsltFormatEnvelopeSchema = z
  .object({
    xsltFormat: XsltFormatAssetSchema.describe("XSLT format payload."),
  })
  .strict();

// ─── ScriptFormat (envelope: `scriptFormat`) ────────────────────────────────

export const ScriptFormatAssetSchema = z
  .object({
    ...FolderContainedAssetFields,
    script: z.string().describe("REQUIRED: Velocity / script source body."),
  })
  .strict()
  .describe("Script format asset — Velocity/script-based rendering format.");

export type ScriptFormatAsset = z.infer<typeof ScriptFormatAssetSchema>;

export const ScriptFormatEnvelopeSchema = z
  .object({
    scriptFormat: ScriptFormatAssetSchema.describe("Script format payload."),
  })
  .strict();

// ─── Template (envelope: `template`) ────────────────────────────────────────

export const TemplateAssetSchema = z
  .object({
    ...FolderContainedAssetFields,
    formatId: z
      .string()
      .optional()
      .describe("Default format id applied when rendering this template."),
    formatPath: z
      .string()
      .optional()
      .describe("Default format path (alt)."),
    formatRecycled: z
      .boolean()
      .optional()
      .describe("Read-only: true if the default format is recycled."),
    xml: z.string().describe("REQUIRED: Template body (XHTML/XML)."),
    pageRegions: z
      .array(PageRegionSchema)
      .optional()
      .describe("Declared regions in this template. Omit to produce an empty-region template."),
  })
  .strict()
  .describe("Cascade template asset.");

export type TemplateAsset = z.infer<typeof TemplateAssetSchema>;

export const TemplateEnvelopeSchema = z
  .object({
    template: TemplateAssetSchema.describe("Template payload."),
  })
  .strict();
