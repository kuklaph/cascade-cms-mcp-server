import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { registerWorkflowTools } from "../../../src/tools/workflow.js";
import {
  ReadWorkflowSettingsRequestSchema,
  EditWorkflowSettingsRequestSchema,
  ReadWorkflowInformationRequestSchema,
  PerformWorkflowTransitionRequestSchema,
} from "../../../src/schemas/requests.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";
import { OK_RESULT } from "../../fixtures/cascade-responses.js";


// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const ID_FOLDER = { id: "folder-1", type: "folder" as const };
const ID_PAGE = { id: "page-1", type: "page" as const };

const WORKFLOW_SETTINGS_OK = {
  success: true,
  workflowSettings: {
    identifier: ID_FOLDER,
    workflowDefinitions: [],
    inheritedWorkflowDefinitions: [],
    inheritWorkflows: false,
    requireWorkflow: false,
  },
} as const;

const WORKFLOW_INFO_OK = {
  success: true,
  workflow: {
    id: "wf-1",
    relatedEntityId: "page-1",
    currentStep: "review",
    possibleTransitions: [{ identifier: "approve", name: "Approve" }],
  },
} as const;

// =============================================================================
// cascade_read_workflow_settings
// =============================================================================

describe("cascade_read_workflow_settings tool", () => {
  test("happy path: calls client.readWorkflowSettings with identifier", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readWorkflowSettings: mock(() => Promise.resolve(WORKFLOW_SETTINGS_OK)),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_read_workflow_settings");

    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_FOLDER,
    });

    expect(client.readWorkflowSettings).toHaveBeenCalledTimes(1);
    expect(client.readWorkflowSettings.mock.calls[0][0]).toEqual({
      identifier: ID_FOLDER,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(WORKFLOW_SETTINGS_OK);
  });

  test("schema validation: rejects missing identifier", () => {
    const parsed = ReadWorkflowSettingsRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readWorkflowSettings: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Forbidden")),
      ),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_read_workflow_settings");

    const result = await tool.handler({ identifier: ID_FOLDER });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_read_workflow_settings");
  });
});

// =============================================================================
// cascade_edit_workflow_settings
// =============================================================================

describe("cascade_edit_workflow_settings tool", () => {
  test("happy path: calls client.editWorkflowSettings with settings", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      editWorkflowSettings: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_edit_workflow_settings");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const workflowSettings = {
      workflowDefinitions: [],
      inheritWorkflows: true,
      requireWorkflow: false,
    };
    const result = await tool.handler({
      identifier: ID_FOLDER,
      workflowSettings,
      applyInheritWorkflowsToChildren: true,
      applyRequireWorkflowToChildren: false,
    });

    expect(client.editWorkflowSettings).toHaveBeenCalledTimes(1);
    expect(client.editWorkflowSettings.mock.calls[0][0]).toEqual({
      identifier: ID_FOLDER,
      workflowSettings,
      applyInheritWorkflowsToChildren: true,
      applyRequireWorkflowToChildren: false,
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing workflowSettings", () => {
    const parsed = EditWorkflowSettingsRequestSchema.safeParse({
      identifier: ID_FOLDER,
    });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      editWorkflowSettings: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Conflict")),
      ),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_edit_workflow_settings");

    const result = await tool.handler({
      identifier: ID_FOLDER,
      workflowSettings: {},
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_edit_workflow_settings");
  });
});

// =============================================================================
// cascade_read_workflow_information
// =============================================================================

describe("cascade_read_workflow_information tool", () => {
  test("happy path: calls client.readWorkflowInformation with identifier", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readWorkflowInformation: mock(() => Promise.resolve(WORKFLOW_INFO_OK)),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_read_workflow_information");

    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
    });

    expect(client.readWorkflowInformation).toHaveBeenCalledTimes(1);
    expect(client.readWorkflowInformation.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(WORKFLOW_INFO_OK);
  });

  test("schema validation: rejects missing identifier", () => {
    const parsed = ReadWorkflowInformationRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readWorkflowInformation: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Not Found")),
      ),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_read_workflow_information");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_read_workflow_information");
  });
});

// =============================================================================
// cascade_perform_workflow_transition
// =============================================================================

describe("cascade_perform_workflow_transition tool", () => {
  test("happy path: calls client.performWorkflowTransition with wrapped workflowTransitionInformation", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      performWorkflowTransition: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_perform_workflow_transition");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      workflowTransitionInformation: {
        workflowId: "wf-1",
        actionIdentifier: "approve",
        transitionComment: "Looks good",
      },
    });

    expect(client.performWorkflowTransition).toHaveBeenCalledTimes(1);
    expect(client.performWorkflowTransition.mock.calls[0][0]).toEqual({
      workflowTransitionInformation: {
        workflowId: "wf-1",
        actionIdentifier: "approve",
        transitionComment: "Looks good",
      },
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing workflowId", () => {
    const parsed = PerformWorkflowTransitionRequestSchema.safeParse({
      workflowTransitionInformation: {
        actionIdentifier: "approve",
      },
    });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      performWorkflowTransition: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Invalid Transition")),
      ),
    });

    registerWorkflowTools(server as any, client);
    const tool = findTool(tools, "cascade_perform_workflow_transition");

    const result = await tool.handler({
      workflowTransitionInformation: {
        workflowId: "wf-1",
        actionIdentifier: "approve",
      },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_perform_workflow_transition");
  });
});

// =============================================================================
// Registration coverage: all 4 workflow tools registered
// =============================================================================

describe("registerWorkflowTools coverage", () => {
  test("registers all 4 workflow tools with cascade_ prefix", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerWorkflowTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "cascade_edit_workflow_settings",
      "cascade_perform_workflow_transition",
      "cascade_read_workflow_information",
      "cascade_read_workflow_settings",
    ]);
  });
});
