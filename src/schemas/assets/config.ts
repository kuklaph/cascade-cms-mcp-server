/**
 * Configuration / site asset schemas.
 *
 * Collects the admin-area and site-level asset types that don't fit into a
 * smaller-grouped module:
 *
 *   - AssetFactory (envelope: `assetFactory`)
 *   - ContentType (envelope: `contentType`)
 *   - Destination (envelope: `destination`)
 *   - EditorConfiguration (envelope: `editorConfiguration`)
 *   - MetadataSet (envelope: `metadataSet`)
 *   - PageConfigurationSet (envelope: `pageConfigurationSet`)
 *   - PublishSet (envelope: `publishSet`)
 *   - DataDefinition (envelope: `dataDefinition`)
 *   - SharedField (envelope: `sharedField`)
 *   - Site (envelope: `site`)
 *
 * Each mirrors its generated cascade-cms-api TypeScript counterpart and
 * accepts every declared field.
 */

import { z } from "zod";
import {
  ContaineredAssetFields,
  NamedAssetFields,
} from "./base.js";
import {
  AssetFactoryWorkflowModeSchema,
  ContentTypePageConfigurationPublishModeSchema,
  DayOfWeekSchema,
  DynamicMetadataFieldTypeSchema,
  InlineEditableFieldTypeSchema,
  MetadataFieldVisibilitySchema,
  NamingRuleAssetSchema,
  NamingRuleCaseSchema,
  NamingRuleSpacingSchema,
  RecycleBinExpirationSchema,
  ScheduledDestinationModeSchema,
  SerializationTypeSchema,
  SiteLinkRewritingSchema,
} from "./enums.js";
import {
  EmbeddedWriteIdentifierSchema,
  PageConfigurationSetPageConfigurationSchema,
} from "./nested.js";
import { objectWithRequiredAlternatives } from "../requiredAlternatives.js";

// ═══ AssetFactory ══════════════════════════════════════════════════════════

const AssetFactoryPluginParameterSchema = z
  .object({
    name: z.string().describe("REQUIRED: Parameter name."),
    value: z.string().optional().describe("Parameter value."),
  })
  .strict();

const AssetFactoryPluginSchema = z
  .object({
    name: z.string().describe("REQUIRED: Plugin class name."),
    parameters: z
      .array(AssetFactoryPluginParameterSchema)
      .optional()
      .describe("Plugin parameters."),
  })
  .strict();

export const AssetFactoryAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    applicableGroupNames: z
      .string()
      .optional()
      .describe("Semicolon-delimited list of groups that may use this factory."),
    assetType: z
      .string()
      .describe(
        "REQUIRED: Type of asset this factory produces (e.g. 'page', 'file').",
      ),
    baseAssetId: z
      .string()
      .optional()
      .describe("Base asset id used as the factory template. Priority: id > path."),
    baseAssetPath: z.string().optional().describe("Base asset path (alt)."),
    baseAssetRecycled: z.boolean().optional().describe("Read-only: true if base asset is recycled."),
    description: z.string().optional().describe("Free-form factory description."),
    placementFolderId: z
      .string()
      .optional()
      .describe("Placement folder id. Priority: id > path."),
    placementFolderPath: z.string().optional().describe("Placement folder path (alt)."),
    placementFolderRecycled: z
      .boolean()
      .optional()
      .describe("Read-only: true if placement folder is recycled."),
    allowSubfolderPlacement: z
      .boolean()
      .optional()
      .describe("Allow placing new assets in subfolders of the placement folder. Default false."),
    folderPlacementPosition: z
      .number()
      .optional()
      .describe("Numeric position in the folder listing. Default 0."),
    overwrite: z
      .boolean()
      .optional()
      .describe("Allow overwriting an existing asset with the same name. Default false."),
    workflowMode: AssetFactoryWorkflowModeSchema.describe(
      "REQUIRED: Who controls the workflow for assets this factory creates.",
    ),
    workflowDefinitionId: z
      .string()
      .optional()
      .describe(
        "Workflow definition id used when workflowMode='factory-controlled'. Priority: id > path.",
      ),
    workflowDefinitionPath: z.string().optional().describe("Workflow definition path (alt)."),
    plugins: z
      .array(AssetFactoryPluginSchema)
      .optional()
      .describe("Factory plugins with configurable parameters."),
  })
  .strict()
  .describe("Asset factory — creates new assets from a base template.");

export type AssetFactoryAsset = z.infer<typeof AssetFactoryAssetSchema>;

export const AssetFactoryEnvelopeSchema = z
  .object({
    assetFactory: AssetFactoryAssetSchema.describe("Asset factory payload."),
  })
  .strict();

// ═══ ContentType ═══════════════════════════════════════════════════════════

const ContentTypePageConfigurationShape = {
  pageConfigurationId: z
    .string()
    .optional()
    .describe("Page configuration id. One of id/name REQUIRED."),
  pageConfigurationName: z
    .string()
    .optional()
    .describe("Page configuration name (alt)."),
  publishMode: ContentTypePageConfigurationPublishModeSchema.describe(
    "REQUIRED: Publish policy for this configuration.",
  ),
  destinations: z
    .array(EmbeddedWriteIdentifierSchema)
    .optional()
    .describe(
      "Destinations — REQUIRED when publishMode='selected-destinations'; ignored otherwise.",
    ),
};

const ContentTypePageConfigurationSchema = objectWithRequiredAlternatives(
  ContentTypePageConfigurationShape,
  [["pageConfigurationId", "pageConfigurationName"]],
  "Content type page configuration publish rule.",
);

const InlineEditableFieldSchema = z
  .object({
    pageConfigurationName: z
      .string()
      .describe("REQUIRED: Page configuration this field belongs to."),
    pageRegionName: z.string().describe("REQUIRED: Region within the configuration."),
    dataDefinitionGroupPath: z
      .string()
      .optional()
      .describe("Data definition group path — optional for non-data-definition fields."),
    type: InlineEditableFieldTypeSchema.describe(
      "REQUIRED: Field kind — 'wired-metadata', 'dynamic-metadata', 'data-definition', or 'xhtml'.",
    ),
    name: z
      .string()
      .optional()
      .describe(
        "Field identifier. REQUIRED for metadata/data-definition field kinds; optional for xhtml.",
      ),
  })
  .strict();

const ContentTypeAssetShape = {
  ...ContaineredAssetFields,
  pageConfigurationSetId: z
    .string()
    .optional()
    .describe(
      "Page configuration set id. One of id/path REQUIRED. Priority: id > path.",
    ),
  pageConfigurationSetPath: z
    .string()
    .optional()
    .describe("Page configuration set path (alt)."),
  metadataSetId: z
    .string()
    .optional()
    .describe("Metadata set id. One of id/path REQUIRED. Priority: id > path."),
  metadataSetPath: z.string().optional().describe("Metadata set path (alt)."),
  dataDefinitionId: z
    .string()
    .optional()
    .describe("Data definition id. Priority: id > path."),
  dataDefinitionPath: z.string().optional().describe("Data definition path (alt)."),
  editorConfigurationId: z.string().optional().describe("Editor configuration id."),
  editorConfigurationPath: z.string().optional().describe("Editor configuration path (alt)."),
  publishSetId: z.string().optional().describe("Publish set id."),
  publishSetPath: z.string().optional().describe("Publish set path (alt)."),
  contentTypePageConfigurations: z
    .array(ContentTypePageConfigurationSchema)
    .optional()
    .describe("Page configuration publish rules."),
  inlineEditableFields: z
    .array(InlineEditableFieldSchema)
    .optional()
    .describe("Inline-editable field definitions exposed on pages of this content type."),
};

export const ContentTypeAssetSchema = objectWithRequiredAlternatives(
  ContentTypeAssetShape,
  [
    ["pageConfigurationSetId", "pageConfigurationSetPath"],
    ["metadataSetId", "metadataSetPath"],
  ],
  "Cascade content type — binds page configuration, metadata set, and data definition.",
);

export type ContentTypeAsset = z.infer<typeof ContentTypeAssetSchema>;

export const ContentTypeEnvelopeSchema = z
  .object({
    contentType: ContentTypeAssetSchema.describe("Content type payload."),
  })
  .strict();

// ═══ Destination ═══════════════════════════════════════════════════════════
// Destination extends NamedAsset but uses ContaineredAsset-style
// parentContainerId/Path fields (not parentFolderId/Path).

const DestinationAssetShape = {
  ...NamedAssetFields,
  parentContainerId: z
    .string()
    .optional()
    .describe("Parent container id. One of parentContainerId/parentContainerPath is REQUIRED. Priority: parentContainerId > parentContainerPath. When inside a site, refer to a SiteDestinationContainer."),
  parentContainerPath: z.string().optional().describe("Parent container path. REQUIRED when parentContainerId is omitted."),
  transportId: z
    .string()
    .optional()
    .describe("Transport id. One of id/path REQUIRED. Priority: id > path."),
  transportPath: z.string().optional().describe("Transport path (alt)."),
  applicableGroupNames: z
    .string()
    .optional()
    .describe("Semicolon-delimited list of groups that may publish to this destination."),
  directory: z.string().optional().describe("Target sub-directory under the transport root."),
  enabled: z.boolean().optional().describe("Whether this destination is active."),
  checkedByDefault: z
    .boolean()
    .optional()
    .describe("Whether this destination is pre-checked in the publish UI."),
  publishASCII: z
    .boolean()
    .optional()
    .describe("Convert non-ASCII characters to ASCII on publish."),
  usesScheduledPublishing: z
    .boolean()
    .optional()
    .describe("Enable scheduled publishing. When true, provide one schedule selector: publishIntervalHours, publishDaysOfWeek, or cronExpression; timeToPublish remains optional/defaulted, and destination-mode fields are ignored at destination level."),
  scheduledPublishDestinationMode: ScheduledDestinationModeSchema
    .optional()
    .describe("Not used at destination level — ignored. Present for shape consistency."),
  scheduledPublishDestinations: z
    .array(EmbeddedWriteIdentifierSchema)
    .optional()
    .describe("Not used at destination level — ignored."),
  timeToPublish: z
    .string()
    .optional()
    .describe("Time of day ('HH:MM') to run scheduled publish. Default '00:00'."),
  sendReportToUsers: z
    .string()
    .optional()
    .describe("Semicolon-delimited usernames to receive the publish report."),
  sendReportToGroups: z
    .string()
    .optional()
    .describe("Semicolon-delimited group names to receive the publish report."),
  sendReportOnErrorOnly: z
    .boolean()
    .optional()
    .describe("Send the report only if the publish encountered errors. Default false."),
  webUrl: z
    .string()
    .optional()
    .describe("Published output's public URL."),
  extensionsToStrip: z
    .string()
    .optional()
    .describe("Comma-separated extensions to strip on publish."),
  siteId: z
    .string()
    .optional()
    .describe("Site id. One of siteId/siteName REQUIRED."),
  siteName: z.string().optional().describe("Site name (alt)."),
  publishIntervalHours: z
    .number()
    .optional()
    .describe(
      "Publish interval hours as a number. Cascade may enforce schedule interval rules server-side. One of interval hours, publish days, or cron expression is REQUIRED when usesScheduledPublishing=true.",
    ),
  publishDaysOfWeek: z
    .array(DayOfWeekSchema)
    .optional()
    .describe("Publish days of week. One of interval hours, publish days, or cron expression is REQUIRED when usesScheduledPublishing=true."),
  cronExpression: z
    .string()
    .optional()
    .describe("Cron expression. One of interval hours, publish days, or cron expression is REQUIRED when usesScheduledPublishing=true."),
};

export const DestinationAssetSchema = objectWithRequiredAlternatives(
  DestinationAssetShape,
  [
    ["parentContainerId", "parentContainerPath"],
    ["transportId", "transportPath"],
    ["siteId", "siteName"],
  ],
  "Cascade destination — a transport + path pairing assets publish to.",
);

export type DestinationAsset = z.infer<typeof DestinationAssetSchema>;

export const DestinationEnvelopeSchema = z
  .object({
    destination: DestinationAssetSchema.describe("Destination payload."),
  })
  .strict();

// ═══ EditorConfiguration ═══════════════════════════════════════════════════

export const EditorConfigurationAssetSchema = z
  .object({
    ...NamedAssetFields,
    siteId: z
      .string()
      .optional()
      .describe(
        "Site id. Optional for the system default editor configuration; REQUIRED for others.",
      ),
    siteName: z.string().optional().describe("Site name (alt)."),
    cssFileId: z
      .string()
      .optional()
      .describe("Stylesheet file id used by the editor. Priority: id > path."),
    cssFilePath: z.string().optional().describe("Stylesheet file path (alt)."),
    cssFileRecycled: z
      .boolean()
      .optional()
      .describe("Read-only: true if the stylesheet is recycled."),
    configuration: z
      .string()
      .describe("REQUIRED: JSON string holding the editor configuration payload."),
  })
  .strict()
  .describe("WYSIWYG editor configuration — applied site-wide or to specific sites.");

export type EditorConfigurationAsset = z.infer<typeof EditorConfigurationAssetSchema>;

export const EditorConfigurationEnvelopeSchema = z
  .object({
    editorConfiguration: EditorConfigurationAssetSchema.describe(
      "Editor configuration payload.",
    ),
  })
  .strict();

// ═══ MetadataSet ═══════════════════════════════════════════════════════════

const DynamicMetadataFieldDefinitionValueSchema = z
  .object({
    value: z.string().optional().describe("Option value."),
    label: z.string().optional().describe("Option display label."),
    selectedByDefault: z
      .boolean()
      .optional()
      .describe("Whether this option is selected by default."),
  })
  .strict();

const DynamicMetadataFieldDefinitionSchema = z
  .object({
    name: z.string().describe("REQUIRED: Field identifier."),
    label: z.string().describe("REQUIRED: Human label in the UI."),
    fieldType: DynamicMetadataFieldTypeSchema.describe(
      "REQUIRED: Control type — text / datetime / radio / dropdown / checkbox / multiselect.",
    ),
    required: z.boolean().optional().describe("Whether users must supply a value."),
    visibility: MetadataFieldVisibilitySchema.optional().describe(
      "Field visibility in the editor.",
    ),
    possibleValues: z
      .array(DynamicMetadataFieldDefinitionValueSchema)
      .optional()
      .describe(
        "Allowed values. REQUIRED for radio / checkbox / dropdown / multiselect types.",
      ),
    helpText: z.string().optional().describe("Help text shown next to the field."),
  })
  .strict();

/** Helper to cut MetadataSet boilerplate — each wired field has three properties. */
const wiredMetadataField = (fieldName: string) =>
  ({
    [`${fieldName}FieldRequired`]: z
      .boolean()
      .optional()
      .describe(`Whether ${fieldName} is required.`),
    [`${fieldName}FieldVisibility`]: MetadataFieldVisibilitySchema.optional().describe(
      `Visibility of the ${fieldName} field.`,
    ),
    [`${fieldName}FieldHelpText`]: z
      .string()
      .optional()
      .describe(`Help text for the ${fieldName} field.`),
  }) as const;

export const MetadataSetAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    ...wiredMetadataField("author"),
    ...wiredMetadataField("description"),
    ...wiredMetadataField("displayName"),
    ...wiredMetadataField("endDate"),
    ...wiredMetadataField("expirationFolder"),
    ...wiredMetadataField("keywords"),
    ...wiredMetadataField("reviewDate"),
    ...wiredMetadataField("startDate"),
    ...wiredMetadataField("summary"),
    ...wiredMetadataField("teaser"),
    ...wiredMetadataField("title"),
    dynamicMetadataFieldDefinitions: z
      .array(DynamicMetadataFieldDefinitionSchema)
      .optional()
      .describe("Dynamic metadata field definitions. Each: { name, label, fieldType, ... }."),
  })
  .strict()
  .describe(
    "Metadata set — configures wired metadata visibility + dynamic metadata field definitions.",
  );

export type MetadataSetAsset = z.infer<typeof MetadataSetAssetSchema>;

export const MetadataSetEnvelopeSchema = z
  .object({
    metadataSet: MetadataSetAssetSchema.describe("Metadata set payload."),
  })
  .strict();

// ═══ PageConfigurationSet ══════════════════════════════════════════════════

export const PageConfigurationSetAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    pageConfigurations: z
      .array(PageConfigurationSetPageConfigurationSchema)
      .describe("REQUIRED: Page configurations in this set (at least one)."),
  })
  .strict()
  .describe("Page configuration set — a bundle of page configurations shareable across content types.");

export type PageConfigurationSetAsset = z.infer<typeof PageConfigurationSetAssetSchema>;

export const PageConfigurationSetEnvelopeSchema = z
  .object({
    pageConfigurationSet: PageConfigurationSetAssetSchema.describe(
      "Page configuration set payload.",
    ),
  })
  .strict();

// ═══ PublishSet ════════════════════════════════════════════════════════════

export const PublishSetAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    files: z.array(EmbeddedWriteIdentifierSchema).optional().describe("Files in the publish set."),
    folders: z.array(EmbeddedWriteIdentifierSchema).optional().describe("Folders in the publish set."),
    pages: z.array(EmbeddedWriteIdentifierSchema).optional().describe("Pages in the publish set."),
    usesScheduledPublishing: z
      .boolean()
      .optional()
      .describe("Enable scheduled publishing. Default false."),
    scheduledPublishDestinationMode: ScheduledDestinationModeSchema
      .optional()
      .describe("Which destinations the scheduled publish targets."),
    scheduledPublishDestinations: z
      .array(EmbeddedWriteIdentifierSchema)
      .optional()
      .describe("Scheduled destinations when mode='selected-destinations'."),
    timeToPublish: z
      .string()
      .optional()
      .describe("Time of day ('HH:MM') to run scheduled publish. Default '00:00'."),
    sendReportToUsers: z.string().optional().describe("Semicolon-delimited usernames."),
    sendReportToGroups: z.string().optional().describe("Semicolon-delimited group names."),
    sendReportOnErrorOnly: z.boolean().optional().describe("Send report only on errors. Default false."),
    publishIntervalHours: z
      .number()
      .optional()
      .describe("Publish interval hours as a number. Cascade may enforce schedule interval rules server-side."),
    publishDaysOfWeek: z.array(DayOfWeekSchema).optional().describe("Days of week to publish."),
    cronExpression: z.string().optional().describe("Cron expression for scheduled publish."),
  })
  .strict()
  .describe("Publish set — a named bundle of assets that publish together.");

export type PublishSetAsset = z.infer<typeof PublishSetAssetSchema>;

export const PublishSetEnvelopeSchema = z
  .object({
    publishSet: PublishSetAssetSchema.describe("Publish set payload."),
  })
  .strict();

// ═══ DataDefinition ════════════════════════════════════════════════════════

export const DataDefinitionAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    xml: z.string().describe("REQUIRED: Data definition XML."),
  })
  .strict()
  .describe("Data definition — XML schema for structured data on pages/blocks.");

export type DataDefinitionAsset = z.infer<typeof DataDefinitionAssetSchema>;

export const DataDefinitionEnvelopeSchema = z
  .object({
    dataDefinition: DataDefinitionAssetSchema.describe("Data definition payload."),
  })
  .strict();

// ═══ SharedField ═══════════════════════════════════════════════════════════

export const SharedFieldAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    xml: z.string().describe("REQUIRED: Shared field XML definition."),
  })
  .strict()
  .describe("Shared field — reusable data-definition field snippet.");

export type SharedFieldAsset = z.infer<typeof SharedFieldAssetSchema>;

export const SharedFieldEnvelopeSchema = z
  .object({
    sharedField: SharedFieldAssetSchema.describe("Shared field payload."),
  })
  .strict();

// ═══ Site ══════════════════════════════════════════════════════════════════
// Site extends NamedAsset and has an enormous set of own fields.

const RoleAssignmentSchema = z
  .object({
    roleId: z.string().optional().describe("Role id. Priority: roleId > roleName."),
    roleName: z.string().optional().describe("Role name (alt)."),
    users: z.string().optional().describe("Comma-delimited usernames granted this role in the site."),
    groups: z.string().optional().describe("Comma-delimited group names granted this role in the site."),
  })
  .strict();

export const SiteAssetSchema = z
  .object({
    ...NamedAssetFields,
    url: z.string().describe("REQUIRED: Public URL of the site."),
    extensionsToStrip: z
      .string()
      .optional()
      .describe("Comma-separated extensions to strip on publish."),
    defaultMetadataSetId: z
      .string()
      .optional()
      .describe("Default metadata set id. Priority: id > path."),
    defaultMetadataSetPath: z.string().optional().describe("Default metadata set path (alt)."),
    siteAssetFactoryContainerId: z
      .string()
      .optional()
      .describe("Asset factory container id used for new-asset menus."),
    siteAssetFactoryContainerPath: z
      .string()
      .optional()
      .describe("Asset factory container path (alt)."),
    defaultEditorConfigurationId: z
      .string()
      .optional()
      .describe("Default editor configuration id for this site."),
    defaultEditorConfigurationPath: z
      .string()
      .optional()
      .describe("Default editor configuration path (alt)."),
    siteStartingPageId: z
      .string()
      .optional()
      .describe("Site starting page id shown after login."),
    siteStartingPagePath: z.string().optional().describe("Site starting page path (alt)."),
    siteStartingPageRecycled: z
      .boolean()
      .optional()
      .describe("Read-only: true if starting page is recycled."),
    roleAssignments: z
      .array(RoleAssignmentSchema)
      .optional()
      .describe("Role assignments for this site."),
    usesScheduledPublishing: z
      .boolean()
      .optional()
      .describe("Enable site-level scheduled publishing. Default false."),
    scheduledPublishDestinationMode: ScheduledDestinationModeSchema
      .optional()
      .describe("Scheduled publish destination mode."),
    scheduledPublishDestinations: z
      .array(EmbeddedWriteIdentifierSchema)
      .optional()
      .describe("Scheduled publish destinations."),
    timeToPublish: z.string().optional().describe("Time of day to schedule publish. Default '00:00'."),
    sendReportToUsers: z.string().optional().describe("Semicolon-delimited usernames for reports."),
    sendReportToGroups: z.string().optional().describe("Semicolon-delimited group names for reports."),
    sendReportOnErrorOnly: z.boolean().optional().describe("Send report only on errors. Default false."),
    recycleBinExpiration: RecycleBinExpirationSchema.describe(
      "REQUIRED: Days until recycled assets are purged — '1', '15', '30', or 'never'.",
    ),
    unpublishOnExpiration: z
      .boolean()
      .describe("REQUIRED: Unpublish assets automatically on expiration."),
    linkCheckerEnabled: z
      .boolean()
      .describe("REQUIRED: Enable the site's link checker."),
    externalLinkCheckOnPublish: z
      .boolean()
      .describe("REQUIRED: Check external links at publish time."),
    inheritDataChecksEnabled: z
      .boolean()
      .describe("REQUIRED: Enable inherited data checks."),
    spellCheckEnabled: z.boolean().describe("REQUIRED: Enable spell-check."),
    linkCheckEnabled: z.boolean().describe("REQUIRED: Enable broken-link checks."),
    accessibilityCheckEnabled: z
      .boolean()
      .describe("REQUIRED: Enable accessibility checking."),
    inheritNamingRules: z
      .boolean()
      .describe("REQUIRED: Inherit asset-naming rules from system defaults."),
    namingRuleCase: NamingRuleCaseSchema
      .optional()
      .describe("Naming rule case policy."),
    namingRuleSpacing: NamingRuleSpacingSchema
      .optional()
      .describe("Naming rule spacing policy."),
    namingRuleAssets: z
      .array(NamingRuleAssetSchema)
      .optional()
      .describe("Asset types to which naming rules apply."),
    siteImproveIntegrationEnabled: z
      .boolean()
      .optional()
      .describe("Enable SiteImprove integration."),
    siteImproveUrl: z.string().optional().describe("SiteImprove site URL."),
    widenDamIntegrationEnabled: z.boolean().optional().describe("Enable Widen DAM integration."),
    widenDamIntegrationCategory: z.string().optional().describe("Widen DAM category."),
    webdamDamIntegrationEnabled: z.boolean().optional().describe("Enable Webdam DAM integration."),
    rootFolderId: z.string().optional().describe("Read-only: root folder id."),
    rootAssetFactoryContainerId: z
      .string()
      .optional()
      .describe("Read-only: root asset factory container id."),
    rootPageConfigurationSetContainerId: z
      .string()
      .optional()
      .describe("Read-only: root page-config-set container id."),
    rootContentTypeContainerId: z
      .string()
      .optional()
      .describe("Read-only: root content-type container id."),
    rootConnectorContainerId: z
      .string()
      .optional()
      .describe("Read-only: root connector container id."),
    rootDataDefinitionContainerId: z
      .string()
      .optional()
      .describe("Read-only: root data-definition container id."),
    rootSharedFieldContainerId: z
      .string()
      .optional()
      .describe("Read-only: root shared-field container id."),
    rootMetadataSetContainerId: z
      .string()
      .optional()
      .describe("Read-only: root metadata-set container id."),
    rootPublishSetContainerId: z
      .string()
      .optional()
      .describe("Read-only: root publish-set container id."),
    rootSiteDestinationContainerId: z
      .string()
      .optional()
      .describe("Read-only: root site-destination container id."),
    rootTransportContainerId: z
      .string()
      .optional()
      .describe("Read-only: root transport container id."),
    rootWorkflowDefinitionContainerId: z
      .string()
      .optional()
      .describe("Read-only: root workflow-definition container id."),
    rootWorkflowEmailContainerId: z
      .string()
      .optional()
      .describe("Read-only: root workflow-email container id."),
    linkRewriting: SiteLinkRewritingSchema.optional().describe(
      "Site-wide link rewriting. Default 'absolute'.",
    ),
    extraSettings: z
      .string()
      .optional()
      .describe("JSON string holding extra site settings."),
    publishIntervalHours: z
      .number()
      .optional()
      .describe("Publish interval hours as a number. Cascade may enforce schedule interval rules server-side when usesScheduledPublishing=true."),
    publishDaysOfWeek: z.array(DayOfWeekSchema).optional().describe("Publish days of week."),
    cronExpression: z.string().optional().describe("Cron expression for scheduled publish."),
  })
  .strict()
  .describe("Cascade site — the top-level site configuration.");

export type SiteAsset = z.infer<typeof SiteAssetSchema>;

export const SiteEnvelopeSchema = z
  .object({
    site: SiteAssetSchema.describe("Site payload."),
  })
  .strict();
