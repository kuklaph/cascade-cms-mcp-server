/**
 * Workflow tools: 4 workflow-related operations exposed to MCP clients.
 *
 *   cascade_read_workflow_settings        — read folder workflow config
 *   cascade_edit_workflow_settings        — update folder workflow config
 *   cascade_read_workflow_information     — read an in-flight workflow
 *   cascade_perform_workflow_transition   — advance a workflow step
 *
 * Each tool is a thin `registerCascadeTool` call delegating to the
 * matching `CascadeClient` method. The helper handles the
 * validate → call → format → error-translate pipeline.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import {
  ReadWorkflowSettingsRequestSchema,
  EditWorkflowSettingsRequestSchema,
  ReadWorkflowInformationRequestSchema,
  PerformWorkflowTransitionRequestSchema,
} from "../schemas/requests.js";

export function registerWorkflowTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_read_workflow_settings",
    title: "Read Workflow Settings",
    description: buildCascadeToolDescription(
      `Read workflow settings for a Cascade folder.

Returns which workflow definitions are available on the folder, whether workflow is required for changes inside it, and whether children inherit the setting. Workflow settings apply to folders; non-folder identifiers return an error. Use this before editing workflow policy so you know the existing configuration.

Args:
  - identifier (object, required): The folder
    - id (string, optional): Folder ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): "folder"
    - requires type plus either id or path

Returns:
  Cascade OperationResult:
  {
    success: true,
    workflowSettings: {
      identifier: { ... },
      workflowDefinitions: [ ... ],
      inheritedWorkflowDefinitions: [ ... ],
      inheritWorkflows: boolean,
      requireWorkflow: boolean
    }
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Does /about require workflow?" -> { identifier: { type: "folder", path: { path: "/about", siteName: "www" } } }
  - Use when: "Read a folder's workflow policy" -> { identifier: { type: "folder", id: "..." } }
  - Don't use when: You want to inspect an in-flight workflow — use cascade_read_workflow_information.
  - Don't use when: Target is not a folder — workflow settings are folder-only.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Not a folder" when the identifier does not point to a folder
  - "Permission denied" when credentials lack read access`,
    ),
    inputSchema: ReadWorkflowSettingsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.readWorkflowSettings(input as unknown as Types.ReadWorkflowSettingsRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_edit_workflow_settings",
    title: "Edit Workflow Settings",
    description: buildCascadeToolDescription(
      `Update workflow settings for a Cascade folder. Optionally propagate to children.

Replaces the folder's workflow configuration wholesale. Two boolean flags control propagation: applyInheritWorkflowsToChildren copies the "inherit" setting to descendants, applyRequireWorkflowToChildren copies the "required" setting. Call cascade_read_workflow_settings first, then copy only editable WorkflowSettingsSend fields into workflowSettings: workflowDefinitions?, inheritWorkflows?, and requireWorkflow?. Omit the returned identifier field.

Args:
  - identifier (object, required): The folder to update
    - id (string, optional): Folder ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): "folder"
    - requires type plus either id or path
  - workflowSettings (object, required): Complete replacement workflow configuration matching cascade-cms-api WorkflowSettingsSend
    - workflowDefinitions? (array): Identifier objects for workflows that apply in this folder, e.g. [{ type: "workflowdefinition", id: "..." }]
    - inheritWorkflows? (boolean): Whether to inherit from parent
    - requireWorkflow? (boolean): Whether workflow is mandatory for edits
  - applyInheritWorkflowsToChildren (boolean, optional, default false): Propagate inheritWorkflows to descendants
  - applyRequireWorkflowToChildren (boolean, optional, default false): Propagate requireWorkflow to descendants

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Require workflow on /releases and all its children" -> { identifier: { type: "folder", path: { path: "/releases", siteName: "www" } }, workflowSettings: { workflowDefinitions: [{ type: "workflowdefinition", id: "..." }], inheritWorkflows: false, requireWorkflow: true }, applyRequireWorkflowToChildren: true }
  - Use when: "Swap a workflow definition on a folder" -> pass workflowSettings with a new workflowDefinitions identifier array.
  - Don't use when: You want to advance an in-flight workflow — use cascade_perform_workflow_transition.
  - Don't use when: You only need to read — use cascade_read_workflow_settings.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Invalid workflow definition" when a referenced workflow ID is wrong
  - "Permission denied" when credentials lack admin rights`,
    ),
    inputSchema: EditWorkflowSettingsRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.editWorkflowSettings(input as unknown as Types.EditWorkflowSettingsRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_read_workflow_information",
    title: "Read Workflow Information",
    description: buildCascadeToolDescription(
      `Read information about the in-flight workflow attached to an asset.

When an asset is going through an approval workflow, Cascade returns the workflow id, related entity, current step, and optional ordered/unordered steps. Actions, when present, live under workflow step objects as orderedSteps[].actions or unorderedSteps[].actions; pass the workflow id and one action identifier to cascade_perform_workflow_transition to advance the workflow.

Args:
  - identifier (object, required): The asset whose workflow state to read
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known

Returns:
  Cascade OperationResult:
  {
    success: true,
    workflow: {
      id: "<workflow id>",
      name: "...",
      currentStep: "...",
      relatedEntity: { ... },
      orderedSteps: [ { identifier, label, stepType, owner, actions: [ { identifier, label, actionType, nextId }, ... ] } ],
      unorderedSteps: [ ... ]
    }
  }
  On failure: { success: false, message: "<error>" } — also when no workflow is in flight

Examples:
  - Use when: "What step is /about/team in?" -> { identifier: { type: "page", path: { path: "/about/team", siteName: "www" } } }
  - Use when: "List actions I can take on this asset's workflow" -> pass the identifier and inspect workflow orderedSteps/unorderedSteps actions.
  - Don't use when: You want workflow policy — use cascade_read_workflow_settings.
  - Don't use when: No workflow is in flight — expect a "no workflow" failure.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "No workflow in progress" when the asset has no active workflow
  - "Permission denied" when credentials lack read access`,
    ),
    inputSchema: ReadWorkflowInformationRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.readWorkflowInformation(input as unknown as Types.ReadWorkflowInformationRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_perform_workflow_transition",
    title: "Perform Workflow Transition",
    description: buildCascadeToolDescription(
      `Advance an in-flight workflow to its next step (approve, reject, publish, etc.).

Executes a named action against an active workflow. The workflowId and actionIdentifier come from a prior cascade_read_workflow_information call — the tool does not enumerate actions itself. A transitionComment is recommended so reviewers understand the decision. Once the final step is executed, Cascade may publish, delete, or otherwise commit the change associated with the workflow.

Args:
  - workflowTransitionInformation (object, required):
    - workflowId (string, required): The active workflow's id (from cascade_read_workflow_information)
    - actionIdentifier (string, required): The action to take (from orderedSteps[].actions[].identifier or unorderedSteps[].actions[].identifier)
    - transitionComment (string, optional): User comment explaining this transition

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Approve an editor's page submission" -> { workflowTransitionInformation: { workflowId: "...", actionIdentifier: "approve", transitionComment: "Looks good." } }
  - Use when: "Reject and send back" -> { workflowTransitionInformation: { workflowId: "...", actionIdentifier: "reject", transitionComment: "Fix the headline." } }
  - Don't use when: You don't yet know which actions are valid — call cascade_read_workflow_information first.
  - Don't use when: No workflow exists — this only advances an in-flight one.

Error Handling:
  - "Workflow not found" when workflowId is invalid or already finished
  - "Invalid action" when actionIdentifier is not among the workflow's available actions
  - "Permission denied" when current user can't act on this workflow step`,
    ),
    inputSchema: PerformWorkflowTransitionRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.performWorkflowTransition(input as unknown as Types.PerformWorkflowTransitionRequest),
  }, deps);
}
