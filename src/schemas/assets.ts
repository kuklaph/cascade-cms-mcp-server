/**
 * Zod schemas for Cascade CMS asset inputs — `AssetInputSchema` and friends.
 *
 * Cascade's REST API models asset payloads as a tagged-envelope object:
 *
 *     { <typeKey>: { ...fields } }
 *
 * where `<typeKey>` is one of 48 camelCase property names on the upstream
 * `Asset` schema (`openapi.yaml` line 3841). Each concrete Cascade type
 * (Page, File, TextBlock, Template, User, ...) is keyed under its own
 * property. This file assembles per-variant Zod schemas from the
 * `./assets/` sub-modules into a single union that mirrors the REST API
 * exactly.
 *
 * Design notes:
 *
 * - **Shape mirror**. Every field declared in the upstream OpenAPI spec is
 *   present here with the correct `required`/`optional`/`nullable` marker.
 *   Unknown keys on an asset object are rejected (`.strict()`) to catch
 *   typos early. Round-trip from `cascade_read` works because every field
 *   Cascade returns (including the echoed `type` string at the top of each
 *   inner object) is modelled.
 *
 * - **Required vs optional rule.** A field is `.required()` here if and
 *   only if it appears in the upstream OpenAPI `required:` array for its
 *   type. `NamedAssetFields.name` is required (OpenAPI requires it), even
 *   though description text says "ignored on edit" — Cascade's spec is our
 *   single source of truth. `parentFolderId`/`parentFolderPath` and
 *   `parentContainerId/Path` are optional here because OpenAPI never
 *   declares them required (the "required on create" rule lives only in
 *   description prose). Cascade validates create-side constraints
 *   server-side in both cases.
 *
 * - **No cross-field refinements**. Several types document rules like
 *   "one of xhtml/structuredData REQUIRED" or "searchString REQUIRED when
 *   queryType='search-terms'". The upstream OpenAPI does NOT express these
 *   in its `required:` arrays — they are documentation-only. We mirror the
 *   spec and leave enforcement to Cascade.
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
  WorkflowConfigurationEnvelopeSchema,
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

export const ASSET_ENVELOPE_KEYS = [
  "workflowConfiguration",
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

/**
 * Envelope union over every type-keyed property on Cascade's `Asset`
 * schema. The accepted shape is always `{ <oneTypeKey>: { ...fields } }`.
 * Plain `z.union` — the discriminator is the object key itself, which
 * `z.discriminatedUnion` cannot express (it requires a discriminator
 * field).
 *
 * Listing follows the order of the upstream `Asset` properties: workflow
 * configuration, then blocks, content (file/folder/page), reference,
 * formats, symlink, template, admin-area (user/group/role), asset factory,
 * containers, content type, connectors, page configuration, data
 * definition, shared field, metadata set, publish set, destinations,
 * transports, workflow, twitter feed, site, editor configuration.
 */
export const AssetInputSchema = z
  .union([
    // Workflow (not technically an asset — but travels on the Asset object)
    WorkflowConfigurationEnvelopeSchema,

    // Blocks
    FeedBlockEnvelopeSchema,
    IndexBlockEnvelopeSchema,
    TextBlockEnvelopeSchema,
    XhtmlDataDefinitionBlockEnvelopeSchema,
    XmlBlockEnvelopeSchema,
    TwitterFeedBlockEnvelopeSchema,

    // Core content
    FileEnvelopeSchema,
    FolderEnvelopeSchema,
    PageEnvelopeSchema,
    ReferenceEnvelopeSchema,

    // Formats + template
    XsltFormatEnvelopeSchema,
    ScriptFormatEnvelopeSchema,
    SymlinkEnvelopeSchema,
    TemplateEnvelopeSchema,

    // Admin-area principals
    UserEnvelopeSchema,
    GroupEnvelopeSchema,
    RoleEnvelopeSchema,

    // Asset factory + container
    AssetFactoryEnvelopeSchema,
    AssetFactoryContainerEnvelopeSchema,

    // Content type + container
    ContentTypeEnvelopeSchema,
    ContentTypeContainerEnvelopeSchema,

    // Connectors
    ConnectorContainerEnvelopeSchema,
    WordPressConnectorEnvelopeSchema,
    GoogleAnalyticsConnectorEnvelopeSchema,

    // Page configuration
    PageConfigurationSetEnvelopeSchema,
    PageConfigurationSetContainerEnvelopeSchema,

    // Data definition + shared field
    DataDefinitionEnvelopeSchema,
    DataDefinitionContainerEnvelopeSchema,
    SharedFieldEnvelopeSchema,
    SharedFieldContainerEnvelopeSchema,

    // Metadata set
    MetadataSetEnvelopeSchema,
    MetadataSetContainerEnvelopeSchema,

    // Publish set
    PublishSetEnvelopeSchema,
    PublishSetContainerEnvelopeSchema,

    // Destinations + transports
    SiteDestinationContainerEnvelopeSchema,
    DestinationEnvelopeSchema,
    FileSystemTransportEnvelopeSchema,
    FtpTransportEnvelopeSchema,
    DatabaseTransportEnvelopeSchema,
    CloudTransportEnvelopeSchema,
    TransportContainerEnvelopeSchema,

    // Workflow definitions + emails
    WorkflowDefinitionEnvelopeSchema,
    WorkflowDefinitionContainerEnvelopeSchema,
    WorkflowEmailEnvelopeSchema,
    WorkflowEmailContainerEnvelopeSchema,

    // Site + editor configuration
    SiteEnvelopeSchema,
    EditorConfigurationEnvelopeSchema,
  ])
  .describe(
    "Cascade asset payload. Wrap the asset under its envelope key — e.g. `{ page: {...} }`, `{ symlink: {...} }`, `{ textBlock: {...} }`. 48 envelope keys are accepted, one per concrete Cascade type. Matches the upstream `Asset` schema 1:1.",
  );

export type AssetInput = z.infer<typeof AssetInputSchema>;

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
  WordPressConnectorAssetSchema,
  GoogleAnalyticsConnectorAssetSchema,
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
