/**
 * Zod schemas for Cascade-backed tools, handle-based asset inspection tools,
 * and MCP-native local utility tools.
 *
 * Every schema is strict at the MCP boundary and mirrors the generated
 * Cascade API request shapes used by the underlying client.
 */

import { z } from "zod";
import {
  EntityTypeSchema,
  IdentifierSchema,
  ReadModeSchema,
} from "./common.js";
import { CreateAssetInputSchema, EditAssetInputSchema } from "./assets.js";
import { CHARACTER_LIMIT } from "../constants.js";


/** Reusable pagination fields merged into list/search request schemas. */
const PaginationFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe(
      "Maximum results per page (default: 50, max: 500). Check has_more and use next_offset to iterate. For a complete enumeration, loop until has_more=false.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Skip this many results for pagination (default: 0). Use with limit + has_more to iterate through large result sets.",
    ),
};

const AclEntryFields = {
  level: z
    .enum(["read", "write"])
    .describe('REQUIRED: The access level, either "read" or "write".'),
  type: z
    .enum(["user", "group"])
    .describe('REQUIRED: The ACL entry type, either "user" or "group".'),
};

const AclEntrySchema = z
  .union([
    z
      .object({
        ...AclEntryFields,
        name: z
          .string()
          .describe(
            "The user or group name this ACL entry applies to. One of name or id is required.",
          ),
        id: z
          .string()
          .optional()
          .describe(
            "Optional user or group id. Include it when Cascade returned one for this ACL entry; prefer id over name when available.",
          ),
      })
      .strict(),
    z
      .object({
        ...AclEntryFields,
        name: z
          .string()
          .optional()
          .describe(
            "The user or group name this ACL entry applies to. One of name or id is required.",
          ),
        id: z
          .string()
          .describe(
            "Required when name is not provided: the user or group id. Prefer id over name when available.",
          ),
      })
      .strict(),
  ])
  .describe("A single access control list entry.");

const AccessRightsInformationSendSchema = z
  .object({
    aclEntries: z
      .array(AclEntrySchema)
      .optional()
      .describe("Optional list of access control list entries."),
    allLevel: z
      .enum(["none", "read", "write"])
      .describe("REQUIRED: The default access level for all users."),
  })
  .strict()
  .describe(
    "Access rights information sent to Cascade when editing asset ACLs.",
  );

const AssetIdentifiersSchema = IdentifierSchema;

const UnpublishParametersFields = {
  unpublish: z
    .boolean()
    .nullable()
    .optional()
    .describe("When true, unpublish the asset. Default false."),
  destinations: z
    .array(AssetIdentifiersSchema)
    .nullable()
    .optional()
    .describe(
      "Destinations for publish/unpublish behavior. Omit for all enabled destinations.",
    ),
};

const WorkflowStepConfigurationSchema = z
  .object({
    stepIdentifier: z
      .string()
      .describe("REQUIRED: Workflow step identifier/name."),
    stepAssignment: z
      .string()
      .describe("REQUIRED: User or group assignment for this workflow step."),
  })
  .strict()
  .describe("Workflow step assignment configuration.");

const WorkflowConfigurationFields = {
  workflowName: z
    .string()
    .describe("REQUIRED: Name for the workflow instance."),
  workflowComments: z
    .string()
    .describe("REQUIRED: Comments recorded with the workflow operation."),
  workflowStepConfigurations: z
    .array(WorkflowStepConfigurationSchema)
    .optional()
    .describe("Optional workflow step assignments."),
  endDate: z.string().optional().describe("Optional workflow due date."),
};

const WorkflowDefinitionIdSchema = z
  .string()
  .describe("Workflow definition id. Priority: id > path.");

const WorkflowDefinitionPathSchema = z
  .string()
  .describe("Workflow definition path (alt).");

const WorkflowConfigurationSchema = z
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
    "Cascade WorkflowConfiguration payload. Include either workflowDefinitionId or workflowDefinitionPath when sending workflowConfiguration; if both are present, Cascade prioritizes workflowDefinitionId.",
  );

const DeleteParametersSchema = z
  .object({
    ...UnpublishParametersFields,
    doWorkflow: z
      .boolean()
      .describe("REQUIRED: Whether to execute workflow for deletion."),
  })
  .strict()
  .describe("Cascade DeleteParameters payload.");

const WorkflowSettingsSendSchema = z
  .object({
    workflowDefinitions: z
      .array(AssetIdentifiersSchema)
      .optional()
      .describe("Workflow definitions associated with this folder."),
    inheritWorkflows: z
      .boolean()
      .optional()
      .describe("Whether workflow settings are inherited from parent."),
    requireWorkflow: z
      .boolean()
      .optional()
      .describe("Whether workflow is required for this folder."),
    inheritedWorkflowDefinitions: z
      .array(AssetIdentifiersSchema)
      .optional()
      .describe("Read-side inherited workflow definitions; ignored on edit."),
  })
  .strict()
  .describe("Cascade WorkflowSettingsSend payload.");

const AuditTypeSchema = z.enum([
  "login",
  "login_failed",
  "logout",
  "start_workflow",
  "advance_workflow",
  "edit",
  "copy",
  "create",
  "reference",
  "delete",
  "delete_unpublish",
  "check_in",
  "check_out",
  "activate_version",
  "publish",
  "unpublish",
  "recycle",
  "restore",
  "move",
]);

const AuditParametersSchema = z
  .object({
    identifier: IdentifierSchema.optional().describe(
      "Filter events to a specific Cascade asset.",
    ),
    username: z.string().optional().describe("Filter audits by username."),
    groupname: z.string().optional().describe("Filter audits by group name."),
    rolename: z.string().optional().describe("Filter audits by role name."),
    startDate: z.string().optional().describe("Earliest audit event timestamp."),
    endDate: z.string().optional().describe("Latest audit event timestamp."),
    auditType: AuditTypeSchema.optional().describe("Audit action type filter."),
  })
  .strict()
  .describe("Cascade AuditParameters payload.");

const PublishInformationSchema = z
  .object({
    destinations: z
      .array(IdentifierSchema)
      .optional()
      .describe("Destinations to which the asset should be published."),
    unpublish: z
      .boolean()
      .nullable()
      .optional()
      .describe("When true, unpublish instead of publish. Default false."),
    publishRelatedAssets: z
      .boolean()
      .nullable()
      .optional()
      .describe("Whether to publish related assets."),
    publishRelatedPublishSet: z
      .boolean()
      .nullable()
      .optional()
      .describe("Whether to publish related publish sets."),
    scheduledDate: z
      .string()
      .nullable()
      .optional()
      .describe("Optional scheduled publish date."),
  })
  .strict()
  .describe("Cascade PublishInformation payload.");

const PreferenceSchema = z
  .object({
    name: z.string().describe("REQUIRED: Preference name."),
    value: z.string().describe("REQUIRED: Preference value."),
  })
  .strict()
  .describe("Cascade preference payload.");

/** -------------------------------------------------------------------------
 * 1. ReadRequest
 * ------------------------------------------------------------------------ */
export const ReadRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset to read. Provide id + type (preferred) or path + type.",
    ),
    read_mode: ReadModeSchema,
  })
  .strict();

export type ReadInput = z.infer<typeof ReadRequestSchema>;

const AssetHandleField = {
  asset_handle: z
    .string()
    .min(1, "asset_handle must not be empty")
    .max(64, "asset_handle must be at most 64 characters")
    .regex(
      /^a_[0-9a-f-]{1,62}$/i,
      "asset_handle must look like 'a_<hex-uuid>'",
    )
    .describe(
      "REQUIRED: Asset handle returned by cascade_read structuredContent.asset_handle.",
    ),
};

const AuditCursorSchema = z
  .string()
  .min(1)
  .max(512, "cursor must be at most 512 characters")
  .regex(
    /^af_[A-Za-z0-9_-]+$/,
    "cursor must be a next_cursor returned by this audit tool",
  )
  .describe("Opaque cursor returned as next_cursor by the same audit tool.");

const AuditPaginationFields = {
  cursor: AuditCursorSchema.optional(),
  limit: z.number().int().min(1).max(500).default(50),
};

export const AssetListFactsRequestSchema = z
  .object({
    ...AssetHandleField,
    pointer_prefix: z.string().optional(),
    fact_kind: z.enum(["object", "array", "key", "scalar"]).optional(),
    key: z.string().optional(),
    key_contains: z.string().optional(),
    value_contains: z.string().optional(),
    scalar_type: z.enum(["string", "number", "boolean", "null"]).optional(),
    non_empty: z.boolean().optional(),
    reference_kind: z.string().optional(),
    ...AuditPaginationFields,
  })
  .strict();

export type AssetListFactsInput = z.infer<typeof AssetListFactsRequestSchema>;

export const AssetSearchValuesRequestSchema = z
  .object({
    ...AssetHandleField,
    value_contains: z.string().min(1, "value_contains must not be empty"),
    pointer_prefix: z.string().optional(),
    key: z.string().optional(),
    key_contains: z.string().optional(),
    scalar_type: z.enum(["string", "number", "boolean", "null"]).optional(),
    non_empty: z.boolean().optional(),
    ...AuditPaginationFields,
  })
  .strict();

export type AssetSearchValuesInput = z.infer<typeof AssetSearchValuesRequestSchema>;

export const AssetSearchKeysRequestSchema = z
  .object({
    ...AssetHandleField,
    key: z.string().optional(),
    key_contains: z.string().optional(),
    pointer_prefix: z.string().optional(),
    ...AuditPaginationFields,
  })
  .strict();

export type AssetSearchKeysInput = z.infer<typeof AssetSearchKeysRequestSchema>;

export const AssetGetValueRequestSchema = z
  .object({
    ...AssetHandleField,
    pointer: z.string().describe("JSON Pointer into the exact cached raw JSON."),
    offset: z.number().int().min(0).optional(),
    length: z.number().int().min(1).max(CHARACTER_LIMIT).optional(),
  })
  .strict();

export type AssetGetValueInput = z.infer<typeof AssetGetValueRequestSchema>;

export const AssetListReferencesRequestSchema = z
  .object({
    ...AssetHandleField,
    pointer_prefix: z.string().optional(),
    reference_kind: z.string().optional(),
    value_contains: z.string().optional(),
    ...AuditPaginationFields,
  })
  .strict();

export type AssetListReferencesInput = z.infer<typeof AssetListReferencesRequestSchema>;

export const AssetListScalarArtifactsRequestSchema = z
  .object({
    ...AssetHandleField,
    artifact_kind: z
      .enum([
        "http_url",
        "site_link",
        "href",
        "src",
        "anchor",
        "mailto",
        "tel",
        "root_path",
      ])
      .optional(),
    pointer_prefix: z.string().optional(),
    key: z.string().optional(),
    key_contains: z.string().optional(),
    value_contains: z.string().optional(),
    ...AuditPaginationFields,
  })
  .strict();

export type AssetListScalarArtifactsInput = z.infer<
  typeof AssetListScalarArtifactsRequestSchema
>;

export const AssetListNodeletsRequestSchema = z
  .object({
    ...AssetHandleField,
    pointer: z
      .string()
      .describe(
        "JSON Pointer of the parent nodelet. Use an empty string to list root nodelets.",
      ),
    cursor: z
      .string()
      .regex(/^c_[0-9]+$/, "cursor must be a next_cursor returned by this tool")
      .optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export type AssetListNodeletsInput = z.infer<typeof AssetListNodeletsRequestSchema>;

export const AssetGetNodeletRequestSchema = z
  .object({
    ...AssetHandleField,
    pointer: z.string().describe(
      "JSON Pointer returned by cascade_read preview root_outline or cascade_asset_list_nodelets.",
    ),
    depth: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(0)
      .describe("Child depth to include. Default 0 returns only the exact nodelet."),
    include_text: z
      .boolean()
      .default(true)
      .describe("Whether to include text fields in returned nodelets."),
  })
  .strict();

export type AssetGetNodeletInput = z.infer<typeof AssetGetNodeletRequestSchema>;

/** -------------------------------------------------------------------------
 * 2. CreateRequest — wraps asset
 * ------------------------------------------------------------------------ */
export const CreateRequestSchema = z
  .object({
    asset: CreateAssetInputSchema.describe(
      "The asset payload to create. Provide one concrete Cascade asset envelope key, with optional workflowConfiguration alongside it.",
    ),
  })
  .strict();

export type CreateInput = z.infer<typeof CreateRequestSchema>;

/** -------------------------------------------------------------------------
 * 3. EditRequest — same asset envelope wrapper, with edit-specific validation
 * ------------------------------------------------------------------------ */
export const EditRequestSchema = z
  .object({
    asset: EditAssetInputSchema.describe(
      "The asset payload to edit: one concrete asset envelope, with optional workflowConfiguration alongside it. Include `id` when available to identify the target asset. Parent-folder fields are ignored on edit — use move to relocate.",
    ),
  })
  .strict();

export type EditInput = z.infer<typeof EditRequestSchema>;

/** -------------------------------------------------------------------------
 * 4. RemoveRequest
 * ------------------------------------------------------------------------ */
export const RemoveRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset to remove (moves to recycle bin by default).",
    ),
    workflowConfiguration: WorkflowConfigurationSchema.optional().describe(
      "Optional workflow configuration to apply during removal. Matches Cascade's WorkflowConfiguration shape.",
    ),
    deleteParameters: DeleteParametersSchema.optional().describe(
      "Optional delete parameters (workflow flag plus optional unpublish behavior). Matches Cascade's DeleteParameters shape.",
    ),
  })
  .strict()
  .refine((v) => v.identifier.type !== "site", {
    message: "Cascade sites cannot be removed with cascade_remove",
    path: ["identifier", "type"],
  })
  .refine(
    (v) =>
      v.identifier.type !== "folder" || v.identifier.path?.path !== "/",
    {
      message: "Cascade site root folder path '/' requests cannot be removed with cascade_remove",
      path: ["identifier", "path", "path"],
    },
  );

export type RemoveInput = z.infer<typeof RemoveRequestSchema>;

/** -------------------------------------------------------------------------
 * 5. MoveRequest
 * ------------------------------------------------------------------------ */
const MoveParametersSchema = z
  .object({
    ...UnpublishParametersFields,
    destinationContainerIdentifier: IdentifierSchema.optional().describe(
      "Destination container (folder). Omit to keep the asset in place and only rename it.",
    ),
    doWorkflow: z
      .boolean()
      .describe(
        "REQUIRED: Whether to execute a workflow as part of the move operation.",
      ),
    newName: z
      .string()
      .optional()
      .describe("New name for the asset. Omit to preserve the current name."),
  })
  .strict()
  .describe(
    "Parameters controlling the move: destination container and/or new name, plus workflow flag.",
  );

export const MoveRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe("The asset to move."),
    moveParameters: MoveParametersSchema.describe(
      "Move parameters: destination container and/or new name.",
    ),
    workflowConfiguration: WorkflowConfigurationSchema.optional().describe(
      "Optional workflow configuration applied when doWorkflow=true.",
    ),
  })
  .strict();

export type MoveInput = z.infer<typeof MoveRequestSchema>;

/** -------------------------------------------------------------------------
 * 6. CopyRequest
 * ------------------------------------------------------------------------ */
const CopyParametersSchema = z
  .object({
    destinationContainerIdentifier: IdentifierSchema.describe(
      "REQUIRED: The destination container (folder) for the copy.",
    ),
    doWorkflow: z
      .boolean()
      .describe(
        "REQUIRED: Whether to execute a workflow as part of the copy operation.",
      ),
    newName: z
      .string()
      .describe("REQUIRED: Name for the copied asset in the destination."),
  })
  .strict()
  .describe(
    "Parameters controlling the copy: destination container, new name, and workflow flag.",
  );

export const CopyRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe("The asset to copy."),
    copyParameters: CopyParametersSchema.describe(
      "Copy parameters: destination, new name, and workflow flag.",
    ),
    workflowConfiguration: WorkflowConfigurationSchema.optional().describe(
      "Optional workflow configuration applied when doWorkflow=true.",
    ),
  })
  .strict();

export type CopyInput = z.infer<typeof CopyRequestSchema>;

/** -------------------------------------------------------------------------
 * 7. SearchRequest
 * ------------------------------------------------------------------------ */
const SearchFieldEnum = z
  .enum([
    "name",
    "path",
    "createdBy",
    "modifiedBy",
    "displayName",
    "title",
    "summary",
    "teaser",
    "keywords",
    "description",
    "author",
    "blob",
    "velocityFormatContent",
    "xml",
    "link",
  ])
  .describe(
    "Asset field to search against. Defaults to all fields when the array is omitted.",
  );

const SearchInformationSchema = z
  .object({
    searchTerms: z
      .string()
      .min(1, "searchTerms must not be empty")
      .describe(
        "REQUIRED: The query string to match. Supports Cascade's server-side search syntax.",
      ),
    siteId: z
      .string()
      .optional()
      .describe(
        "Restrict search to a single site by ID. Leave both site fields blank to search all sites.",
      ),
    siteName: z
      .string()
      .optional()
      .describe("Restrict search to a single site by name. Alternative to siteId."),
    searchFields: z
      .array(SearchFieldEnum)
      .optional()
      .describe(
        "Asset fields to search within (e.g. ['name', 'title', 'keywords']). Omit to search all fields.",
      ),
    searchTypes: z
      .array(EntityTypeSchema)
      .optional()
      .describe(
        "Asset types to include (e.g. ['page', 'file']). Omit to search all types.",
      ),
  })
  .strict()
  .describe(
    "Cascade search parameters: query string plus optional site/field/type filters.",
  );

export const SearchRequestSchema = z
  .object({
    searchInformation: SearchInformationSchema.describe(
      "Search query and filters.",
    ),
    ...PaginationFields,
  })
  .strict();

export type SearchInput = z.infer<typeof SearchRequestSchema>;

/** -------------------------------------------------------------------------
 * 8. SiteCopyRequest
 * ------------------------------------------------------------------------ */
const SiteCopyFields = {
  newSiteName: z
    .string()
    .min(1, "newSiteName is required")
    .describe(
      "REQUIRED: Name of the new site that will be created from the copy.",
    ),
};

export const SiteCopyRequestSchema = z.union([
  z
    .object({
      ...SiteCopyFields,
      originalSiteId: z
        .string()
        .describe(
          "ID of the site to copy. Takes precedence over originalSiteName when both are provided. One of originalSiteId/originalSiteName is required.",
        ),
      originalSiteName: z
        .string()
        .optional()
        .describe(
          "Name of the site to copy. Alternative to originalSiteId. One of originalSiteId/originalSiteName is required.",
        ),
    })
    .strict(),
  z
    .object({
      ...SiteCopyFields,
      originalSiteId: z
        .string()
        .optional()
        .describe(
          "ID of the site to copy. Takes precedence over originalSiteName when both are provided. One of originalSiteId/originalSiteName is required.",
        ),
      originalSiteName: z
        .string()
        .describe(
          "Name of the site to copy. Alternative to originalSiteId. One of originalSiteId/originalSiteName is required.",
        ),
    })
    .strict(),
]);

export type SiteCopyInput = z.infer<typeof SiteCopyRequestSchema>;

/** -------------------------------------------------------------------------
 * 9. ListSitesRequest — cascade-cms-api declares an empty request object
 * ------------------------------------------------------------------------ */
export const ListSitesRequestSchema = z
  .object({
  })
  .strict();

export type ListSitesInput = z.infer<typeof ListSitesRequestSchema>;

/** -------------------------------------------------------------------------
 * 10. ReadAccessRightsRequest
 * ------------------------------------------------------------------------ */
export const ReadAccessRightsRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset or container whose access rights to read.",
    ),
  })
  .strict();

export type ReadAccessRightsInput = z.infer<
  typeof ReadAccessRightsRequestSchema
>;

/** -------------------------------------------------------------------------
 * 11. EditAccessRightsRequest
 * ------------------------------------------------------------------------ */
export const EditAccessRightsRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset or container whose access rights to modify.",
    ),
    accessRightsInformation: AccessRightsInformationSendSchema.describe(
      "REQUIRED: Complete access rights payload matching Cascade's AccessRightsInformationSend shape.",
    ),
    applyToChildren: z
      .boolean()
      .optional()
      .describe(
        "Apply these rights to child assets/containers (default: false). Only meaningful for folders and containers.",
      ),
  })
  .strict();

export type EditAccessRightsInput = z.infer<
  typeof EditAccessRightsRequestSchema
>;

/** -------------------------------------------------------------------------
 * 12. ReadWorkflowSettingsRequest
 * ------------------------------------------------------------------------ */
export const ReadWorkflowSettingsRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The folder whose workflow settings to read.",
    ),
  })
  .strict();

export type ReadWorkflowSettingsInput = z.infer<
  typeof ReadWorkflowSettingsRequestSchema
>;

/** -------------------------------------------------------------------------
 * 13. EditWorkflowSettingsRequest
 * ------------------------------------------------------------------------ */
export const EditWorkflowSettingsRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The folder whose workflow settings to modify.",
    ),
    workflowSettings: WorkflowSettingsSendSchema.describe(
      "REQUIRED: Workflow settings payload (inheritWorkflows, requireWorkflow, workflowDefinitions, etc.). Matches Cascade's WorkflowSettingsSend shape.",
    ),
    applyInheritWorkflowsToChildren: z
      .boolean()
      .optional()
      .describe(
        "Apply the 'inheritWorkflows' setting to child folders (default: false).",
      ),
    applyRequireWorkflowToChildren: z
      .boolean()
      .optional()
      .describe(
        "Apply the 'requireWorkflow' setting to child folders (default: false).",
      ),
  })
  .strict();

export type EditWorkflowSettingsInput = z.infer<
  typeof EditWorkflowSettingsRequestSchema
>;

/** -------------------------------------------------------------------------
 * 14. ListSubscribersRequest
 * ------------------------------------------------------------------------ */
export const ListSubscribersRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset whose subscribers to list.",
    ),
  })
  .strict();

export type ListSubscribersInput = z.infer<
  typeof ListSubscribersRequestSchema
>;

/** -------------------------------------------------------------------------
 * 15. ListMessagesRequest — MCP pagination wrapper over cascade-cms-api's empty ListMessagesRequest
 * ------------------------------------------------------------------------ */
export const ListMessagesRequestSchema = z
  .object({
    ...PaginationFields,
  })
  .strict();

export type ListMessagesInput = z.infer<typeof ListMessagesRequestSchema>;

/** -------------------------------------------------------------------------
 * 16. MarkMessageRequest
 * ------------------------------------------------------------------------ */
export const MarkMessageRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe("The message to mark."),
    markType: z
      .enum(["read", "unread"])
      .describe(
        "REQUIRED: Action to apply to the message: 'read' | 'unread'.",
      ),
  })
  .strict();

export type MarkMessageInput = z.infer<typeof MarkMessageRequestSchema>;

/** -------------------------------------------------------------------------
 * 17. DeleteMessageRequest
 * ------------------------------------------------------------------------ */
export const DeleteMessageRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe("The message to delete."),
  })
  .strict();

export type DeleteMessageInput = z.infer<typeof DeleteMessageRequestSchema>;

/** -------------------------------------------------------------------------
 * 18. CheckOutRequest
 * ------------------------------------------------------------------------ */
export const CheckOutRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset to check out (creates a working copy for exclusive editing).",
    ),
  })
  .strict();

export type CheckOutInput = z.infer<typeof CheckOutRequestSchema>;

/** -------------------------------------------------------------------------
 * 19. CheckInRequest — library requires `comments`
 * ------------------------------------------------------------------------ */
export const CheckInRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The checked-out asset (or its working copy) to check back in.",
    ),
    comments: z
      .string()
      .describe(
        "REQUIRED: Check-in comments describing the changes. Empty string is allowed.",
      ),
  })
  .strict();

export type CheckInInput = z.infer<typeof CheckInRequestSchema>;

/** -------------------------------------------------------------------------
 * 20. ReadAuditsRequest
 * ------------------------------------------------------------------------ */
export const ReadAuditsRequestSchema = z
  .object({
    auditParameters: AuditParametersSchema.describe(
      "REQUIRED: Audit filters (identifier, username, groupname, rolename, auditType, start/end dates). Matches Cascade's AuditParameters shape.",
    ),
    ...PaginationFields,
  })
  .strict();

export type ReadAuditsInput = z.infer<typeof ReadAuditsRequestSchema>;

/** -------------------------------------------------------------------------
 * 21. ReadWorkflowInformationRequest
 * ------------------------------------------------------------------------ */
export const ReadWorkflowInformationRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset whose active workflow information to read.",
    ),
  })
  .strict();

export type ReadWorkflowInformationInput = z.infer<
  typeof ReadWorkflowInformationRequestSchema
>;

/** -------------------------------------------------------------------------
 * 22. PerformWorkflowTransitionRequest
 * ------------------------------------------------------------------------ */
export const PerformWorkflowTransitionRequestSchema = z
  .object({
    workflowTransitionInformation: z
      .object({
        workflowId: z
          .string()
          .describe("REQUIRED: The ID of the active workflow to transition."),
        actionIdentifier: z
          .string()
          .describe(
            "REQUIRED: The identifier of the workflow action/transition to perform (e.g., 'approve', 'reject').",
          ),
        transitionComment: z
          .string()
          .nullable()
          .optional()
          .describe("Optional comment recorded with the workflow transition."),
      })
      .strict()
      .describe("REQUIRED: Workflow transition information."),
  })
  .strict();

export type PerformWorkflowTransitionInput = z.infer<
  typeof PerformWorkflowTransitionRequestSchema
>;

/** -------------------------------------------------------------------------
 * 23. ReadPreferencesRequest — cascade-cms-api declares an empty request object
 * ------------------------------------------------------------------------ */
export const ReadPreferencesRequestSchema = z
  .object({
  })
  .strict();

export type ReadPreferencesInput = z.infer<
  typeof ReadPreferencesRequestSchema
>;

/** -------------------------------------------------------------------------
 * 24. ServerVersionRequest
 * ------------------------------------------------------------------------ */
export const ServerVersionRequestSchema = z
  .object({
  })
  .strict();

export type ServerVersionInput = z.infer<
  typeof ServerVersionRequestSchema
>;

/** -------------------------------------------------------------------------
 * 25. PublishUnpublishRequest
 * ------------------------------------------------------------------------ */
export const PublishUnpublishRequestSchema = z
  .object({
    identifier: IdentifierSchema.describe(
      "The asset to publish or unpublish.",
    ),
    publishInformation: PublishInformationSchema.describe(
      "REQUIRED: Publish parameters (unpublish flag, destinations list, etc.). Matches Cascade's PublishInformation shape.",
    ),
  })
  .strict();

export type PublishUnpublishInput = z.infer<
  typeof PublishUnpublishRequestSchema
>;

/** -------------------------------------------------------------------------
 * 25. EditPreferenceRequest
 * ------------------------------------------------------------------------ */
export const EditPreferenceRequestSchema = z
  .object({
    preference: PreferenceSchema.describe(
      "REQUIRED: The preference to create or update. Shape: `{ name: string, value: string }`.",
    ),
  })
  .strict();

export type EditPreferenceInput = z.infer<typeof EditPreferenceRequestSchema>;

/** -------------------------------------------------------------------------
 * 26. ReadResponseRequest — retrieve a slice of a cached oversize response.
 *
 * This is the only MCP-native tool (no Cascade backend). Agents call it with
 * a handle produced by an oversize tool response to fetch additional bytes.
 * ------------------------------------------------------------------------ */
export const ReadResponseRequestSchema = z
  .object({
    handle: z
      .string()
      .min(1, "handle must not be empty")
      // Handles are minted as `h_<uuid>` (38 chars). Cap at 64 to bound any
      // bad input cheaply before the Map lookup runs (defense in depth
      // against adversarial input wasting CPU/memory on regex passes).
      .max(64, "handle must be at most 64 characters")
      .regex(
        /^h_[0-9a-f-]{1,62}$/,
        "handle must look like 'h_<hex-uuid>'",
      )
      .describe(
        "REQUIRED: Response handle returned by a previous oversize tool call. Found in structuredContent._cache.handle (e.g. 'h_550e8400-e29b-41d4-a716-446655440000').",
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Byte offset to start the slice. Default 0. Use the previous call's next_offset to continue iterating.",
      ),
    length: z
      .number()
      .int()
      .min(1)
      .max(CHARACTER_LIMIT)
      .default(CHARACTER_LIMIT)
      .describe(
        `Maximum characters to return in this slice. Default and max ${CHARACTER_LIMIT}. Smaller slices are fine; iterate via next_offset.`,
      ),
  })
  .strict();

export type ReadResponseInput = z.infer<typeof ReadResponseRequestSchema>;
