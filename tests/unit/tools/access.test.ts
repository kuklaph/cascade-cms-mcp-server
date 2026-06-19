import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { registerAccessTools } from "../../../src/tools/access.js";
import {
  ReadAccessRightsRequestSchema,
  EditAccessRightsRequestSchema,
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

const ID_PAGE = { id: "page-abc", type: "page" as const };

/** Canned response with access rights information. */
const ACCESS_RIGHTS_OK = {
  success: true,
  accessRightsInformation: {
    identifier: ID_PAGE,
    aclEntries: [{ level: "read", type: "user", name: "alice" }],
    allLevel: "none",
  },
} as const;

// =============================================================================
// read_access_rights
// =============================================================================

describe("read_access_rights tool", () => {
  test("happy path: calls client.readAccessRights with identifier", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readAccessRights: mock(() => Promise.resolve(ACCESS_RIGHTS_OK)),
    });

    registerAccessTools(server as any, client);

    const tool = findTool(tools, "read_access_rights");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
    });

    expect(client.readAccessRights).toHaveBeenCalledTimes(1);
    expect(client.readAccessRights.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(ACCESS_RIGHTS_OK);
  });

  test("schema validation: rejects missing identifier", () => {
    const parsed = ReadAccessRightsRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readAccessRights: mock(() => Promise.reject(new Error("Request Failed. Request Response: Forbidden"))),
    });

    registerAccessTools(server as any, client);
    const tool = findTool(tools, "read_access_rights");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("read_access_rights");
  });
});

// =============================================================================
// edit_access_rights
// =============================================================================

describe("edit_access_rights tool", () => {
  test("happy path: calls client.editAccessRights with identifier + accessRightsInformation", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      editAccessRights: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerAccessTools(server as any, client);
    const tool = findTool(tools, "edit_access_rights");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const accessRightsInformation = {
      aclEntries: [{ level: "write", type: "group", name: "editors" }],
      allLevel: "none",
    };
    const result = await tool.handler({
      identifier: ID_PAGE,
      accessRightsInformation,
      applyToChildren: true,
    });

    expect(client.editAccessRights).toHaveBeenCalledTimes(1);
    expect(client.editAccessRights.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      accessRightsInformation,
      applyToChildren: true,
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing accessRightsInformation", () => {
    const parsed = EditAccessRightsRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      editAccessRights: mock(() => Promise.reject(new Error("Request Failed. Request Response: Locked"))),
    });

    registerAccessTools(server as any, client);
    const tool = findTool(tools, "edit_access_rights");

    const result = await tool.handler({
      identifier: ID_PAGE,
      accessRightsInformation: { aclEntries: [], allLevel: "none" },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("edit_access_rights");
  });
});

// =============================================================================
// Registration coverage
// =============================================================================

describe("registerAccessTools coverage", () => {
  test("registers both access tools", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerAccessTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "edit_access_rights",
      "read_access_rights",
    ]);
  });
});
