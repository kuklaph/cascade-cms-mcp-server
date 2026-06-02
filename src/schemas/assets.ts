/**
 * Zod schemas for Cascade CMS asset inputs — `AssetInputSchema` and friends.
 *
 * Cascade's REST API models concrete asset payloads as a tagged-envelope object:
 *
 *     { <typeKey>: { ...fields } }
 *
 * where `<typeKey>` is one of the concrete camelCase asset property names on
 * the generated `cascade-cms-api` TypeScript `AssetProperties` type. Each concrete Cascade type
 * (Page, File, TextBlock, Template, User, ...) is keyed under its own
 * property. `workflowConfiguration` is a companion property on generated
 * `AssetProperties` under the `asset` wrapper, not a standalone concrete asset
 * branch. This file assembles per-variant Zod schemas
 * from the `./assets/` sub-modules into a single union that mirrors the installed API types.
 *
 * Design notes:
 *
 * - **Shape mirror**. Every field declared in the installed generated
 *   TypeScript types is present here with the correct required/optional marker.
 *   Unknown keys on an asset object are rejected (`.strict()`) to catch
 *   typos early. Read responses may include server-only fields; create/edit
 *   input validation stays aligned to the generated request type surface.
 *
 * - **Required alternatives**. Generated `RequireAtLeastOne` /
 *   `RequireExactlyOne` declarations and create/edit comments define
 *   id/path-style alternatives. This file turns those groups into
 *   JSON-schema-visible unions for tool inputs.
 *
 * - **Union, not discriminated union**. Envelope keys are object keys, not
 *   fields — Zod's `discriminatedUnion` requires a discriminator field, so
 *   we use `z.union` instead. Error messages on invalid shapes list every
 *   branch that failed to match; the caller's tool description points
 *   agents to the correct envelope.
 */

import { z } from "zod";

// ─── Envelope schemas from sub-modules ─────────────────────────────────────

import {
  PageEnvelopeSchema,
  FileEnvelopeSchema,
  FolderEnvelopeSchema,
  SymlinkEnvelopeSchema,
  ReferenceEnvelopeSchema,
} from "./assets/content.js";
import {
  FeedBlockEnvelopeSchema,
  IndexBlockEnvelopeSchema,
  TextBlockEnvelopeSchema,
  XhtmlDataDefinitionBlockEnvelopeSchema,
  XmlBlockEnvelopeSchema,
  TwitterFeedBlockEnvelopeSchema,
} from "./assets/blocks.js";
import {
  XsltFormatEnvelopeSchema,
  ScriptFormatEnvelopeSchema,
  TemplateEnvelopeSchema,
} from "./assets/formats.js";
import {
  UserEnvelopeSchema,
  GroupEnvelopeSchema,
  RoleEnvelopeSchema,
} from "./assets/admin.js";
import {
  FacebookConnectorEnvelopeSchema,
  WordPressConnectorEnvelopeSchema,
  GoogleAnalyticsConnectorEnvelopeSchema,
} from "./assets/connectors.js";
import {
  FileSystemTransportEnvelopeSchema,
  FtpTransportEnvelopeSchema,
  DatabaseTransportEnvelopeSchema,
  CloudTransportEnvelopeSchema,
} from "./assets/transports.js";
import {
  WorkflowDefinitionEnvelopeSchema,
  WorkflowEmailEnvelopeSchema,
  WorkflowConfigurationSchema,
} from "./assets/workflow.js";
import {
  AssetFactoryEnvelopeSchema,
  ContentTypeEnvelopeSchema,
  DestinationEnvelopeSchema,
  EditorConfigurationEnvelopeSchema,
  MetadataSetEnvelopeSchema,
  PageConfigurationSetEnvelopeSchema,
  PublishSetEnvelopeSchema,
  DataDefinitionEnvelopeSchema,
  SharedFieldEnvelopeSchema,
  SiteEnvelopeSchema,
} from "./assets/config.js";
import {
  AssetFactoryContainerEnvelopeSchema,
  ContentTypeContainerEnvelopeSchema,
  ConnectorContainerEnvelopeSchema,
  PageConfigurationSetContainerEnvelopeSchema,
  DataDefinitionContainerEnvelopeSchema,
  SharedFieldContainerEnvelopeSchema,
  MetadataSetContainerEnvelopeSchema,
  PublishSetContainerEnvelopeSchema,
  SiteDestinationContainerEnvelopeSchema,
  TransportContainerEnvelopeSchema,
  WorkflowDefinitionContainerEnvelopeSchema,
  WorkflowEmailContainerEnvelopeSchema,
} from "./assets/containers.js";
import { objectWithRequiredAlternatives } from "./requiredAlternatives.js";

export const ASSET_ENVELOPE_KEYS = [
  "feedBlock",
  "indexBlock",
  "textBlock",
  "xhtmlDataDefinitionBlock",
  "xmlBlock",
  "twitterFeedBlock",
  "file",
  "folder",
  "page",
  "reference",
  "xsltFormat",
  "scriptFormat",
  "symlink",
  "template",
  "user",
  "group",
  "role",
  "assetFactory",
  "assetFactoryContainer",
  "contentType",
  "contentTypeContainer",
  "connectorContainer",
  "facebookConnector",
  "wordPressConnector",
  "googleAnalyticsConnector",
  "pageConfigurationSet",
  "pageConfigurationSetContainer",
  "dataDefinition",
  "dataDefinitionContainer",
  "sharedField",
  "sharedFieldContainer",
  "metadataSet",
  "metadataSetContainer",
  "publishSet",
  "publishSetContainer",
  "siteDestinationContainer",
  "destination",
  "fileSystemTransport",
  "ftpTransport",
  "databaseTransport",
  "cloudTransport",
  "transportContainer",
  "workflowDefinition",
  "workflowDefinitionContainer",
  "workflowEmail",
  "workflowEmailContainer",
  "site",
  "editorConfiguration",
] as const;

export type AssetEnvelopeKey = (typeof ASSET_ENVELOPE_KEYS)[number];

// ─── AssetInputSchema: the envelope union ───────────────────────────────────

const withWorkflowConfiguration = <TSchema extends z.ZodObject<z.ZodRawShape>>(
  schema: TSchema,
) =>
  schema
    .extend({
      workflowConfiguration: WorkflowConfigurationSchema.optional().describe(
        "Optional workflow configuration accompanying this asset operation.",
      ),
    })
    .strict();

const singleEnvelopeEntry = (
  schema: z.ZodObject<z.ZodRawShape>,
): [string, z.ZodTypeAny] => {
  const entries = Object.entries(schema.shape);
  if (entries.length !== 1) {
    throw new Error("Asset envelope schema must contain exactly one asset key");
  }
  return entries[0] as [string, z.ZodTypeAny];
};

const createRequiredAlternativeGroups = (): string[][] => [
  ["parentFolderId", "parentFolderPath"],
  ["parentContainerId", "parentContainerPath"],
  ["siteId", "siteName"],
  ["contentTypeId", "contentTypePath", "configurationSetId", "configurationSetPath"],
  ["xhtml", "structuredData"],
  ["text", "data"],
];

const editRequiredAlternativeGroups = (): string[][] => [
  ["siteId", "siteName"],
  ["contentTypeId", "contentTypePath", "configurationSetId", "configurationSetPath"],
  ["xhtml", "structuredData"],
  ["text", "data"],
];

const unionOptions = (schemas: z.ZodTypeAny[]): z.ZodTypeAny => {
  if (schemas.length === 0) {
    throw new Error("Expected at least one asset schema option");
  }
  if (schemas.length === 1) return schemas[0];
  return z.union(
    schemas as [
      z.ZodTypeAny,
      z.ZodTypeAny,
      ...z.ZodTypeAny[],
    ],
  );
};

const objectSchemaOptions = (
  schema: z.ZodTypeAny,
): z.ZodObject<z.ZodRawShape>[] | null => {
  if (schema instanceof z.ZodObject) return [schema];
  if (schema instanceof z.ZodUnion) {
    const options = schema.options as z.ZodTypeAny[];
    if (options.every((option) => option instanceof z.ZodObject)) {
      return options as z.ZodObject<z.ZodRawShape>[];
    }
  }
  return null;
};

const createEnvelopeSchema = (schema: z.ZodObject<z.ZodRawShape>) => {
  const [key, inner] = singleEnvelopeEntry(schema);
  const options = objectSchemaOptions(inner);
  if (!options) return schema;
  return z
    .object({
      [key]: unionOptions(
        options.map((option) => {
          const { id: _id, ...createShape } = option.shape;
          if (key === "editorConfiguration") {
            return editorConfigurationWithConditionalSite(
              createShape,
              option.description,
            );
          }
          return objectWithRequiredAlternatives(
            createShape,
            createRequiredAlternativeGroups(),
            option.description,
          );
        }),
      ),
    })
    .strict();
};

const editEnvelopeSchema = (schema: z.ZodObject<z.ZodRawShape>) => {
  const [key, inner] = singleEnvelopeEntry(schema);
  const options = objectSchemaOptions(inner);
  if (!options) return schema;
  return z
    .object({
      [key]: unionOptions(
        options.map((option) =>
          key === "editorConfiguration"
            ? editorConfigurationWithConditionalSite(
                option.shape,
                option.description,
              )
            : objectWithRequiredAlternatives(
                option.shape,
                editRequiredAlternativeGroups(),
                option.description,
              ),
        ),
      ),
    })
    .strict();
};

const editorConfigurationWithConditionalSite = (
  shape: z.ZodRawShape,
  description: string | undefined,
): z.ZodTypeAny =>
  z.union([
    objectWithRequiredAlternatives(
      shape,
      [["siteId", "siteName"]],
      description,
    ),
    strictObjectFromShape(shape, description).superRefine((value, ctx) => {
      if (value.id === "DEFAULT" || value.name === "Default") return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "siteId or siteName is required unless this is the system default editor configuration (id=DEFAULT or name=Default).",
        path: ["siteName"],
      });
    }),
  ]);

const strictObjectFromShape = (
  shape: z.ZodRawShape,
  description: string | undefined,
) => {
  const schema = z.object(shape).strict();
  return description ? schema.describe(description) : schema;
};

/**
 * Envelope union over every type-keyed property on Cascade's `Asset`
 * schema. The accepted shape is always `{ <oneTypeKey>: { ...fields } }`,
 * with optional `workflowConfiguration` alongside that concrete key.
 * Plain `z.union` — the discriminator is the object key itself, which
 * `z.discriminatedUnion` cannot express (it requires a discriminator
 * field).
 *
 * Listing groups the upstream concrete `Asset` properties by asset family.
 */
export const AssetInputSchema = z
  .union([
    // Blocks
    withWorkflowConfiguration(FeedBlockEnvelopeSchema),
    withWorkflowConfiguration(IndexBlockEnvelopeSchema),
    withWorkflowConfiguration(TextBlockEnvelopeSchema),
    withWorkflowConfiguration(XhtmlDataDefinitionBlockEnvelopeSchema),
    withWorkflowConfiguration(XmlBlockEnvelopeSchema),
    withWorkflowConfiguration(TwitterFeedBlockEnvelopeSchema),

    // Core content
    withWorkflowConfiguration(FileEnvelopeSchema),
    withWorkflowConfiguration(FolderEnvelopeSchema),
    withWorkflowConfiguration(PageEnvelopeSchema),
    withWorkflowConfiguration(ReferenceEnvelopeSchema),

    // Formats + template
    withWorkflowConfiguration(XsltFormatEnvelopeSchema),
    withWorkflowConfiguration(ScriptFormatEnvelopeSchema),
    withWorkflowConfiguration(SymlinkEnvelopeSchema),
    withWorkflowConfiguration(TemplateEnvelopeSchema),

    // Admin-area principals
    withWorkflowConfiguration(UserEnvelopeSchema),
    withWorkflowConfiguration(GroupEnvelopeSchema),
    withWorkflowConfiguration(RoleEnvelopeSchema),

    // Asset factory + container
    withWorkflowConfiguration(AssetFactoryEnvelopeSchema),
    withWorkflowConfiguration(AssetFactoryContainerEnvelopeSchema),

    // Content type + container
    withWorkflowConfiguration(ContentTypeEnvelopeSchema),
    withWorkflowConfiguration(ContentTypeContainerEnvelopeSchema),

    // Connectors
    withWorkflowConfiguration(ConnectorContainerEnvelopeSchema),
    withWorkflowConfiguration(FacebookConnectorEnvelopeSchema),
    withWorkflowConfiguration(WordPressConnectorEnvelopeSchema),
    withWorkflowConfiguration(GoogleAnalyticsConnectorEnvelopeSchema),

    // Page configuration
    withWorkflowConfiguration(PageConfigurationSetEnvelopeSchema),
    withWorkflowConfiguration(PageConfigurationSetContainerEnvelopeSchema),

    // Data definition + shared field
    withWorkflowConfiguration(DataDefinitionEnvelopeSchema),
    withWorkflowConfiguration(DataDefinitionContainerEnvelopeSchema),
    withWorkflowConfiguration(SharedFieldEnvelopeSchema),
    withWorkflowConfiguration(SharedFieldContainerEnvelopeSchema),

    // Metadata set
    withWorkflowConfiguration(MetadataSetEnvelopeSchema),
    withWorkflowConfiguration(MetadataSetContainerEnvelopeSchema),

    // Publish set
    withWorkflowConfiguration(PublishSetEnvelopeSchema),
    withWorkflowConfiguration(PublishSetContainerEnvelopeSchema),

    // Destinations + transports
    withWorkflowConfiguration(SiteDestinationContainerEnvelopeSchema),
    withWorkflowConfiguration(DestinationEnvelopeSchema),
    withWorkflowConfiguration(FileSystemTransportEnvelopeSchema),
    withWorkflowConfiguration(FtpTransportEnvelopeSchema),
    withWorkflowConfiguration(DatabaseTransportEnvelopeSchema),
    withWorkflowConfiguration(CloudTransportEnvelopeSchema),
    withWorkflowConfiguration(TransportContainerEnvelopeSchema),

    // Workflow definitions + emails
    withWorkflowConfiguration(WorkflowDefinitionEnvelopeSchema),
    withWorkflowConfiguration(WorkflowDefinitionContainerEnvelopeSchema),
    withWorkflowConfiguration(WorkflowEmailEnvelopeSchema),
    withWorkflowConfiguration(WorkflowEmailContainerEnvelopeSchema),

    // Site + editor configuration
    withWorkflowConfiguration(SiteEnvelopeSchema),
    withWorkflowConfiguration(EditorConfigurationEnvelopeSchema),
  ])
  .describe(
    "Cascade asset payload. Wrap one concrete asset under its envelope key — e.g. `{ page: {...} }`, `{ symlink: {...} }`, `{ textBlock: {...} }` — with optional `workflowConfiguration` alongside it. Uses generated `AssetProperties` branch names, which require exactly one concrete asset branch plus optional workflowConfiguration.",
  );

export type AssetInput = z.infer<typeof AssetInputSchema>;

export const CreateAssetInputSchema = z
  .union([
    // Blocks
    withWorkflowConfiguration(createEnvelopeSchema(FeedBlockEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(IndexBlockEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(TextBlockEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(XhtmlDataDefinitionBlockEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(XmlBlockEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(TwitterFeedBlockEnvelopeSchema)),

    // Core content
    withWorkflowConfiguration(createEnvelopeSchema(FileEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(FolderEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(PageEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(ReferenceEnvelopeSchema)),

    // Formats + template
    withWorkflowConfiguration(createEnvelopeSchema(XsltFormatEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(ScriptFormatEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(SymlinkEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(TemplateEnvelopeSchema)),

    // Admin-area principals
    withWorkflowConfiguration(createEnvelopeSchema(UserEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(GroupEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(RoleEnvelopeSchema)),

    // Asset factory + container
    withWorkflowConfiguration(createEnvelopeSchema(AssetFactoryEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(AssetFactoryContainerEnvelopeSchema)),

    // Content type + container
    withWorkflowConfiguration(createEnvelopeSchema(ContentTypeEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(ContentTypeContainerEnvelopeSchema)),

    // Connectors
    withWorkflowConfiguration(createEnvelopeSchema(ConnectorContainerEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(FacebookConnectorEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(WordPressConnectorEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(GoogleAnalyticsConnectorEnvelopeSchema)),

    // Page configuration
    withWorkflowConfiguration(createEnvelopeSchema(PageConfigurationSetEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(PageConfigurationSetContainerEnvelopeSchema)),

    // Data definition + shared field
    withWorkflowConfiguration(createEnvelopeSchema(DataDefinitionEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(DataDefinitionContainerEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(SharedFieldEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(SharedFieldContainerEnvelopeSchema)),

    // Metadata set
    withWorkflowConfiguration(createEnvelopeSchema(MetadataSetEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(MetadataSetContainerEnvelopeSchema)),

    // Publish set
    withWorkflowConfiguration(createEnvelopeSchema(PublishSetEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(PublishSetContainerEnvelopeSchema)),

    // Destinations + transports
    withWorkflowConfiguration(createEnvelopeSchema(SiteDestinationContainerEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(DestinationEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(FileSystemTransportEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(FtpTransportEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(DatabaseTransportEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(CloudTransportEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(TransportContainerEnvelopeSchema)),

    // Workflow definitions + emails
    withWorkflowConfiguration(createEnvelopeSchema(WorkflowDefinitionEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(WorkflowDefinitionContainerEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(WorkflowEmailEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(WorkflowEmailContainerEnvelopeSchema)),

    // Site + editor configuration
    withWorkflowConfiguration(createEnvelopeSchema(SiteEnvelopeSchema)),
    withWorkflowConfiguration(createEnvelopeSchema(EditorConfigurationEnvelopeSchema)),
  ])
  .describe(
    "Cascade create asset payload. Wrap one concrete asset under its envelope key and omit server-assigned id fields.",
  );

export type CreateAssetInput = z.infer<typeof CreateAssetInputSchema>;

export const EditAssetInputSchema = z
  .union([
    // Blocks
    withWorkflowConfiguration(editEnvelopeSchema(FeedBlockEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(IndexBlockEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(TextBlockEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(XhtmlDataDefinitionBlockEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(XmlBlockEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(TwitterFeedBlockEnvelopeSchema)),

    // Core content
    withWorkflowConfiguration(editEnvelopeSchema(FileEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(FolderEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(PageEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(ReferenceEnvelopeSchema)),

    // Formats + template
    withWorkflowConfiguration(editEnvelopeSchema(XsltFormatEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(ScriptFormatEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(SymlinkEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(TemplateEnvelopeSchema)),

    // Admin-area principals
    withWorkflowConfiguration(editEnvelopeSchema(UserEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(GroupEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(RoleEnvelopeSchema)),

    // Asset factory + container
    withWorkflowConfiguration(editEnvelopeSchema(AssetFactoryEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(AssetFactoryContainerEnvelopeSchema)),

    // Content type + container
    withWorkflowConfiguration(editEnvelopeSchema(ContentTypeEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(ContentTypeContainerEnvelopeSchema)),

    // Connectors
    withWorkflowConfiguration(editEnvelopeSchema(ConnectorContainerEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(FacebookConnectorEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(WordPressConnectorEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(GoogleAnalyticsConnectorEnvelopeSchema)),

    // Page configuration
    withWorkflowConfiguration(editEnvelopeSchema(PageConfigurationSetEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(PageConfigurationSetContainerEnvelopeSchema)),

    // Data definition + shared field
    withWorkflowConfiguration(editEnvelopeSchema(DataDefinitionEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(DataDefinitionContainerEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(SharedFieldEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(SharedFieldContainerEnvelopeSchema)),

    // Metadata set
    withWorkflowConfiguration(editEnvelopeSchema(MetadataSetEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(MetadataSetContainerEnvelopeSchema)),

    // Publish set
    withWorkflowConfiguration(editEnvelopeSchema(PublishSetEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(PublishSetContainerEnvelopeSchema)),

    // Destinations + transports
    withWorkflowConfiguration(editEnvelopeSchema(SiteDestinationContainerEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(DestinationEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(FileSystemTransportEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(FtpTransportEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(DatabaseTransportEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(CloudTransportEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(TransportContainerEnvelopeSchema)),

    // Workflow definitions + emails
    withWorkflowConfiguration(editEnvelopeSchema(WorkflowDefinitionEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(WorkflowDefinitionContainerEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(WorkflowEmailEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(WorkflowEmailContainerEnvelopeSchema)),

    // Site + editor configuration
    withWorkflowConfiguration(editEnvelopeSchema(SiteEnvelopeSchema)),
    withWorkflowConfiguration(editEnvelopeSchema(EditorConfigurationEnvelopeSchema)),
  ])
  .describe("Cascade edit asset payload. Wrap one concrete asset under its envelope key.");

export type EditAssetInput = z.infer<typeof EditAssetInputSchema>;

// ─── Re-exports of inner schemas + envelope schemas ────────────────────────
//
// External consumers (tests, documentation generators) may import either the
// inner "asset body" schemas (e.g. `PageAssetSchema`) or the envelope
// wrappers (`PageEnvelopeSchema`). Inner schemas describe just the fields
// inside `{ page: { ... } }`; envelope schemas wrap an inner schema under
// its keyed property.

export {
  // Content
  PageAssetSchema,
  FileAssetSchema,
  FolderAssetSchema,
  SymlinkAssetSchema,
  ReferenceAssetSchema,
  PageEnvelopeSchema,
  FileEnvelopeSchema,
  FolderEnvelopeSchema,
  SymlinkEnvelopeSchema,
  ReferenceEnvelopeSchema,
} from "./assets/content.js";

export {
  // Blocks
  FeedBlockAssetSchema,
  IndexBlockAssetSchema,
  TextBlockAssetSchema,
  XhtmlDataDefinitionBlockAssetSchema,
  XmlBlockAssetSchema,
  TwitterFeedBlockAssetSchema,
  FeedBlockEnvelopeSchema,
  IndexBlockEnvelopeSchema,
  TextBlockEnvelopeSchema,
  XhtmlDataDefinitionBlockEnvelopeSchema,
  XmlBlockEnvelopeSchema,
  TwitterFeedBlockEnvelopeSchema,
} from "./assets/blocks.js";

export {
  // Formats
  XsltFormatAssetSchema,
  ScriptFormatAssetSchema,
  TemplateAssetSchema,
  XsltFormatEnvelopeSchema,
  ScriptFormatEnvelopeSchema,
  TemplateEnvelopeSchema,
} from "./assets/formats.js";

export {
  // Admin principals
  UserAssetSchema,
  GroupAssetSchema,
  RoleAssetSchema,
  GlobalAbilitiesSchema,
  SiteAbilitiesSchema,
  UserEnvelopeSchema,
  GroupEnvelopeSchema,
  RoleEnvelopeSchema,
} from "./assets/admin.js";

export {
  // Connectors
  FacebookConnectorAssetSchema,
  WordPressConnectorAssetSchema,
  GoogleAnalyticsConnectorAssetSchema,
  FacebookConnectorEnvelopeSchema,
  WordPressConnectorEnvelopeSchema,
  GoogleAnalyticsConnectorEnvelopeSchema,
} from "./assets/connectors.js";

export {
  // Transports
  FileSystemTransportAssetSchema,
  FtpTransportAssetSchema,
  DatabaseTransportAssetSchema,
  CloudTransportAssetSchema,
  FileSystemTransportEnvelopeSchema,
  FtpTransportEnvelopeSchema,
  DatabaseTransportEnvelopeSchema,
  CloudTransportEnvelopeSchema,
} from "./assets/transports.js";

export {
  // Workflow
  WorkflowDefinitionAssetSchema,
  WorkflowEmailAssetSchema,
  WorkflowConfigurationSchema,
  WorkflowDefinitionEnvelopeSchema,
  WorkflowEmailEnvelopeSchema,
  WorkflowConfigurationEnvelopeSchema,
} from "./assets/workflow.js";

export {
  // Config / admin-area assets
  AssetFactoryAssetSchema,
  ContentTypeAssetSchema,
  DestinationAssetSchema,
  EditorConfigurationAssetSchema,
  MetadataSetAssetSchema,
  PageConfigurationSetAssetSchema,
  PublishSetAssetSchema,
  DataDefinitionAssetSchema,
  SharedFieldAssetSchema,
  SiteAssetSchema,
  AssetFactoryEnvelopeSchema,
  ContentTypeEnvelopeSchema,
  DestinationEnvelopeSchema,
  EditorConfigurationEnvelopeSchema,
  MetadataSetEnvelopeSchema,
  PageConfigurationSetEnvelopeSchema,
  PublishSetEnvelopeSchema,
  DataDefinitionEnvelopeSchema,
  SharedFieldEnvelopeSchema,
  SiteEnvelopeSchema,
} from "./assets/config.js";

export {
  // Containers
  AssetFactoryContainerAssetSchema,
  ContentTypeContainerAssetSchema,
  ConnectorContainerAssetSchema,
  PageConfigurationSetContainerAssetSchema,
  DataDefinitionContainerAssetSchema,
  SharedFieldContainerAssetSchema,
  MetadataSetContainerAssetSchema,
  PublishSetContainerAssetSchema,
  SiteDestinationContainerAssetSchema,
  TransportContainerAssetSchema,
  WorkflowDefinitionContainerAssetSchema,
  WorkflowEmailContainerAssetSchema,
  AssetFactoryContainerEnvelopeSchema,
  ContentTypeContainerEnvelopeSchema,
  ConnectorContainerEnvelopeSchema,
  PageConfigurationSetContainerEnvelopeSchema,
  DataDefinitionContainerEnvelopeSchema,
  SharedFieldContainerEnvelopeSchema,
  MetadataSetContainerEnvelopeSchema,
  PublishSetContainerEnvelopeSchema,
  SiteDestinationContainerEnvelopeSchema,
  TransportContainerEnvelopeSchema,
  WorkflowDefinitionContainerEnvelopeSchema,
  WorkflowEmailContainerEnvelopeSchema,
} from "./assets/containers.js";

// ─── Nested + base field re-exports for documentation / advanced use ───────

export {
  TagSchema,
  MetadataSchema,
  StructuredDataSchema,
  StructuredDataNodeSchema,
  PageRegionSchema,
  PageConfigurationSchema,
} from "./assets/nested.js";

export {
  BaseAssetFields,
  NamedAssetFields,
  FolderContainedAssetFields,
  DublinAwareAssetFields,
  ExpiringAssetFields,
  PublishableAssetFields,
  ContaineredAssetFields,
  BlockFields,
} from "./assets/base.js";

export * from "./assets/enums.js";
