/**
 * Container asset schemas — folders for admin-area assets.
 *
 * Containers are simple organisational shells around ContaineredAsset. With
 * one exception (`assetFactoryContainer`, which carries applicable-group
 * permissions and a description), they add only an optional read-only
 * `children` array reflecting current contents.
 */

import { z } from "zod";
import { ContaineredAssetFields } from "./base.js";
import { EmbeddedWriteIdentifierSchema } from "./nested.js";

// ─── AssetFactoryContainer ─────────────────────────────────────────────────

export const AssetFactoryContainerAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    applicableGroupNames: z
      .string()
      .optional()
      .describe("Semicolon-delimited list of groups permitted to use factories in this container."),
    description: z.string().optional().describe("Free-form container description."),
    children: z
      .array(EmbeddedWriteIdentifierSchema)
      .optional()
      .describe("Child Identifier objects. If supplied in a write payload, each child requires id or path."),
  })
  .strict()
  .describe("Asset factory container — groups asset factories and asset factory containers.");

export type AssetFactoryContainerAsset = z.infer<typeof AssetFactoryContainerAssetSchema>;

export const AssetFactoryContainerEnvelopeSchema = z
  .object({
    assetFactoryContainer: AssetFactoryContainerAssetSchema.describe(
      "Asset factory container payload.",
    ),
  })
  .strict();

// ─── Helper for simple containers (ContaineredAsset + children only) ───────

function simpleContainerSchema(description: string) {
  return z
    .object({
      ...ContaineredAssetFields,
      children: z
        .array(EmbeddedWriteIdentifierSchema)
        .optional()
        .describe("Child Identifier objects. If supplied in a write payload, each child requires id or path."),
    })
    .strict()
    .describe(description);
}

// ─── ContentTypeContainer ──────────────────────────────────────────────────

export const ContentTypeContainerAssetSchema = simpleContainerSchema(
  "Content type container.",
);
export type ContentTypeContainerAsset = z.infer<typeof ContentTypeContainerAssetSchema>;

export const ContentTypeContainerEnvelopeSchema = z
  .object({
    contentTypeContainer: ContentTypeContainerAssetSchema.describe(
      "Content type container payload.",
    ),
  })
  .strict();

// ─── ConnectorContainer ────────────────────────────────────────────────────

export const ConnectorContainerAssetSchema = simpleContainerSchema(
  "Connector container.",
);
export type ConnectorContainerAsset = z.infer<typeof ConnectorContainerAssetSchema>;

export const ConnectorContainerEnvelopeSchema = z
  .object({
    connectorContainer: ConnectorContainerAssetSchema.describe(
      "Connector container payload.",
    ),
  })
  .strict();

// ─── PageConfigurationSetContainer ─────────────────────────────────────────

export const PageConfigurationSetContainerAssetSchema = simpleContainerSchema(
  "Page configuration set container.",
);
export type PageConfigurationSetContainerAsset = z.infer<
  typeof PageConfigurationSetContainerAssetSchema
>;

export const PageConfigurationSetContainerEnvelopeSchema = z
  .object({
    pageConfigurationSetContainer: PageConfigurationSetContainerAssetSchema.describe(
      "Page configuration set container payload.",
    ),
  })
  .strict();

// ─── DataDefinitionContainer ───────────────────────────────────────────────

export const DataDefinitionContainerAssetSchema = simpleContainerSchema(
  "Data definition container.",
);
export type DataDefinitionContainerAsset = z.infer<typeof DataDefinitionContainerAssetSchema>;

export const DataDefinitionContainerEnvelopeSchema = z
  .object({
    dataDefinitionContainer: DataDefinitionContainerAssetSchema.describe(
      "Data definition container payload.",
    ),
  })
  .strict();

// ─── SharedFieldContainer ──────────────────────────────────────────────────

export const SharedFieldContainerAssetSchema = simpleContainerSchema(
  "Shared field container.",
);
export type SharedFieldContainerAsset = z.infer<typeof SharedFieldContainerAssetSchema>;

export const SharedFieldContainerEnvelopeSchema = z
  .object({
    sharedFieldContainer: SharedFieldContainerAssetSchema.describe(
      "Shared field container payload.",
    ),
  })
  .strict();

// ─── MetadataSetContainer ──────────────────────────────────────────────────

export const MetadataSetContainerAssetSchema = simpleContainerSchema(
  "Metadata set container.",
);
export type MetadataSetContainerAsset = z.infer<typeof MetadataSetContainerAssetSchema>;

export const MetadataSetContainerEnvelopeSchema = z
  .object({
    metadataSetContainer: MetadataSetContainerAssetSchema.describe(
      "Metadata set container payload.",
    ),
  })
  .strict();

// ─── PublishSetContainer ───────────────────────────────────────────────────

export const PublishSetContainerAssetSchema = simpleContainerSchema(
  "Publish set container.",
);
export type PublishSetContainerAsset = z.infer<typeof PublishSetContainerAssetSchema>;

export const PublishSetContainerEnvelopeSchema = z
  .object({
    publishSetContainer: PublishSetContainerAssetSchema.describe(
      "Publish set container payload.",
    ),
  })
  .strict();

// ─── SiteDestinationContainer ──────────────────────────────────────────────

export const SiteDestinationContainerAssetSchema = simpleContainerSchema(
  "Site destination container.",
);
export type SiteDestinationContainerAsset = z.infer<
  typeof SiteDestinationContainerAssetSchema
>;

export const SiteDestinationContainerEnvelopeSchema = z
  .object({
    siteDestinationContainer: SiteDestinationContainerAssetSchema.describe(
      "Site destination container payload.",
    ),
  })
  .strict();

// ─── TransportContainer ────────────────────────────────────────────────────

export const TransportContainerAssetSchema = simpleContainerSchema("Transport container.");
export type TransportContainerAsset = z.infer<typeof TransportContainerAssetSchema>;

export const TransportContainerEnvelopeSchema = z
  .object({
    transportContainer: TransportContainerAssetSchema.describe(
      "Transport container payload.",
    ),
  })
  .strict();

// ─── WorkflowDefinitionContainer ───────────────────────────────────────────

export const WorkflowDefinitionContainerAssetSchema = simpleContainerSchema(
  "Workflow definition container.",
);
export type WorkflowDefinitionContainerAsset = z.infer<
  typeof WorkflowDefinitionContainerAssetSchema
>;

export const WorkflowDefinitionContainerEnvelopeSchema = z
  .object({
    workflowDefinitionContainer: WorkflowDefinitionContainerAssetSchema.describe(
      "Workflow definition container payload.",
    ),
  })
  .strict();

// ─── WorkflowEmailContainer ────────────────────────────────────────────────

export const WorkflowEmailContainerAssetSchema = simpleContainerSchema(
  "Workflow email container.",
);
export type WorkflowEmailContainerAsset = z.infer<
  typeof WorkflowEmailContainerAssetSchema
>;

export const WorkflowEmailContainerEnvelopeSchema = z
  .object({
    workflowEmailContainer: WorkflowEmailContainerAssetSchema.describe(
      "Workflow email container payload.",
    ),
  })
  .strict();
