/**
 * Block asset schemas — six distinct block kinds, each keyed under its own
 * Asset envelope property.
 *
 * Cascade does NOT expose a generic `block` envelope key; every block type
 * has its own property on the `Asset` object. Envelope keys: `feedBlock`,
 * `indexBlock`, `textBlock`, `xhtmlDataDefinitionBlock`, `xmlBlock`,
 * `twitterFeedBlock`.
 *
 * All block variants extend `ExpiringAsset` (via the generated `Block` alias).
 * They inherit the full folder-contained + metadata +
 * expiration field set but NOT the publish flags.
 */

import { z } from "zod";
import { BlockFields } from "./base.js";
import {
  IndexBlockPageXmlSchema,
  IndexBlockRenderingBehaviorSchema,
  IndexBlockSortMethodSchema,
  IndexBlockSortOrderSchema,
  IndexBlockTypeSchema,
  TwitterQueryTypeSchema,
} from "./enums.js";
import { StructuredDataSchema } from "./nested.js";

// ─── FeedBlock (envelope: `feedBlock`) ──────────────────────────────────────

export const FeedBlockAssetSchema = z
  .object({
    ...BlockFields,
    feedURL: z
      .string()
      .describe("REQUIRED: URL of the XML feed this block renders."),
  })
  .strict()
  .describe("Feed block — renders an external XML feed into page output.");

export type FeedBlockAsset = z.infer<typeof FeedBlockAssetSchema>;

export const FeedBlockEnvelopeSchema = z
  .object({
    feedBlock: FeedBlockAssetSchema.describe("Feed block payload."),
  })
  .strict();

// ─── IndexBlock (envelope: `indexBlock`) ────────────────────────────────────

export const IndexBlockAssetSchema = z
  .object({
    ...BlockFields,
    indexBlockType: IndexBlockTypeSchema.optional().describe(
      "Source of indexed items — 'folder' (default) or 'content-type'.",
    ),
    indexedFolderId: z
      .string()
      .optional()
      .describe(
        "Folder indexed when indexBlockType='folder'. Priority: indexedFolderId > indexedFolderPath.",
      ),
    indexedFolderPath: z.string().optional().describe("Indexed folder path (alt)."),
    indexedContentTypeId: z
      .string()
      .optional()
      .describe(
        "Content type indexed when indexBlockType='content-type'. Priority: indexedContentTypeId > indexedContentTypePath.",
      ),
    indexedContentTypePath: z
      .string()
      .optional()
      .describe("Indexed content type path (alt)."),
    indexedFolderRecycled: z
      .boolean()
      .optional()
      .describe("Read-only: true if the indexed folder is recycled."),
    maxRenderedAssets: z
      .number()
      .describe("REQUIRED: Maximum number of assets to include in the rendered output."),
    depthOfIndex: z
      .number()
      .describe("REQUIRED: How many levels of children to descend into."),
    renderingBehavior: IndexBlockRenderingBehaviorSchema.optional().describe(
      "How the index tree is walked during render. Default 'render-normally'.",
    ),
    indexPages: z.boolean().optional().describe("Include page assets in the index. Default false."),
    indexBlocks: z.boolean().optional().describe("Include block assets in the index. Default false."),
    indexLinks: z.boolean().optional().describe("Include symlink assets in the index. Default false."),
    indexFiles: z.boolean().optional().describe("Include file assets in the index. Default false."),
    indexRegularContent: z
      .boolean()
      .optional()
      .describe("Include structured-data / wysiwyg content in the index. Default false."),
    indexSystemMetadata: z
      .boolean()
      .optional()
      .describe("Include system metadata (created/modified dates, ids). Default false."),
    indexUserMetadata: z
      .boolean()
      .optional()
      .describe("Include wired and dynamic user metadata. Default false."),
    indexAccessRights: z
      .boolean()
      .optional()
      .describe("Include access-rights info in the index. Default false."),
    indexTags: z.boolean().optional().describe("Include tags. Default false."),
    indexUserInfo: z
      .boolean()
      .optional()
      .describe("Include lastModifiedBy / createdBy user info. Default false."),
    indexWorkflowInfo: z.boolean().optional().describe("Include active-workflow info. Default false."),
    appendCallingPageData: z
      .boolean()
      .optional()
      .describe("Append the calling page's data to the output. Default false."),
    sortMethod: IndexBlockSortMethodSchema.optional().describe(
      "How to sort indexed assets. Defaults: 'folder-order' for folder-type, 'alphabetical' for content-type.",
    ),
    sortOrder: IndexBlockSortOrderSchema.optional().describe(
      "Ascending or descending sort direction. Default 'ascending'.",
    ),
    pageXML: IndexBlockPageXmlSchema.optional().describe(
      "Whether to emit a page-XML shell. Default 'no-render'.",
    ),
  })
  .strict()
  .describe("Index block — renders a listing of Cascade assets.");

export type IndexBlockAsset = z.infer<typeof IndexBlockAssetSchema>;

export const IndexBlockEnvelopeSchema = z
  .object({
    indexBlock: IndexBlockAssetSchema.describe("Index block payload."),
  })
  .strict();

// ─── TextBlock (envelope: `textBlock`) ──────────────────────────────────────

export const TextBlockAssetSchema = z
  .object({
    ...BlockFields,
    text: z.string().describe("REQUIRED: The block's plaintext content."),
  })
  .strict()
  .describe("Plaintext block.");

export type TextBlockAsset = z.infer<typeof TextBlockAssetSchema>;

export const TextBlockEnvelopeSchema = z
  .object({
    textBlock: TextBlockAssetSchema.describe("Text block payload."),
  })
  .strict();

// ─── XhtmlDataDefinitionBlock (envelope: `xhtmlDataDefinitionBlock`) ────────

export const XhtmlDataDefinitionBlockAssetSchema = z
  .object({
    ...BlockFields,
    structuredData: StructuredDataSchema.optional().describe(
      "Structured data content. One of xhtml/structuredData REQUIRED. Priority: xhtml > structuredData.",
    ),
    xhtml: z
      .string()
      .optional()
      .describe("WYSIWYG XHTML content. Priority: xhtml > structuredData."),
  })
  .strict()
  .describe(
    "XHTML / data-definition block — may hold either raw WYSIWYG content or structured data from a definition.",
  );

export type XhtmlDataDefinitionBlockAsset = z.infer<typeof XhtmlDataDefinitionBlockAssetSchema>;

export const XhtmlDataDefinitionBlockEnvelopeSchema = z
  .object({
    xhtmlDataDefinitionBlock: XhtmlDataDefinitionBlockAssetSchema.describe(
      "XHTML/data-definition block payload.",
    ),
  })
  .strict();

// ─── XmlBlock (envelope: `xmlBlock`) ────────────────────────────────────────

export const XmlBlockAssetSchema = z
  .object({
    ...BlockFields,
    xml: z.string().describe("REQUIRED: Raw XML content for the block."),
  })
  .strict()
  .describe("XML block — raw XML passed through to render.");

export type XmlBlockAsset = z.infer<typeof XmlBlockAssetSchema>;

export const XmlBlockEnvelopeSchema = z
  .object({
    xmlBlock: XmlBlockAssetSchema.describe("XML block payload."),
  })
  .strict();

// ─── TwitterFeedBlock (envelope: `twitterFeedBlock`) ────────────────────────

export const TwitterFeedBlockAssetSchema = z
  .object({
    ...BlockFields,
    accountName: z
      .string()
      .optional()
      .describe(
        "Twitter account name. REQUIRED when queryType is 'user-only' or 'users-and-mentions'.",
      ),
    searchString: z
      .string()
      .optional()
      .describe("Search string. REQUIRED when queryType is 'search-terms'."),
    maxResults: z
      .number()
      .describe("REQUIRED: Maximum number of tweets to render."),
    useDefaultStyle: z
      .boolean()
      .describe("REQUIRED: Whether to apply Cascade's default Twitter styling."),
    excludeJQuery: z
      .boolean()
      .describe("REQUIRED: Whether the embed should skip loading jQuery."),
    queryType: TwitterQueryTypeSchema.describe(
      "REQUIRED: Query type — 'user-only', 'users-and-mentions', or 'search-terms'.",
    ),
  })
  .strict()
  .describe("Twitter feed block — renders a Twitter widget based on user or search query.");

export type TwitterFeedBlockAsset = z.infer<typeof TwitterFeedBlockAssetSchema>;

export const TwitterFeedBlockEnvelopeSchema = z
  .object({
    twitterFeedBlock: TwitterFeedBlockAssetSchema.describe("Twitter feed block payload."),
  })
  .strict();
