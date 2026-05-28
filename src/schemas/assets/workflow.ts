/**
 * Workflow-related asset schemas.
 *
 * Includes:
 *   - `workflowDefinition` envelope — the WorkflowDefinition asset
 *   - `workflowEmail` envelope — the WorkflowEmail asset
 *   - `workflowConfiguration` payload — not an asset; attached alongside
 *     the asset body on operations that require workflow context
 *
 * WorkflowConfiguration is the first property on generated AssetProperties,
 * which is nested under the top-level Asset.asset wrapper. It's not an
 * envelope "choice" — it travels alongside an asset envelope.
 */

import { z } from "zod";
import { ContaineredAssetFields } from "./base.js";
import { WorkflowNamingBehaviorSchema } from "./enums.js";

// ─── WorkflowDefinition (envelope: `workflowDefinition`) ───────────────────

export const WorkflowDefinitionAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    applicableGroupNames: z
      .string()
      .optional()
      .describe("Semicolon-delimited list of group names eligible to own this workflow."),
    copy: z.boolean().optional().describe("Invoked on copy operations."),
    create: z.boolean().optional().describe("Invoked on create operations."),
    delete: z.boolean().optional().describe("Invoked on delete operations."),
    edit: z.boolean().optional().describe("Invoked on edit operations."),
    move: z.boolean().optional().describe("Invoked on move operations."),
    namingBehavior: WorkflowNamingBehaviorSchema.describe(
      "REQUIRED: How workflow instances are named when instantiated.",
    ),
    xml: z.string().describe("REQUIRED: Workflow definition XML."),
    completedWorkflowEmailId: z
      .string()
      .optional()
      .describe("Email asset id sent when the workflow completes."),
    completedWorkflowEmailPath: z
      .string()
      .optional()
      .describe("Email asset path (alt)."),
    notificationWorkflowEmailId: z
      .string()
      .optional()
      .describe("Email asset id sent as workflow notifications."),
    notificationWorkflowEmailPath: z
      .string()
      .optional()
      .describe("Email asset path (alt)."),
  })
  .strict()
  .describe("Cascade workflow definition — defines state machine for a workflow.");

export type WorkflowDefinitionAsset = z.infer<typeof WorkflowDefinitionAssetSchema>;

export const WorkflowDefinitionEnvelopeSchema = z
  .object({
    workflowDefinition: WorkflowDefinitionAssetSchema.describe("Workflow definition payload."),
  })
  .strict();

// ─── WorkflowEmail (envelope: `workflowEmail`) ─────────────────────────────

export const WorkflowEmailAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    subject: z.string().describe("REQUIRED: Email subject line."),
    body: z.string().describe("REQUIRED: Email body (plain text or HTML)."),
  })
  .strict()
  .describe("Cascade workflow email template.");

export type WorkflowEmailAsset = z.infer<typeof WorkflowEmailAssetSchema>;

export const WorkflowEmailEnvelopeSchema = z
  .object({
    workflowEmail: WorkflowEmailAssetSchema.describe("Workflow email payload."),
  })
  .strict();

// ─── WorkflowConfiguration (`workflowConfiguration` companion property) ───
// Plain object, not an asset. Travels alongside an asset body on Cascade
// requests where the caller must supply workflow step assignments.

const WorkflowStepConfigurationSchema = z
  .object({
    stepIdentifier: z.string().describe("REQUIRED: Identifier of the workflow step being configured."),
    stepAssignment: z.string().describe("REQUIRED: Username or group name assigned to the step."),
  })
  .strict();

const WorkflowConfigurationFields = {
  workflowName: z.string().describe("REQUIRED: Name for the workflow instance being started."),
  workflowComments: z
    .string()
    .describe("REQUIRED: Comments recorded against the workflow instance."),
  workflowStepConfigurations: z
    .array(WorkflowStepConfigurationSchema)
    .optional()
    .describe("Optional step assignments — who owns each step."),
  endDate: z.string().optional().describe("Optional workflow end date (ISO 8601)."),
};

const WorkflowDefinitionIdSchema = z
  .string()
  .describe("Workflow definition id. Priority: id > path.");

const WorkflowDefinitionPathSchema = z
  .string()
  .describe("Workflow definition path (alt).");

export const WorkflowConfigurationSchema = z
  .union([
    z
      .object({
        ...WorkflowConfigurationFields,
        workflowDefinitionId: WorkflowDefinitionIdSchema,
        workflowDefinitionPath: WorkflowDefinitionPathSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...WorkflowConfigurationFields,
        workflowDefinitionId: WorkflowDefinitionIdSchema.optional(),
        workflowDefinitionPath: WorkflowDefinitionPathSchema,
      })
      .strict(),
  ])
  .describe(
    "Workflow configuration accompanying an asset operation. Not an asset itself — travels alongside an asset envelope. Include workflowDefinitionId or workflowDefinitionPath; if both are present, Cascade prioritizes workflowDefinitionId.",
  );

export type WorkflowConfiguration = z.infer<typeof WorkflowConfigurationSchema>;

export const WorkflowConfigurationEnvelopeSchema = z
  .object({
    workflowConfiguration: WorkflowConfigurationSchema.describe(
      "Workflow configuration payload.",
    ),
  })
  .strict();
